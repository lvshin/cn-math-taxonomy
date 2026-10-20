#!/usr/bin/env python3
"""Real remembered-login acceptance in the disposable prepare_joint environment.

Owns only the backend process it starts, always stops that process, and restores
the isolated Realm settings. Never uses production identities or saves cookies,
passwords, codes, tokens or authorization URLs in the result report.
"""
import argparse
import copy
import http.cookiejar
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request

import test_joint as joint
from configure_flow import Admin
from configure_remember_me import configure, settings
from test_isolated import RegistrationForm

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = joint.PRIVATE
RESULT = PRIVATE / "remember-result.json"
CASES = []
STAGE = "initialization"
MARKER = "LEARNING_RETURNING"


def protected(path, value):
    path.write_text(value)
    os.chmod(path, 0o600)


def environment(path):
    return dict(line.split("=", 1) for line in path.read_text().splitlines() if line and not line.startswith("#"))


def admin():
    env = environment(PRIVATE / "keycloak.env")
    issuer = urllib.parse.urlsplit(joint.ACTORS["issuer"])
    base = urllib.parse.urlunsplit((issuer.scheme, issuer.netloc, "", "", ""))
    realm = issuer.path.rsplit("/", 1)[1]
    payload = urllib.parse.urlencode({"client_id": "admin-cli", "grant_type": "password",
        "username": env["KC_BOOTSTRAP_ADMIN_USERNAME"], "password": env["KC_BOOTSTRAP_ADMIN_PASSWORD"]}).encode()
    request = urllib.request.Request(base + "/realms/master/protocol/openid-connect/token", data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(request, timeout=15) as response:
        token = json.load(response)["access_token"]
    return Admin(base, realm, token)


class Backend:
    def __init__(self):
        self.process = None
        self.log = None
        self.env = environment(PRIVATE / "backend.env")
        assert self.env["OIDC_ISSUER"].startswith("http://127.0.0.1:") and self.env["OIDC_ISSUER"].endswith("/realms/learning-joint")
        assert self.env["DB_URL"].startswith("jdbc:postgresql://127.0.0.1:"), "Only a local disposable PostgreSQL database is allowed"
        self.port = int(self.env["PORT"])

    def start(self):
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", self.port)) == 0:
                raise RuntimeError("Application test port already belongs to another process")
        self.log = open(PRIVATE / "remember-backend.log", "ab")
        os.chmod(PRIVATE / "remember-backend.log", 0o600)
        self.process = subprocess.Popen(["java", "-jar", str(ROOT / "server/target/family-learning-server.jar")],
            cwd=ROOT, env={**os.environ, **self.env}, stdout=self.log, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + 75
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError("Own backend process exited; inspect the protected log")
            try:
                with urllib.request.urlopen(joint.APP + "/readyz", timeout=3) as response:
                    if response.status == 200:
                        return
            except Exception:
                time.sleep(0.2)
        raise RuntimeError("Own backend readiness timed out")

    def stop(self):
        if self.process is not None:
            if self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=5)
            self.process = None
        if self.log is not None:
            self.log.close()
            self.log = None


def clone(browser, persistent_only=True):
    closed = joint.Browser()
    for cookie in browser.cookies:
        if cookie.name != "LEARNING_SESSION" and (not persistent_only or not cookie.discard):
            closed.cookies.set_cookie(copy.copy(cookie))
    return closed


def marker(browser):
    return next((cookie for cookie in browser.cookies if cookie.name == MARKER), None)


def login(remember, browser=None):
    browser = browser or joint.Browser()
    status, _, page, _ = browser.open(joint.APP + "/oauth2/authorization/learning")
    if status != 200 or 'name="rememberMe"' not in page:
        protected(PRIVATE / "remember-login-failure.html", page)
        raise AssertionError("Native Keycloak Remember Me checkbox is unavailable; inspect protected HTML")
    action = RegistrationForm(page, "kc-form-login").action
    assert action, "Native login form is unavailable"
    fields = {"username": joint.ACTORS["operator"]["username"], "password": joint.ACTORS["operator"]["password"]}
    if remember:
        fields["rememberMe"] = "on"
    browser.form(action, fields)
    browser.api("me")
    return browser


def restore(browser, success):
    browser.api("me", expected=401)
    status, _, body, headers = browser.open(joint.API + "capabilities")
    assert status == 200 and headers.get("Cache-Control") == "no-store" and "Cookie" in headers.get("Vary", "")
    cap = json.loads(body)
    assert cap["sessionRestoreUrl"] == "oauth2/authorization/learning?restore=1"
    start = len(browser.redirects.urls)
    browser.open(urllib.parse.urljoin(joint.APP + "/", cap["sessionRestoreUrl"]))
    redirects = browser.redirects.urls[start:]
    authorizations = [urllib.parse.parse_qs(urllib.parse.urlsplit(url).query) for url in redirects
                      if "/protocol/openid-connect/auth?" in url]
    assert authorizations and authorizations[0].get("prompt") == ["none"]
    assert all(authorizations[0].get(key) for key in ("state", "nonce", "code_challenge"))
    assert authorizations[0].get("code_challenge_method") == ["S256"]
    callbacks = [urllib.parse.parse_qs(urllib.parse.urlsplit(url).query) for url in redirects
                 if "/login/oauth2/code/learning?" in url]
    assert callbacks and callbacks[-1].get("state") == authorizations[0]["state"]
    if success:
        assert callbacks[-1].get("code") and not callbacks[-1].get("error")
        assert browser.api("me")["operator"] is True
    else:
        assert callbacks[-1].get("error"), "Identity server unexpectedly authenticated an expired or absent SSO"
        browser.api("me", expected=401)
        assert marker(browser) is None
        assert "sessionRestoreUrl" not in browser.api("capabilities")


def run(skip_original=False, skip_opt_in=False):
    global STAGE
    backend = Backend()
    backup = PRIVATE / ("remember-settings-before-" + str(time.time_ns()) + ".json")
    before = settings(admin().request("GET"))
    try:
        STAGE = "thirty-day isolated identity policy"
        configured = configure(admin(), backend.env["OIDC_CLIENT_ID"], days=30, apply=True, backup_file=backup)
        assert configured["applied"] and configured["requested"] == {
            "rememberMe": True, "ssoSessionIdleTimeoutRememberMe": 2592000, "ssoSessionMaxLifespanRememberMe": 2592000}
        CASES.append("isolated Realm Remember Me idle/max are exactly thirty days, ordinary timeouts and clients preserved")
        backend.start()
        if not skip_original:
            STAGE = "existing real database and OIDC regression"
            joint.main()

        STAGE = "persistent noncredential marker and normal browser close"
        ordinary = login(False)
        hint = marker(ordinary)
        assert hint and hint.value == "1" and hint.secure and hint.has_nonstandard_attr("HttpOnly")
        assert hint.get_nonstandard_attr("SameSite") == "Lax" and not hint.domain_specified and hint.path == "/edu/math"
        assert hint.expires and abs(hint.expires - time.time() - 2592000) < 10
        assert all(cookie.discard for cookie in ordinary.cookies if cookie.name == "LEARNING_SESSION")
        CASES.append("real callback sets thirty-day host-only Secure HttpOnly SameSite=Lax noncredential marker; app session remains nonpersistent")
        restore(clone(ordinary), False)
        CASES.append("unchecked Remember Me loses session cookies on browser close; silent OIDC fails, clears marker and offers no retry loop")

        STAGE = "remembered browser close"
        remembered = login(True)
        closed = clone(remembered)
        identity_cookie = next((cookie for cookie in closed.cookies if cookie.name == "KEYCLOAK_IDENTITY"), None)
        assert identity_cookie and not identity_cookie.discard and identity_cookie.expires
        assert abs(identity_cookie.expires - time.time() - 2592000) < 60
        restore(closed, True)
        CASES.append("checked Remember Me survives loss of every browser-session cookie; real OIDC restores app with state/nonce/S256 and no password")

        if not skip_opt_in:
            STAGE = "explicit one-time logout then native remembered login"
            token = ordinary.api("csrf")
            ordinary.open(urllib.request.Request(joint.APP + "/logout", data=b"", method="POST",
                headers={token["headerName"]: token["token"]}))
            ordinary.api("me", expected=401)
            assert marker(ordinary) is None
            opted_in = login(True, browser=ordinary)
            restore(clone(opted_in), True)
            CASES.append("existing user explicitly signs out with CSRF then opts into native Remember Me on a fresh login; browser-close restore succeeds")

        STAGE = "own backend restart and remembered recovery"
        backend.stop()
        backend.start()
        restore(remembered, True)
        CASES.append("own backend restart loses in-memory app sessions; remembered identity restores a new app session without password")

        STAGE = "forged noncredential marker and CSRF"
        forged = joint.Browser()
        forged.cookies.set_cookie(copy.copy(marker(remembered)))
        forged.api("families", "POST", {"name": "No bypass"}, expected=403, csrf=False)
        forged.api("families", "POST", {"name": "No bypass"}, expected=401)
        restore(forged, False)
        CASES.append("forged marker cannot authenticate, authorize writes or bypass CSRF; real OIDC rejects absent identity")

        STAGE = "wrong OAuth state"
        invalid = joint.Browser()
        invalid.cookies.set_cookie(copy.copy(marker(remembered)))
        invalid.open(joint.APP + "/oauth2/authorization/learning?restore=1")
        invalid.open(joint.APP + "/login/oauth2/code/learning?state=invalid&code=invalid")
        invalid.api("me", expected=401)
        assert marker(invalid) is None
        CASES.append("unrelated OAuth callback state establishes no identity and clears the returning marker")

        STAGE = "RP and signed backchannel logout with old-cookie replay"
        shadow = clone(remembered)
        restore(shadow, True)
        replay = clone(remembered)
        csrf = remembered.api("csrf")
        remembered.open(urllib.request.Request(joint.APP + "/logout", data=b"", method="POST",
            headers={csrf["headerName"]: csrf["token"]}))
        assert marker(remembered) is None
        remembered.api("me", expected=401)
        deadline = time.monotonic() + 8
        while shadow.open(joint.API + "me")[0] != 401:
            assert time.monotonic() < deadline, "Signed backchannel did not revoke the second app session"
            time.sleep(0.2)
        restore(replay, False)
        CASES.append("RP logout clears marker and global remembered SSO; signed backchannel revokes second app session; copied old SSO cannot restore")

        STAGE = "actual server expiration with retained stale identity cookies"
        admin().request("PUT", "", {"ssoSessionIdleTimeoutRememberMe": 3, "ssoSessionMaxLifespanRememberMe": 3})
        expiring = login(True)
        stale = clone(expiring)
        for cookie in stale.cookies:
            if cookie.name.startswith("KEYCLOAK_"):
                cookie.expires = int(time.time()) + 300
        time.sleep(4)
        restore(stale, False)
        CASES.append("real Keycloak remembered maximum lifespan expiration rejects retained stale cookies; app clears marker and remains unauthenticated")
    finally:
        backend.stop()
        if backup.exists():
            admin().request("PUT", "", before)
            assert settings(admin().request("GET")) == before, "Isolated identity Remember Me settings were not restored"

    result = {"passed": True, "identity": "Keycloak 26.7.3", "database": "PostgreSQL 18", "caseCount": len(CASES),
        "originalJointCaseCount": 0 if skip_original else len(joint.CASES), "cases": CASES,
        "optInSkipped": skip_opt_in,
        "scope": "Synthetic loopback only; policy/cookie expiry inspected; no thirty-day wall-clock claim"}
    protected(RESULT, json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-original", action="store_true", help="Skip the existing twelve-case joint regression")
    parser.add_argument("--skip-opt-in", action="store_true", help="Run restoration checks without the explicit logout/login opt-in check")
    args = parser.parse_args()
    try:
        run(args.skip_original, args.skip_opt_in)
    except Exception:
        protected(RESULT, json.dumps({"passed": False, "stage": STAGE, "completedCaseCount": len(CASES), "cases": CASES}) + "\n")
        print("Remember Me joint acceptance failed at: " + STAGE + ". Inspect protected local logs.", file=sys.stderr)
        raise
