#!/usr/bin/env python3
"""Incrementally configure Keycloak Remember Me; default is a read-only preview.

Only the three Remember Me Realm settings are written. Ordinary SSO timeouts,
clients, identity data, registration flows and login flows are not imported.
The short-lived admin access token is read from the environment, never arguments.
"""
import argparse
import json
import os
from pathlib import Path
import urllib.parse

from configure_flow import Admin

FIELDS = ("rememberMe", "ssoSessionIdleTimeoutRememberMe", "ssoSessionMaxLifespanRememberMe")
GUARDS = ("ssoSessionIdleTimeout", "ssoSessionMaxLifespan", "clientSessionIdleTimeout",
          "clientSessionMaxLifespan", "browserFlow", "registrationFlow", "registrationAllowed")


def settings(realm):
    return {key: realm.get(key, False if key == "rememberMe" else 0) for key in FIELDS}


def protected_backup(path, realm):
    path = Path(path)
    # Refuse overwrite so a second run cannot silently replace the recovery point.
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as output:
        json.dump({"schema": 1, "settings": settings(realm)}, output, indent=2)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())


def restore_settings(path):
    value = json.loads(Path(path).read_text())
    if value.get("schema") != 1 or set(value.get("settings", {})) != set(FIELDS):
        raise ValueError("Not a Remember Me settings recovery file")
    restored = value["settings"]
    if not isinstance(restored["rememberMe"], bool) or any(
            type(restored[key]) is not int or restored[key] < 0 for key in FIELDS[1:]):
        raise ValueError("Invalid Remember Me recovery values")
    return restored


def configure(admin, client_id, days=30, apply=False, backup_file=None, restore_file=None):
    if type(days) is not int or not 1 <= days <= 90:
        raise ValueError("Remember Me lifespan must be between 1 and 90 days")
    clients = admin.request("GET", "/clients?clientId=" + urllib.parse.quote(client_id, safe=""))
    if len(clients) != 1 or clients[0].get("clientId") != client_id:
        raise RuntimeError("The target OIDC client must already exist")
    realm = admin.request("GET")
    desired = restore_settings(restore_file) if restore_file else {
        "rememberMe": True, "ssoSessionIdleTimeoutRememberMe": days * 86400,
        "ssoSessionMaxLifespanRememberMe": days * 86400}
    if not restore_file and any(realm.get(key, 0) > days * 86400
            for key in ("ssoSessionIdleTimeout", "ssoSessionMaxLifespan")):
        raise RuntimeError("Ordinary SSO timeouts exceed the requested bound; resolve them explicitly first")
    result = {"before": settings(realm), "requested": desired,
              "ordinarySessionTimeouts": {key: realm.get(key, 0) for key in GUARDS[:4]},
              "changed": False, "applied": False}
    if not apply:
        return result
    if not backup_file:
        raise ValueError("--apply requires a new protected --backup-file")
    protected_backup(backup_file, realm)
    if settings(realm) != desired:
        admin.request("PUT", "", desired)
        result["changed"] = True
    after = admin.request("GET")
    after_clients = admin.request("GET", "/clients?clientId=" + urllib.parse.quote(client_id, safe=""))
    if settings(after) != desired:
        raise RuntimeError("Remember Me readback differs; inspect the saved recovery point")
    if any(after.get(key) != realm.get(key) for key in GUARDS) or clients != after_clients:
        raise RuntimeError("Unrelated session or client settings changed concurrently; inspect before proceeding")
    result["applied"] = True
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--realm", required=True)
    parser.add_argument("--client-id", required=True)
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup-file", help="New file outside the public source tree; mode 0600, never overwritten")
    parser.add_argument("--restore-backup", help="Preview restoring just the three settings from a previous recovery file")
    args = parser.parse_args()
    token = os.environ.get("KEYCLOAK_ADMIN_ACCESS_TOKEN")
    if not token:
        parser.error("KEYCLOAK_ADMIN_ACCESS_TOKEN is required")
    if args.apply and not args.backup_file:
        parser.error("--apply requires --backup-file")
    print(json.dumps(configure(Admin(args.base_url, args.realm, token), args.client_id,
        args.days, args.apply, args.backup_file, args.restore_backup), ensure_ascii=False))


if __name__ == "__main__":
    main()
