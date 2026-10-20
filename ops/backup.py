#!/usr/bin/env python3
"""Full, consistent PG18 backup using a separately protected SELECT-only role.

LEARNING_PG_ENV is a mode-600 Docker env file containing PGHOST, PGPORT,
PGDATABASE, PGUSER, PGPASSWORD and the deployment's PGSSLMODE/PGSSLROOTCERT.
It must name the backup role, never the Web application's runtime role.
All diagnostics deliberately omit subprocess stderr, URLs and credentials.
"""
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import uuid


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class Pg:
    def __init__(self, env_file):
        path = Path(env_file).resolve(strict=True)
        mode = path.stat().st_mode
        if not stat.S_ISREG(mode) or mode & 0o077:
            raise RuntimeError("PostgreSQL environment file must be protected (mode 600)")
        self.base = ["docker", "run", "--rm", "-i", "--network",
                     os.environ.get("LEARNING_PG_NETWORK", "host"), "--env-file", str(path)]
        cert_dir = os.environ.get("LEARNING_PG_CERT_DIR")
        if cert_dir:
            self.base += ["--mount", "type=bind,src=" + str(Path(cert_dir).resolve(strict=True)) + ",dst=/certs,readonly"]
        self.image = os.environ.get("LEARNING_PG_IMAGE", "postgres:18")

    def args(self, tool, args=()):
        return self.base + ["--name", "learning-pg-op-" + uuid.uuid4().hex,
                            "--entrypoint", tool, self.image] + list(args)

    @staticmethod
    def cleanup(command):
        # Killing a timed-out docker client need not stop its attached container.
        # Remove only the unique container allocated for this exact operation.
        name = command[command.index("--name") + 1]
        try:
            subprocess.run(["docker", "rm", "--force", name], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=15)
        except (OSError, subprocess.SubprocessError):
            pass


class Snapshot:
    def __init__(self, pg):
        self.pg = pg
        self.command = pg.args("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"])
        self.stderr = tempfile.TemporaryFile()
        self.process = subprocess.Popen(self.command,
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=self.stderr, text=True, bufsize=1)
        try:
            self.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        except Exception:
            self.close()
            raise

    def query(self, sql):
        marker = "END_" + uuid.uuid4().hex
        self.process.stdin.write(sql + ";\nSELECT '" + marker + "';\n")
        self.process.stdin.flush()
        result = []
        # TextIO may prefetch lines: readline consumes those before select is used again.
        # psql emits the marker on every successful batch, and a watchdog bounds hangs.
        import threading
        timer = threading.Timer(45, self.process.kill)
        timer.start()
        try:
            while True:
                line = self.process.stdout.readline()
                if not line:
                    raise RuntimeError("PostgreSQL snapshot query failed")
                line = line.rstrip("\r\n")
                if line == marker:
                    return result
                result.append(line)
        finally:
            timer.cancel()

    def close(self):
        try:
            if self.process.poll() is None:
                self.process.stdin.write("ROLLBACK;\n\\q\n")
                self.process.stdin.flush()
                self.process.wait(timeout=10)
        finally:
            if self.process.poll() is None:
                self.process.kill()
                self.process.wait()
            self.process.stdin.close()
            self.process.stdout.close()
            self.stderr.close()
            self.pg.cleanup(self.command)


def validate_full_reader(snapshot):
    # counts() and pg_dump would otherwise agree on the SAME filtered subset. A true
    # permissive SELECT policy plus absence of applicable restrictive policies proves
    # that RLS cannot silently remove families from this dedicated role's backup.
    rows = snapshot.query("""
        SELECT n.nspname||'.'||c.relname||'|'||
          CASE WHEN NOT c.relrowsecurity OR (
            EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid
              AND p.polcmd IN ('r','*') AND p.polpermissive
              AND pg_get_expr(p.polqual,p.polrelid)='true'
              AND (0=ANY(p.polroles) OR EXISTS (SELECT 1 FROM unnest(p.polroles) r
                    WHERE r<>0 AND pg_has_role(current_user,r,'USAGE'))))
            AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid
              AND p.polcmd IN ('r','*') AND NOT p.polpermissive
              AND (0=ANY(p.polroles) OR EXISTS (SELECT 1 FROM unnest(p.polroles) r
                    WHERE r<>0 AND pg_has_role(current_user,r,'USAGE'))))
          ) THEN 'full' ELSE 'filtered' END||'|'||
          CASE WHEN has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            THEN 'writable' ELSE 'readonly' END
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind IN ('r','p') AND n.nspname IN ('learning','public')
        ORDER BY 1
    """)
    if not rows or any(not row.endswith("|full|readonly") for row in rows):
        raise RuntimeError("Backup role must have unfiltered read-only access to every application table")


