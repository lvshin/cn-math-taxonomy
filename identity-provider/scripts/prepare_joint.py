#!/usr/bin/env python3
"""Prepare a disposable Keycloak + protected environment for a real-backend joint test.

Requires a separate synthetic PostgreSQL database and roles, supplied as DB_* env.
Never uses production identities or deployment settings. Run --stop after acceptance.
"""
import argparse
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import time
import urllib.parse
import urllib.request

from configure_flow import Admin, configure

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT.parent / ".local" / "identity-provider-joint"
REALM = "learning-joint"
CLIENT = "learning-test"
OPERATOR = "10000000-0000-4000-8000-000000000001"


def protected(path, content):
    path.write_text(content)
    os.chmod(path, 0o600)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stop", action="store_true")
    parser.add_argument("--keycloak-port", type=int, default=18885)
    parser.add_argument("--application-port", type=int, default=18886)
    parser.add_argument("--gateway-port", type=int, default=18888)
    args = parser.parse_args()
    PRIVATE.mkdir(parents=True, exist_ok=True); os.chmod(PRIVATE, 0o700)
    state_path = PRIVATE / "state.json"
    if args.stop:
        if state_path.exists():
            state = json.loads(state_path.read_text())
            subprocess.run(["docker", "rm", "-f", state["container"]], check=True, capture_output=True)
            if state.get("proxyPid"):
                try:
                    os.kill(state["proxyPid"], signal.SIGTERM)
                except ProcessLookupError:
                    pass
            for name in ("state.json", "actors.json", "backend.env", "keycloak.env", REALM + "-realm.json"):
                (PRIVATE / name).unlink(missing_ok=True)
        print("Disposable joint-test identity container stopped; synthetic credentials removed")
        return
    if state_path.exists():
        raise RuntimeError("An existing joint-test container is registered; use --stop first")
    db_url = os.environ.get("DB_URL")
    migration_user = os.environ.get("DB_MIGRATION_USER")
    if not db_url or not migration_user:
        parser.error("Supply a dedicated synthetic DB_URL and DB_MIGRATION_USER")
    jar = ROOT / "target" / "learning-invitation-provider-1.0.0.jar"
    if not jar.exists():
        raise RuntimeError("Build the provider first")
    base = f"http://127.0.0.1:{args.keycloak_port}"
    app = f"http://127.0.0.1:{args.application_port}/edu/math"
    issuer = base + "/realms/" + REALM
    registration_key = secrets.token_urlsafe(36)
    admin_password = secrets.token_urlsafe(30)
    operator_password = secrets.token_urlsafe(24)
    client_secret = secrets.token_urlsafe(36)
    realm_file = PRIVATE / (REALM + "-realm.json")
    protected(realm_file, json.dumps({"realm": REALM, "enabled": True, "registrationAllowed": False,
        "sslRequired": "none", "users": [{"id": OPERATOR, "username": "operator", "enabled": True,
        "email": "operator@example.test", "firstName": "Synthetic", "lastName": "Operator",
        "credentials": [{"type": "password", "value": operator_password, "temporary": False}]}],
        "clients": [{"clientId": CLIENT, "enabled": True, "publicClient": False, "secret": client_secret,
        "standardFlowEnabled": True, "directAccessGrantsEnabled": False,
        "redirectUris": [app + "/login/oauth2/code/learning"], "attributes": {
            "pkce.code.challenge.method": "S256",
            "post.logout.redirect.uris": app + "/*",
            "backchannel.logout.url": f"http://host.docker.internal:{args.application_port}/edu/math/logout/connect/back-channel/learning",
            "backchannel.logout.session.required": "true"}}]}))
    kc_env = PRIVATE / "keycloak.env"
    protected(kc_env, "\n".join(["KC_BOOTSTRAP_ADMIN_USERNAME=synthetic-admin",
        "KC_BOOTSTRAP_ADMIN_PASSWORD=" + admin_password, "LEARNING_REGISTRATION_CLIENT_ID=" + CLIENT,
        f"LEARNING_REGISTRATION_BACKEND_URL=http://host.docker.internal:{args.gateway_port}/edu/math",
        "LEARNING_REGISTRATION_KEY=" + registration_key, "KC_HTTP_ENABLED=true", "KC_HOSTNAME_STRICT=false"]) + "\n")
    env = {"PORT": str(args.application_port), "BIND_ADDRESS": "0.0.0.0", "DB_URL": db_url,
        "DB_USER": os.environ.get("DB_USER", "learning_app"), "DB_PASSWORD": os.environ.get("DB_PASSWORD", ""),
        "DB_MIGRATION_USER": migration_user, "DB_MIGRATION_PASSWORD": os.environ.get("DB_MIGRATION_PASSWORD", ""),
        "OIDC_ISSUER": issuer, "OIDC_CLIENT_ID": CLIENT, "OIDC_CLIENT_SECRET": client_secret,
        "REGISTRATION_KEY": registration_key, "REGISTRATION_REDIRECT_URI": app + "/login/oauth2/code/learning",
        "OPERATOR_ISSUER": issuer, "OPERATOR_SUBJECT": OPERATOR}
    protected(PRIVATE / "backend.env", "\n".join(k + "=" + v for k, v in env.items()) + "\n")
    protected(PRIVATE / "actors.json", json.dumps({"operator": {"username": "operator", "password": operator_password},
        "newMemberPassword": secrets.token_urlsafe(24), "application": app, "issuer": issuer}))
    proxy_log = open(PRIVATE / "proxy.log", "ab")
    os.chmod(PRIVATE / "proxy.log", 0o600)
    proxy = subprocess.Popen([sys.executable, str(ROOT / "scripts" / "joint_gateway_proxy.py"),
        "--environment", str(PRIVATE / "backend.env"), "--port", str(args.gateway_port)],
        stdout=proxy_log, stderr=subprocess.STDOUT)
    container = "learning-registration-joint-" + secrets.token_hex(4)
    subprocess.run(["docker", "run", "-d", "--name", container, "--env-file", str(kc_env),
        "-p", f"127.0.0.1:{args.keycloak_port}:8080", "-v", f"{jar}:/opt/keycloak/providers/learning-invitation-provider.jar:ro",
        "-v", f"{realm_file}:/opt/keycloak/data/import/{REALM}-realm.json:ro",
        "quay.io/keycloak/keycloak:26.7.3", "start-dev", "--import-realm"], check=True, capture_output=True)
    protected(state_path, json.dumps({"container": container, "issuer": issuer, "application": app,
        "proxyPid": proxy.pid, "proxyPort": args.gateway_port}))
    deadline = time.monotonic() + 150
    while True:
        try:
            with urllib.request.urlopen(issuer + "/.well-known/openid-configuration", timeout=5):
                break
        except Exception:
            if time.monotonic() > deadline:
                raise RuntimeError("Synthetic identity server did not become ready; --stop cleans up")
            time.sleep(1)
    payload = urllib.parse.urlencode({"client_id": "admin-cli", "username": "synthetic-admin",
        "password": admin_password, "grant_type": "password"}).encode()
    with urllib.request.urlopen(urllib.request.Request(base + "/realms/master/protocol/openid-connect/token",
        data=payload, headers={"Content-Type": "application/x-www-form-urlencoded"}), timeout=15) as response:
        token = json.load(response)["access_token"]
    configure(Admin(base, REALM, token), CLIENT, apply=True, enable=True)
    print("Disposable identity ready. Protected environment: " + str(PRIVATE / "backend.env"))


if __name__ == "__main__":
    main()
