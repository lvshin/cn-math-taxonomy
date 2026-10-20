#!/usr/bin/env python3
"""Real Keycloak 26.7.3 registration acceptance with synthetic identities only.

Starts a disposable H2-backed container on loopback, with a mock private backend.
Never reads existing identity-service configuration, credentials, Realm or users.
"""
import http.cookiejar
import base64
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT.parent / ".local" / "identity-provider-acceptance"
KC_PORT = int(os.environ.get("LEARNING_TEST_KEYCLOAK_PORT", "18885"))
BACKEND_PORT = int(os.environ.get("LEARNING_TEST_GATEWAY_PORT", "18886"))
CALLBACK_PORT = int(os.environ.get("LEARNING_TEST_CALLBACK_PORT", "18887"))
BASE = f"http://127.0.0.1:{KC_PORT}"
CALLBACK = f"http://127.0.0.1:{CALLBACK_PORT}/callback"
REALM = "learning-isolated"
CLIENT = "learning-test"
KEY = secrets.token_urlsafe(36)
PASSWORD = secrets.token_urlsafe(24)
CONTAINER = "learning-invitation-acceptance-" + secrets.token_hex(4)
GRANTS = {name: secrets.token_urlsafe(36) for name in ("valid", "retry", "expired", "revoked", "unavailable", "bind-failure", "bind-dropped", "wrong-client")}
RESERVATIONS = {}
BINDS = {}
CALLS = []
DROPPED = set()
IDENTITY_ADMIN = None
COMMITTED_IDENTITIES = set()


def http_json(url, data=None, headers=None, method=None):
    payload = None if data is None else json.dumps(data).encode()
    request = urllib.request.Request(url, data=payload,
        headers={"Content-Type": "application/json", **(headers or {})}, method=method)
    with urllib.request.urlopen(request, timeout=10) as response:
        body = response.read()
        return json.loads(body) if body else None


class Gateway(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        if self.headers.get("X-Registration-Key") != KEY:
            self.send_error(403); return
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        CALLS.append((self.path, body))
        status = 200
        result = {}
        if self.path.endswith("/reserve"):
            name = next((name for name, value in GRANTS.items() if value == body.get("grant")), None)
            if name in (None, "expired", "revoked"):
                status = 410
            elif name == "unavailable":
                status = 503
            else:
                existing = RESERVATIONS.get(body["grant"])
                identity = (body["clientId"], body["authSessionId"], body["username"])
                if existing and existing[1] != identity:
                    status = 409
                else:
                    reservation = existing[0] if existing else secrets.token_urlsafe(24)
                    RESERVATIONS[body["grant"]] = (reservation, identity)
                    result = {"reservationId": reservation}
        elif self.path.endswith("/bind"):
            # A separate Keycloak admin transaction must already see the identity at bind time.
            # This would fail for the former pre-commit bind design.
            try:
                committed = IDENTITY_ADMIN.request("GET", "/users/" + urllib.parse.quote(body["subject"]))
                assert committed["id"] == body["subject"]
                COMMITTED_IDENTITIES.add(body["subject"])
            except Exception:
                self.send_error(409); return
            item = next(((grant, data) for grant, data in RESERVATIONS.items()
                         if data[0] == body.get("reservationId")), None)
            if item is None:
                status = 404
            elif item[0] == GRANTS["bind-failure"] and item[0] not in DROPPED:
                DROPPED.add(item[0])
                status = 503
            else:
                grant, (_, identity) = item
                if identity[:2] != (body["clientId"], body["authSessionId"]):
                    status = 409
                else:
                    BINDS[grant] = body
                    if grant == GRANTS["bind-dropped"] and grant not in DROPPED:
                        # Commit business state, then lose the HTTP response on the wire.
                        DROPPED.add(grant)
                        self.connection.shutdown(socket.SHUT_RDWR)
                        self.connection.close()
                        return
        else:
            status = 404
        raw = json.dumps(result).encode()
        self.send_response(status); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)


class Callback(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b"Synthetic registration callback")


class RegistrationForm(HTMLParser):
    def __init__(self, text, form_id="kc-register-form"):
        super().__init__(convert_charrefs=True)
        self.action = None
        self.form_id = form_id
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "form" and attrs.get("id") == self.form_id:
            self.action = attrs.get("action")


