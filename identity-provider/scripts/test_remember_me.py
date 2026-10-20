#!/usr/bin/env python3
"""Real Keycloak Remember Me acceptance in an owned disposable synthetic Realm.

Tests the native checkbox, ordinary versus persistent identity cookies, PKCE,
prompt=none browser restart, the absolute thirty-day bound and RP logout.
Never reads an existing identity deployment, Realm or real account.
"""
import base64
import copy
import hashlib
import http.cookiejar
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from configure_flow import Admin
from configure_remember_me import configure, settings
from test_isolated import RegistrationForm

PRIVATE = Path(__file__).resolve().parents[2] / ".local" / "remember-me-acceptance"
PORT = int(os.environ.get("LEARNING_REMEMBER_KEYCLOAK_PORT", "18895"))
CALLBACK_PORT = int(os.environ.get("LEARNING_REMEMBER_CALLBACK_PORT", "18897"))
BASE = f"http://127.0.0.1:{PORT}"
REALM = "learning-remember-isolated"
CLIENT = "learning-remember-test"
ISSUER = BASE + "/realms/" + REALM
CALLBACK = f"http://127.0.0.1:{CALLBACK_PORT}/callback"
SECONDS = 30 * 86400


def protected(path, content):
    path.write_text(content)
    os.chmod(path, 0o600)


def claims(value):
    payload = value.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))


class Callback(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"Synthetic callback")


