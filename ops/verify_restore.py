#!/usr/bin/env python3
"""Restore one protected snapshot into a new disposable database and compare counts.

Requires LEARNING_RESTORE_ADMIN_ENV (protected PG env with CREATEDB) and the
backup role environment LEARNING_PG_ENV. Never restores into an existing DB.
The explicitly named, newly created verification database is dropped on success;
failed verification retains it with PUBLIC CONNECT revoked for investigation.
"""
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import uuid
from backup import Pg, Snapshot, counts, sha256_file, validate_full_reader, write_manifest


def run(pg, tool, args, data=None):
    command = pg.args(tool, args)
    try:
        result = subprocess.run(command, input=data, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=1800)
    finally:
        pg.cleanup(command)
    if result.returncode:
        raise RuntimeError("Restore verification command failed")
    return result.stdout


def verify(path):
    os.umask(0o077)
    dump = Path(path).resolve(strict=True)
    if dump.suffix != ".dump" or not stat.S_ISREG(dump.stat().st_mode) or dump.stat().st_mode & 0o077:
        raise RuntimeError("A protected learning dump is required")
    with dump.open("rb") as guard:
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        verify_locked(dump)


def verify_locked(dump):
    manifest_path = dump.with_suffix(".json")
    if not stat.S_ISREG(manifest_path.stat().st_mode) or manifest_path.stat().st_mode & 0o077:
        raise RuntimeError("A protected learning backup manifest is required")
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("backupRole") != "learning_backup" or manifest.get("format") != "custom":
        raise RuntimeError("Expected a complete learning backup manifest")
    if sha256_file(dump) != manifest["sha256"]:
        raise RuntimeError("Backup checksum mismatch")
    admin = Pg(os.environ["LEARNING_RESTORE_ADMIN_ENV"])
    backup = Pg(os.environ["LEARNING_PG_ENV"])
    check = Snapshot(admin)
    try:
        version = int(check.query("SELECT current_setting('server_version_num')")[0])
        if not 180000 <= version < 190000:
            raise RuntimeError("Restore verification requires PostgreSQL 18")
        role = check.query("SELECT current_user||'|'||(rolcreatedb OR rolsuper) FROM pg_roles WHERE rolname=current_user")[0]
        if role.startswith(("learning_app|", "learning_backup|")) or not role.endswith("|true"):
            raise RuntimeError("A separate CREATEDB verification role is required")
    finally:
        check.close()
    database = "learning_restore_" + uuid.uuid4().hex
    run(admin, "psql", ["-X", "-v", "ON_ERROR_STOP=1", "-c",
        "CREATE DATABASE " + database + " TEMPLATE template0 ALLOW_CONNECTIONS false"])
    run(admin, "psql", ["-X", "-v", "ON_ERROR_STOP=1", "-c",
        "REVOKE CONNECT ON DATABASE " + database + " FROM PUBLIC; GRANT CONNECT ON DATABASE " + database +
        " TO learning_backup; ALTER DATABASE " + database + " ALLOW_CONNECTIONS true"])
    # The full archive includes Flyway metadata. RLS is restored after table data.
    with dump.open("rb") as source:
        command = admin.args("pg_restore", ["--dbname=" + database,
            "--no-owner", "--no-acl", "--exit-on-error", "--single-transaction"])
        try:
            result = subprocess.run(command, stdin=source, stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL, timeout=1800)
        finally:
            admin.cleanup(command)
    if result.returncode:
        raise RuntimeError("Restore failed; protected verification database retained: " + database)
    run(admin, "psql", ["--dbname=" + database, "-X", "-v", "ON_ERROR_STOP=1", "-c",
        "GRANT USAGE ON SCHEMA learning TO learning_backup; "
        "GRANT SELECT ON ALL TABLES IN SCHEMA learning TO learning_backup; "
        "GRANT SELECT ON public.flyway_schema_history TO learning_backup"])
    backup.base += ["--env", "PGDATABASE=" + database]
    snapshot = Snapshot(backup)
    try:
        validate_full_reader(snapshot)
        restored = counts(snapshot)
    finally:
        snapshot.close()
    if restored != manifest["snapshotCounts"]:
        raise RuntimeError("Restore count mismatch; protected verification database retained: " + database)
    # Only the UUID-named DB created in this operation can reach this DROP.
    run(admin, "psql", ["-X", "-v", "ON_ERROR_STOP=1", "-c", "DROP DATABASE " + database])
    manifest["restoreVerified"] = True
    manifest["restoreVerifiedAt"] = dt.datetime.now(dt.timezone.utc).isoformat()
    write_manifest(manifest_path, manifest)
    print("Full restore and snapshot row counts verified; disposable database removed.")


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2:
            raise RuntimeError("Expected one backup path")
        verify(sys.argv[1])
    except Exception as exception:
        # Controlled messages only; never print database driver/subprocess diagnostics.
        print(str(exception) if isinstance(exception, RuntimeError) else "Restore verification FAILED", file=sys.stderr)
        sys.exit(1)