def write_manifest(path, manifest):
    # Exclusive temporary file avoids predictable-name clobbering; fsync before atomic publication.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                prefix=path.name + ".", suffix=".pending", delete=False) as output:
            temporary = Path(output.name)
            json.dump(manifest, output, ensure_ascii=False, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(path)
        descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def counts(snapshot):
    tables = snapshot.query("SELECT schemaname||'.'||tablename FROM pg_tables WHERE schemaname IN ('learning','public') ORDER BY 1")
    result = {}
    for table in tables:
        if not re.fullmatch(r"(learning|public)\.[a-z_][a-z_0-9]*", table):
            raise RuntimeError("Unexpected table identifier")
        result[table] = int(snapshot.query("SELECT count(*) FROM " + table)[0])
    if "public.flyway_schema_history" not in result or not any(t.startswith("learning.") for t in result):
        raise RuntimeError("Expected a dedicated migrated learning database")
    return result


def create_backup():
    os.umask(0o077)
    directory = Path(os.environ["LEARNING_BACKUP_DIR"])
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if directory.is_symlink() or directory.stat().st_mode & 0o077:
        raise RuntimeError("Backup directory must be protected (mode 700)")
    with (directory / ".backup.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        pg = Pg(os.environ["LEARNING_PG_ENV"])
        snapshot = Snapshot(pg)
        timestamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        target = directory / ("learning-" + timestamp + "-" + uuid.uuid4().hex[:8] + ".dump")
        pending = target.with_suffix(".partial")
        try:
            role = snapshot.query("SELECT current_user||'|'||rolsuper||'|'||rolbypassrls||'|'||rolcreatedb||'|'||rolcreaterole||'|'||rolreplication FROM pg_roles WHERE rolname=current_user")[0]
            if role != "learning_backup|false|false|false|false|false":
                raise RuntimeError("A dedicated non-superuser learning_backup role is required")
            version = int(snapshot.query("SELECT current_setting('server_version_num')")[0])
            if not 180000 <= version < 190000:
                raise RuntimeError("PostgreSQL 18 is required")
            validate_full_reader(snapshot)
            snapshot_id = snapshot.query("SELECT pg_export_snapshot()")[0]
            expected = counts(snapshot)
            with pending.open("xb") as output:
                command = pg.args("pg_dump", ["--format=custom", "--enable-row-security",
                    "--snapshot=" + snapshot_id, "--lock-wait-timeout=15s", "--no-owner", "--no-acl"])
                try:
                    result = subprocess.run(command, stdout=output, stderr=subprocess.DEVNULL, timeout=1800)
                finally:
                    pg.cleanup(command)
                if result.returncode != 0:
                    raise RuntimeError("Full database dump failed")
                output.flush()
                os.fsync(output.fileno())
            digest = sha256_file(pending)
            manifest = {"createdAt": timestamp, "postgresVersionNum": version, "format": "custom",
                        "backupRole": "learning_backup", "snapshotCounts": expected,
                        "sha256": digest,
                        "restoreVerified": False}
            pending.rename(target)
            write_manifest(target.with_suffix(".json"), manifest)
            print("Full learning backup saved; restore verification remains a separate operation.")
            # No age-based automatic deletion: retain a known-good verified recovery point.
            return target
        finally:
            pending.unlink(missing_ok=True)
            snapshot.close()


if __name__ == "__main__":
    try:
        create_backup()
    except Exception:
        raise SystemExit("Learning backup FAILED; inspect protected configuration and database permissions.")