class Browser:
    def __init__(self, previous=None):
        self.cookies = http.cookiejar.CookieJar(http.cookiejar.DefaultCookiePolicy(secure_protocols=("http", "https")))
        if previous:
            # Browser restart drops session cookies. Only persisted, unexpired
            # cookies are copied; no identity token is created or injected.
            for cookie in previous.cookies:
                if not cookie.discard and not cookie.is_expired():
                    self.cookies.set_cookie(copy.copy(cookie))
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))

    def open(self, request):
        try:
            with self.opener.open(request, timeout=20) as response:
                return response.geturl(), response.read().decode(), response.headers
        except urllib.error.HTTPError as error:
            raise AssertionError(f"Synthetic HTTP request failed with status {error.code}") from None

    def cookie(self, name):
        return next((cookie for cookie in self.cookies if cookie.name == name and not cookie.is_expired()), None)

    def authorize(self, username=None, password=None, remember=False, prompt=None):
        state, nonce, verifier = (secrets.token_urlsafe(32) for _ in range(3))
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
        params = {"client_id": CLIENT, "redirect_uri": CALLBACK, "response_type": "code", "scope": "openid",
                  "state": state, "nonce": nonce, "code_challenge": challenge, "code_challenge_method": "S256"}
        if prompt:
            params["prompt"] = prompt
        url, text, _ = self.open(ISSUER + "/protocol/openid-connect/auth?" + urllib.parse.urlencode(params))
        if username:
            action = RegistrationForm(text, "kc-form-login").action
            assert action and 'name="rememberMe"' in text, "Native Remember Me checkbox is missing"
            fields = {"username": username, "password": password}
            if remember:
                fields["rememberMe"] = "on"
            url, _, _ = self.open(urllib.request.Request(action, data=urllib.parse.urlencode(fields).encode(),
                headers={"Content-Type": "application/x-www-form-urlencoded"}))
        query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
        assert url.startswith(CALLBACK) and query.get("state") == [state], "OIDC callback or state mismatch"
        if "error" in query:
            return {"error": query["error"][0]}
        assert query.get("code"), "No authorization code returned"
        data = urllib.parse.urlencode({"client_id": CLIENT, "grant_type": "authorization_code",
            "code": query["code"][0], "redirect_uri": CALLBACK, "code_verifier": verifier}).encode()
        _, raw, _ = self.open(urllib.request.Request(ISSUER + "/protocol/openid-connect/token", data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"}))
        tokens = json.loads(raw)
        identity = claims(tokens["id_token"])
        assert identity["nonce"] == nonce and identity["iss"] == ISSUER and identity["aud"] == CLIENT
        return tokens


def main():
    PRIVATE.mkdir(parents=True, exist_ok=True)
    os.chmod(PRIVATE, 0o700)
    run = secrets.token_hex(4)
    container = "learning-remember-acceptance-" + run
    password, admin_password = secrets.token_urlsafe(24), secrets.token_urlsafe(30)
    realm_file = PRIVATE / (REALM + "-realm.json")
    env_file = PRIVATE / "synthetic.env"
    protected(realm_file, json.dumps({"realm": REALM, "enabled": True, "sslRequired": "none",
        "rememberMe": False, "ssoSessionIdleTimeout": 1800, "ssoSessionMaxLifespan": 28800,
        "registrationAllowed": False,
        "users": [{"username": "synthetic-member", "enabled": True,
            "email": "synthetic-member@example.test", "firstName": "Synthetic", "lastName": "Member",
            "credentials": [{"type": "password", "value": password, "temporary": False}]}],
        "clients": [{"clientId": CLIENT, "enabled": True, "publicClient": True,
            "standardFlowEnabled": True, "directAccessGrantsEnabled": False, "redirectUris": [CALLBACK],
            "attributes": {"pkce.code.challenge.method": "S256", "post.logout.redirect.uris": CALLBACK}}]}))
    protected(env_file, "KC_BOOTSTRAP_ADMIN_USERNAME=synthetic-admin\nKC_BOOTSTRAP_ADMIN_PASSWORD=" + admin_password +
        "\nKC_HTTP_ENABLED=true\nKC_HOSTNAME_STRICT=false\n")
    callback = ThreadingHTTPServer(("127.0.0.1", CALLBACK_PORT), Callback)
    threading.Thread(target=callback.serve_forever, daemon=True).start()
    cases = []
    started = False
    try:
        subprocess.run(["docker", "run", "-d", "--name", container, "--env-file", str(env_file),
            "-p", f"127.0.0.1:{PORT}:8080", "-v", f"{realm_file}:/opt/keycloak/data/import/{REALM}-realm.json:ro",
            "quay.io/keycloak/keycloak:26.7.3", "start-dev", "--import-realm"], check=True, capture_output=True)
        started = True
        deadline = time.monotonic() + 150
        while True:
            try:
                with urllib.request.urlopen(ISSUER + "/.well-known/openid-configuration", timeout=5):
                    break
            except Exception:
                if time.monotonic() > deadline:
                    raise AssertionError("Disposable Keycloak did not become ready")
                time.sleep(1)
        data = urllib.parse.urlencode({"client_id": "admin-cli", "grant_type": "password",
            "username": "synthetic-admin", "password": admin_password}).encode()
        with urllib.request.urlopen(urllib.request.Request(BASE + "/realms/master/protocol/openid-connect/token",
                data=data, headers={"Content-Type": "application/x-www-form-urlencoded"}), timeout=20) as response:
            token = json.load(response)["access_token"]
        admin = Admin(BASE, REALM, token)
        before = admin.request("GET")
        preview = configure(admin, CLIENT)
        assert preview["applied"] is False and settings(admin.request("GET")) == settings(before)
        cases.append("read-only preview leaves existing Realm untouched")
        backup = PRIVATE / (run + "-before.json")
        applied = configure(admin, CLIENT, apply=True, backup_file=backup)
        assert applied["changed"] and applied["ordinarySessionTimeouts"]["ssoSessionIdleTimeout"] == 1800
        assert applied["ordinarySessionTimeouts"]["ssoSessionMaxLifespan"] == 28800
        assert backup.stat().st_mode & 0o777 == 0o600
        again = configure(admin, CLIENT, apply=True, backup_file=PRIVATE / (run + "-idempotent.json"))
        assert not again["changed"]
        cases.append("only native Remember Me settings become thirty days; ordinary timeouts and flows remain unchanged")
        cases.append("protected recovery files and repeat-apply idempotence")

        ordinary = Browser()
        ordinary.authorize("synthetic-member", password)
        assert ordinary.cookie("KEYCLOAK_IDENTITY").discard
        assert Browser(ordinary).authorize(prompt="none")["error"] == "login_required"
        cases.append("unchecked login uses a session identity cookie; browser restart requires login")

        remembered = Browser()
        original = remembered.authorize("synthetic-member", password, remember=True)
        cookie = remembered.cookie("KEYCLOAK_IDENTITY")
        assert cookie and not cookie.discard and cookie.has_nonstandard_attr("HttpOnly")
        assert SECONDS - 15 <= cookie.expires - time.time() <= SECONDS + 5
        identity = claims(cookie.value)
        assert identity["exp"] - identity["iat"] == SECONDS
        original_claims = claims(original["id_token"])
        original_session = next(session for session in admin.request("GET", "/users/" + original_claims["sub"] + "/sessions")
            if session["id"] == original_claims["sid"])
        cases.append("checked native form creates an HttpOnly persistent identity cookie with a thirty-day expiry")
        restarted = Browser(remembered)
        continued = restarted.authorize(prompt="none")
        assert claims(continued["id_token"])["sub"] == claims(original["id_token"])["sub"]
        continued_claims = claims(continued["id_token"])
        continued_session = next(session for session in admin.request("GET", "/users/" + continued_claims["sub"] + "/sessions")
            if session["id"] == continued_claims["sid"])
        assert continued_session["id"] == original_session["id"] and continued_session["start"] == original_session["start"]
        assert settings(admin.request("GET"))["ssoSessionMaxLifespanRememberMe"] == SECONDS
        cases.append("only persisted cookies survive browser restart and complete prompt=none S256 OIDC without password")
        # Cookie/JWT expiry can be reissued. The authoritative server-side bound
        # is the unchanged session start plus the configured Remember Me max.
        cases.append("SSO reuse retains the same server session and start timestamp under the thirty-day maximum")

        logout = urllib.parse.urlencode({"client_id": CLIENT, "id_token_hint": continued["id_token"],
            "post_logout_redirect_uri": CALLBACK})
        url, _, _ = restarted.open(ISSUER + "/protocol/openid-connect/logout?" + logout)
        assert url == CALLBACK and restarted.cookie("KEYCLOAK_IDENTITY") is None
        assert restarted.authorize(prompt="none")["error"] == "login_required"
        assert Browser(remembered).authorize(prompt="none")["error"] == "login_required"
        cases.append("RP logout clears remembered authentication and revokes even a copied persistent-cookie session")
        restored = configure(admin, CLIENT, apply=True, backup_file=PRIVATE / (run + "-pre-restore.json"), restore_file=backup)
        assert restored["applied"] and settings(admin.request("GET")) == settings(before)
        cases.append("recovery restores only the original three Remember Me settings")
        result = {"passed": True, "identity": "Keycloak 26.7.3", "caseCount": len(cases), "cases": cases}
        protected(PRIVATE / "result.json", json.dumps(result, indent=2) + "\n")
        print(json.dumps(result))
    except Exception:
        if started:
            log = subprocess.run(["docker", "logs", container], capture_output=True, text=True)
            protected(PRIVATE / "failure-keycloak.log", log.stdout + log.stderr)
        raise
    finally:
        if started:
            subprocess.run(["docker", "rm", "-f", container], check=True, capture_output=True)
        callback.shutdown()
        callback.server_close()
        realm_file.unlink(missing_ok=True)
        env_file.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
