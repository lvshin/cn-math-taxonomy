#!/usr/bin/env python3
"""HTTP/OIDC acceptance against the disposable identity and a real backend + PG18.

First prepare_joint.py, then start the backend with the protected backend.env.
No mocked OAuth principal or mocked registration callback is used here.
"""
import http.cookiejar
import copy
import json
import os
from pathlib import Path
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from test_isolated import RegistrationForm

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT.parent / ".local" / "identity-provider-joint"
ACTORS = json.loads((PRIVATE / "actors.json").read_text())
APP = ACTORS["application"]
API = APP + "/api/v1/"
CASES = []
STAGE = "start"


def fault(operation, data):
    env = dict(line.split("=", 1) for line in (PRIVATE / "backend.env").read_text().splitlines())
    port = json.loads((PRIVATE / "state.json").read_text())["proxyPort"]
    request = urllib.request.Request(f"http://127.0.0.1:{port}/__fault/" + operation,
        data=json.dumps(data).encode(), headers={"Content-Type": "application/json", "X-Registration-Key": env["REGISTRATION_KEY"]})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


class Redirects(urllib.request.HTTPRedirectHandler):
    def __init__(self):
        self.urls = []

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.urls.append(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Browser:
    def __init__(self):
        # Fixed disposable loopback environment only; mirrors browser localhost cookie handling.
        self.cookies = http.cookiejar.CookieJar(http.cookiejar.DefaultCookiePolicy(secure_protocols=("http", "https")))
        self.redirects = Redirects()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies), self.redirects)

    def open(self, request):
        try:
            with self.opener.open(request, timeout=20) as response:
                return response.status, response.geturl(), response.read().decode(), response.headers
        except urllib.error.HTTPError as error:
            return error.code, error.geturl(), error.read().decode(), error.headers

    def api(self, path, method="GET", data=None, expected=200, csrf=True):
        headers = {"Accept": "application/json"}
        body = None if data is None else json.dumps(data).encode()
        if body is not None:
            headers["Content-Type"] = "application/json"
        if method != "GET" and csrf:
            token = self.api("csrf")
            headers[token["headerName"]] = token["token"]
        status, _, text, _ = self.open(urllib.request.Request(API + path, data=body, headers=headers, method=method))
        if status != expected:
            (PRIVATE / "failure-response.txt").write_text(text)
            os.chmod(PRIVATE / "failure-response.txt", 0o600)
            raise AssertionError(f"{method} {path.split('?')[0]} expected {expected}, received {status}")
        return json.loads(text) if text else None

    def login(self, username, password):
        _, _, page, _ = self.open(APP + "/oauth2/authorization/learning")
        action = RegistrationForm(page, "kc-form-login").action
        assert action, "Normal login form is unavailable"
        self.form(action, {"username": username, "password": password})
        return self.api("me")

    def register(self, registration_url, username, password):
        _, _, page, _ = self.open(urllib.parse.urljoin(APP + "/", registration_url))
        action = RegistrationForm(page).action
        assert action, "Invited registration form is unavailable"
        request = next((urllib.parse.urlparse(url) for url in self.redirects.urls if "/registrations?" in url), None)
        assert request, "App did not enter the registration endpoint"
        params = urllib.parse.parse_qs(request.query)
        assert all(params.get(key) for key in ("state", "nonce", "invite_grant")), "OIDC safety parameters are missing"
        assert params.get("code_challenge_method") == ["S256"] and params.get("code_challenge"), "PKCE S256 parameters are missing"
        self.form(action, {"username": username, "email": username + "@example.test", "firstName": "Synthetic",
            "lastName": "Member", "password": password, "password-confirm": password})
        callbacks = [urllib.parse.parse_qs(urllib.parse.urlparse(url).query) for url in self.redirects.urls
                     if "/login/oauth2/code/learning?" in url]
        assert callbacks and callbacks[-1].get("code") and callbacks[-1].get("state") == params["state"]
        # A successful authenticated API proves the real authorization-code exchange and ID-token checks completed.
        return self.api("me")

    def form(self, action, fields):
        return self.open(urllib.request.Request(action, data=urllib.parse.urlencode(fields).encode(),
            headers={"Content-Type": "application/x-www-form-urlencoded"}))