def open_page(opener, request):
    try:
        with opener.open(request, timeout=15) as response:
            return response.geturl(), response.read().decode(), response.status
    except urllib.error.HTTPError as error:
        return error.geturl(), error.read().decode(), error.code


def form_session(grant=None, client=CLIENT):
    # Browsers treat loopback as a trustworthy context and send Secure cookies there.
    # urllib does not; emulate that only for this fixed loopback synthetic server.
    jar = http.cookiejar.CookieJar(http.cookiejar.DefaultCookiePolicy(secure_protocols=("http", "https")))
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    params = {"client_id": client, "response_type": "code", "scope": "openid", "redirect_uri": CALLBACK,
              "state": secrets.token_urlsafe(20), "nonce": secrets.token_urlsafe(20)}
    if grant:
        params["invite_grant"] = grant
    _, text, _ = open_page(opener, BASE + f"/realms/{REALM}/protocol/openid-connect/registrations?" + urllib.parse.urlencode(params))
    action = RegistrationForm(text).action
    if not any(cookie.name == "AUTH_SESSION_ID" for cookie in jar):
        raise AssertionError("Synthetic realm did not issue an authentication-session cookie")
    return opener, action


def submit(opener, action, username, confirm=True):
    assert action, "Registration form unavailable"
    payload = urllib.parse.urlencode({"username": username, "email": username + "@example.test",
        "firstName": "Synthetic", "lastName": "Acceptance", "password": PASSWORD,
        "password-confirm": PASSWORD if confirm else "different-password"}).encode()
    return open_page(opener, urllib.request.Request(action, data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"}))


def id_claims_from_callback(url, client=CLIENT):
    code = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["code"][0]
    data = urllib.parse.urlencode({"client_id": client, "grant_type": "authorization_code",
        "redirect_uri": CALLBACK, "code": code}).encode()
    with urllib.request.urlopen(urllib.request.Request(BASE + f"/realms/{REALM}/protocol/openid-connect/token",
            data=data, headers={"Content-Type": "application/x-www-form-urlencoded"}), timeout=15) as response:
        token = json.load(response)["id_token"]
    decode = lambda value: base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    return json.loads(decode(token.split(".")[1]))


def receipt_from_callback(url):
    claim = id_claims_from_callback(url)["learning_registration_receipt"]
    decode = lambda value: base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    payload, signature = claim.split(".")
    assert hmac.compare_digest(hmac.digest(KEY.encode(), payload.encode("ascii"), hashlib.sha256), decode(signature))
    result = json.loads(decode(payload))
    assert result["v"] == 1 and result["clientId"] == CLIENT
    return result


def main():
    global IDENTITY_ADMIN
    PRIVATE.mkdir(parents=True, exist_ok=True)
    os.chmod(PRIVATE, 0o700)
    jar = ROOT / "target" / "learning-invitation-provider-1.0.0.jar"
    if not jar.exists():
        raise RuntimeError("Build the provider with mvn package before running acceptance")
    realm_file = PRIVATE / (REALM + "-realm.json")
    realm_file.write_text(json.dumps({"realm": REALM, "enabled": True, "registrationAllowed": False,
        "sslRequired": "none", "registrationEmailAsUsername": False, "duplicateEmailsAllowed": False,
        "users": [{"username": "existing-member", "enabled": True, "email": "existing@example.test",
                   "firstName": "Existing", "lastName": "Member",
                   "credentials": [{"type": "password", "value": PASSWORD, "temporary": False}]}],
        "clients": [{"clientId": client, "enabled": True, "publicClient": True,
                     "standardFlowEnabled": True, "directAccessGrantsEnabled": False,
                     "redirectUris": [CALLBACK]} for client in (CLIENT, "other-test-client")]}))
    os.chmod(realm_file, 0o600)
    admin_password = secrets.token_urlsafe(30)
    envfile = PRIVATE / "synthetic.env"
    envfile.write_text("\n".join(["KC_BOOTSTRAP_ADMIN_USERNAME=synthetic-admin",
        "KC_BOOTSTRAP_ADMIN_PASSWORD=" + admin_password, "LEARNING_REGISTRATION_CLIENT_ID=" + CLIENT,
        "LEARNING_REGISTRATION_BACKEND_URL=http://host.docker.internal:" + str(BACKEND_PORT),
        "LEARNING_REGISTRATION_KEY=" + KEY, "KC_HTTP_ENABLED=true", "KC_HOSTNAME_STRICT=false"]) + "\n")
    os.chmod(envfile, 0o600)
    gateway = ThreadingHTTPServer(("0.0.0.0", BACKEND_PORT), Gateway)
    callback = ThreadingHTTPServer(("127.0.0.1", CALLBACK_PORT), Callback)
    for server in (gateway, callback):
        threading.Thread(target=server.serve_forever, daemon=True).start()
    cases = []
    try:
        subprocess.run(["docker", "run", "-d", "--name", CONTAINER, "--env-file", str(envfile),
            "-p", f"127.0.0.1:{KC_PORT}:8080", "-v", f"{jar}:/opt/keycloak/providers/learning-invitation-provider.jar:ro",
            "-v", f"{realm_file}:/opt/keycloak/data/import/{REALM}-realm.json:ro",
            "quay.io/keycloak/keycloak:26.7.3", "start-dev", "--import-realm"], check=True, capture_output=True)
        deadline = time.monotonic() + 150
        while True:
            try:
                http_json(BASE + f"/realms/{REALM}/.well-known/openid-configuration"); break
            except Exception:
                if time.monotonic() > deadline:
                    raise RuntimeError("Synthetic Keycloak did not become ready")
                time.sleep(1)
        credentials = urllib.parse.urlencode({"client_id": "admin-cli", "username": "synthetic-admin",
            "password": admin_password, "grant_type": "password"}).encode()
        with urllib.request.urlopen(urllib.request.Request(BASE + "/realms/master/protocol/openid-connect/token",
                data=credentials, headers={"Content-Type": "application/x-www-form-urlencoded"}), timeout=15) as response:
            admin_token = json.load(response)["access_token"]
        spec = importlib.util.spec_from_file_location("configure_flow", ROOT / "scripts" / "configure_flow.py")
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        admin = module.Admin(BASE, REALM, admin_token)
        IDENTITY_ADMIN = admin
        before = module.configure(admin, CLIENT)
        assert before["registrationAllowed"] is False and before["changed"] is False
        module.configure(admin, CLIENT, apply=True, enable=True)
        repeated = module.configure(admin, CLIENT, apply=True, enable=True)
        assert repeated["gateLast"] and repeated["gateRequired"]
        cases.append("provider discovery, additive copied flow, REQUIRED final gate, repeat configuration")

        def users(name):
            return admin.request("GET", "/users?exact=true&username=" + urllib.parse.quote(name))

        for name, grant, client in (("missing", None, CLIENT), ("wrong-client", GRANTS["wrong-client"], "other-test-client"),
                ("expired", GRANTS["expired"], CLIENT), ("revoked", GRANTS["revoked"], CLIENT),
                ("unavailable", GRANTS["unavailable"], CLIENT)):
            opener, action = form_session(grant, client)
            url, _, _ = submit(opener, action, "synthetic-" + name)
            assert not url.startswith(CALLBACK), name + " unexpectedly received an OIDC code"
            assert users("synthetic-" + name) == [], name + " unexpectedly created an account"
            cases.append(name + " rejected without an account or OIDC code")

        opener, action = form_session(GRANTS["valid"])
        url, _, _ = submit(opener, action, "synthetic-valid")
        assert url.startswith(CALLBACK) and "code=" in url, "Valid invitation did not complete OIDC"
        user = users("synthetic-valid")
        assert len(user) == 1 and BINDS[GRANTS["valid"]]["subject"] == user[0]["id"]
        assert BINDS[GRANTS["valid"]]["issuer"] == BASE + "/realms/" + REALM
        proof = receipt_from_callback(url)
        assert proof["subject"] == user[0]["id"]
        cases.append("valid invite creates identity, binds issuer/sub, returns OIDC authorization code")

        for name in ("bind-failure", "bind-dropped"):
            opener, action = form_session(GRANTS[name])
            url, _, _ = submit(opener, action, "synthetic-" + name)
            assert url.startswith(CALLBACK) and "code=" in url
            user = users("synthetic-" + name)
            assert len(user) == 1 and GRANTS[name] in DROPPED
            proof = receipt_from_callback(url)
            assert proof["subject"] == user[0]["id"]
            body = {key: proof[key] for key in ("reservationId", "clientId", "authSessionId", "issuer", "subject")}
            http_json(f"http://127.0.0.1:{BACKEND_PORT}/internal/registration/bind", body,
                      {"X-Registration-Key": KEY})
            assert BINDS[GRANTS[name]]["subject"] == user[0]["id"]
            cases.append(name + " retains committed identity and verifiable receipt; same-subject retry completes binding")

        opener, action = form_session(GRANTS["valid"])
        url, _, _ = submit(opener, action, "synthetic-reuse")
        assert not url.startswith(CALLBACK) and users("synthetic-reuse") == []
        cases.append("same grant cannot create a second identity from a new authentication session")

        opener, action = form_session(GRANTS["retry"])
        _, text, _ = submit(opener, action, "synthetic-retry", confirm=False)
        assert users("synthetic-retry") == []
        retry_action = RegistrationForm(text).action
        url, _, _ = submit(opener, retry_action, "synthetic-retry")
        assert url.startswith(CALLBACK) and len(users("synthetic-retry")) == 1
        retry_calls = [body for path, body in CALLS if path.endswith("/reserve") and body.get("grant") == GRANTS["retry"]]
        assert len(retry_calls) == 2 and retry_calls[0] == retry_calls[1]
        cases.append("form correction reuses server session grant and idempotent reservation")
        assert not any(body.get("clientId") == "other-test-client" for _, body in CALLS)
        assert not any("password" in body for _, body in CALLS)
        cases.append("other client never reaches gateway; no passwords in private callbacks")
        assert set(value["subject"] for value in BINDS.values()).issubset(COMMITTED_IDENTITIES)
        cases.append("separate identity transaction sees every subject before the first external binding attempt")

        # Binding the copied registration flow does not replace the shared browser/login flow.
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(
            http.cookiejar.CookieJar(http.cookiejar.DefaultCookiePolicy(secure_protocols=("http", "https")))))
        params = {"client_id": "other-test-client", "response_type": "code", "scope": "openid",
                  "redirect_uri": CALLBACK, "state": secrets.token_urlsafe(20), "nonce": secrets.token_urlsafe(20)}
        _, text, _ = open_page(opener, BASE + f"/realms/{REALM}/protocol/openid-connect/auth?" + urllib.parse.urlencode(params))
        action = RegistrationForm(text, "kc-form-login").action
        payload = urllib.parse.urlencode({"username": "existing-member", "password": PASSWORD}).encode()
        url, _, _ = open_page(opener, urllib.request.Request(action, data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"}))
        assert url.startswith(CALLBACK) and "code=" in url
        cases.append("existing identity still signs in normally through another client without an invitation")
        # Even the newly registered user carrying a receipt must not expose it to a different client.
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(
            http.cookiejar.CookieJar(http.cookiejar.DefaultCookiePolicy(secure_protocols=("http", "https")))))
        _, text, _ = open_page(opener, BASE + f"/realms/{REALM}/protocol/openid-connect/auth?" + urllib.parse.urlencode(params))
        action = RegistrationForm(text, "kc-form-login").action
        payload = urllib.parse.urlencode({"username": "synthetic-valid", "password": PASSWORD}).encode()
        url, _, _ = open_page(opener, urllib.request.Request(action, data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"}))
        assert "learning_registration_receipt" not in id_claims_from_callback(url, "other-test-client")
        cases.append("registration receipt is absent from ID tokens issued to another client")
        (PRIVATE / "result.json").write_text(json.dumps({"passed": True, "keycloak": "26.7.3", "cases": cases}, indent=2))
        print(json.dumps({"passed": True, "keycloak": "26.7.3", "caseCount": len(cases), "cases": cases}))
    finally:
        logs = subprocess.run(["docker", "logs", CONTAINER], capture_output=True)
        (PRIVATE / "keycloak.log").write_bytes(logs.stdout + logs.stderr)
        os.chmod(PRIVATE / "keycloak.log", 0o600)
        subprocess.run(["docker", "rm", "-f", CONTAINER], capture_output=True)
        gateway.shutdown(); callback.shutdown()
        # Synthetic credentials are short-lived and not retained after the test.
        envfile.unlink(missing_ok=True)
        realm_file.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