def main():
    global STAGE
    anonymous = Browser()
    STAGE = "unauthenticated API and CSRF"
    anonymous.api("me", expected=401)
    anonymous.api("families", "POST", {"name": "No CSRF"}, expected=403, csrf=False)
    CASES.append("unauthenticated API rejects access and missing CSRF rejects writes")

    operator = Browser()
    STAGE = "existing operator normal OIDC login"
    me = operator.login(ACTORS["operator"]["username"], ACTORS["operator"]["password"])
    assert me["operator"] is True
    assert all(cookie.secure and cookie.has_nonstandard_attr("HttpOnly") for cookie in operator.cookies
               if cookie.name == "LEARNING_SESSION")
    CASES.append("existing identity completes real OIDC login using Secure HttpOnly application cookie")

    STAGE = "onboarding grant and controlled account registration"
    invite = operator.api("operator/invitations", "POST", {})
    assert anonymous.api("invitations/preview", "POST", {"token": invite["token"]})["kind"] == "ONBOARDING"
    grant = anonymous.api("invitations/registration-grant", "POST", {"token": invite["token"]})
    member = Browser()
    username = "joint-owner-" + secrets.token_hex(4)
    fault("arm", {"mode": "fail-before-bind"})
    member.register(grant["registrationUrl"], username, ACTORS["newMemberPassword"])
    assert fault("stats", {})["failedBefore"] == 1
    assert member.api("families") == []
    member.api("families", "POST", {"name": "Premature family"}, expected=403)
    operator.api("invitations/accept", "POST", {"token": invite["token"]}, expected=409)
    CASES.append("grant preserves state/nonce and PKCE S256, real registration binds identity, no business access before explicit acceptance")
    CASES.append("bind fails before reaching backend; verified OIDC receipt resumes real PostgreSQL binding")

    STAGE = "explicit invitation acceptance and family creation"
    accepted = member.api("invitations/accept", "POST", {"token": invite["token"]})
    assert accepted["accepted"] and accepted["canCreateFamily"]
    assert member.api("invitations/accept", "POST", {"token": invite["token"]}) == accepted
    family = member.api("families", "POST", {"name": "Joint acceptance family"})
    first = member.api(f"families/{family['id']}/children", "POST", {"nickname": "Synthetic child A", "stage": "preschool"})
    second = member.api(f"families/{family['id']}/children", "POST", {"nickname": "Synthetic child B", "stage": "primary"})
    assert first["id"] != second["id"]
    CASES.append("explicit acceptance is idempotent and enables independent family and child creation")

    STAGE = "operator isolation and child-specific history"
    operator.api(f"families/{family['id']}/children", expected=404)
    activity = member.api("activities")[0]
    observation = {"id": str(uuid.uuid4()), "activityId": activity["id"], "activityVersion": activity["version"],
        "outcome": "PROMPTED", "note": "Synthetic acceptance only", "occurredAt": "2026-01-01T12:00:00Z"}
    path = f"families/{family['id']}/children/{first['id']}/observations"
    member.api(path, "POST", observation)
    member.api(path, "POST", observation)
    assert len(member.api(f"families/{family['id']}/children/{first['id']}/history")["items"]) == 1
    assert member.api(f"families/{family['id']}/children/{second['id']}/history")["items"] == []
    CASES.append("operator has no automatic family access; idempotent observation history is isolated per child")

    STAGE = "preschool records share profiles while keeping separate histories"
    preschool = member.api("preschool/activities")[0]
    preschool_path = f"families/{family['id']}/children/{first['id']}/preschool"
    preschool_record = {"id": str(uuid.uuid4()), "activityId": preschool["id"], "activityVersion": preschool["version"],
        "outcome": "TOGETHER", "note": "Synthetic preschool acceptance only", "occurredAt": "2026-01-02T12:00:00Z"}
    member.api(preschool_path + "/observations", "POST", preschool_record, expected=403, csrf=False)
    saved = member.api(preschool_path + "/observations", "POST", preschool_record)
    assert member.api(preschool_path + "/observations", "POST", preschool_record)["id"] == saved["id"]
    assert saved["activitySnapshot"]["module"] == "PRESCHOOL"
    assert len(member.api(preschool_path + "/history")["items"]) == 1
    assert len(member.api(f"families/{family['id']}/children/{first['id']}/history")["items"]) == 1
    assert member.api(f"families/{family['id']}/children/{second['id']}/preschool/history")["items"] == []
    operator.api(preschool_path + "/history", expected=404)
    anonymous.api(preschool_path + "/history", expected=401)
    CASES.append("real identity shares family and child profiles; preschool records require CSRF and stay separate from math and other children")

    STAGE = "preschool SSO callback keeps the same identity and fixed module destination"
    preschool_browser = Browser()
    for cookie in member.cookies:
        if not cookie.name.startswith("LEARNING_"):
            preschool_browser.cookies.set_cookie(copy.copy(cookie))
    preschool_browser.open(APP + "/oauth2/authorization/learning?module=preschool")
    # The disposable backend has no external edge prefix; reaching that fixed target
    # and an authenticated API validates the real code exchange before deployment.
    assert any(urllib.parse.urlsplit(url).path == "/edu/kindergarten/" for url in preschool_browser.redirects.urls)
    assert preschool_browser.api("me")["id"] == member.api("me")["id"]
    CASES.append("real Keycloak SSO code exchange returns preschool login to the fixed kindergarten entry with the same adult identity")

    STAGE = "family invitation registration and explicit viewer membership"
    family_invite = member.api(f"families/{family['id']}/invitations", "POST", {"role": "VIEWER"})
    another = Browser()
    next_grant = another.api("invitations/registration-grant", "POST", {"token": family_invite["token"]})
    fault("arm", {"mode": "drop-after-commit"})
    another.register(next_grant["registrationUrl"], "joint-viewer-" + secrets.token_hex(4), ACTORS["newMemberPassword"])
    assert fault("stats", {})["committedResponseDropped"] == 1
    CASES.append("real backend commits bind then loses HTTP response; committed identity and receipt continue idempotently")
    another.api(f"families/{family['id']}/children", expected=404)
    another.api("invitations/accept", "POST", {"token": family_invite["token"]})
    assert len(another.api(f"families/{family['id']}/children")) == 2
    another.api(path, "POST", {**observation, "id": str(uuid.uuid4())}, expected=403)
    CASES.append("new family invitee remains isolated until accept, then receives read-only access to both children")

    STAGE = "invalid OAuth callback state"
    invalid = Browser()
    invalid.open(APP + "/login/oauth2/code/learning?state=unrelated&code=not-a-valid-code")
    invalid.api("me", expected=401)
    CASES.append("unrelated OAuth state cannot establish a session")

    STAGE = "RP initiated global logout"
    shadow = Browser()
    for cookie in member.cookies:
        if cookie.name != "LEARNING_SESSION":
            shadow.cookies.set_cookie(copy.copy(cookie))
    shadow.open(APP + "/oauth2/authorization/learning")
    assert shadow.api("me")["id"] == member.api("me")["id"]
    CASES.append("shared identity SSO creates a second independent application session without another password")
    csrf = member.api("csrf")
    status, url, _, _ = member.open(urllib.request.Request(APP + "/logout", data=b"",
        headers={csrf["headerName"]: csrf["token"]}, method="POST"))
    assert any("/protocol/openid-connect/logout?" in value for value in member.redirects.urls)
    assert url.rstrip("/") == APP, "Logout did not return to the application root"
    assert status == 200
    member.api("me", expected=401)
    CASES.append("real RP-initiated Keycloak logout returns to application and invalidates session")
    deadline = time.monotonic() + 8
    while True:
        status, _, _, _ = shadow.open(API + "me")
        if status == 401:
            break
        if time.monotonic() > deadline:
            raise AssertionError("Keycloak backchannel logout did not invalidate the other application session")
        time.sleep(0.2)
    CASES.append("signed Keycloak backchannel logout invalidates the other session on its next API request")

    preschool_browser.api("me", expected=401)
    CASES.append("unified logout also revokes the independently established preschool session")

    result = {"passed": True, "database": "PostgreSQL 18", "identity": "Keycloak 26.7.3", "caseCount": len(CASES), "cases": CASES}
    (PRIVATE / "result.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Joint acceptance failed at: " + STAGE + ". Inspect protected local response and server logs.")
        raise
