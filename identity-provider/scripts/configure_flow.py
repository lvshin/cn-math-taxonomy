#!/usr/bin/env python3
"""Incremental flow/client configuration; default is read-only, never imports a Realm.

Use a short-lived Keycloak admin access token from the environment, never arguments.
"""
import argparse
import json
import os
import urllib.error
import urllib.parse
import urllib.request

PROVIDER = "learning-invitation-registration"
RECEIPT = "learning_registration_receipt"


class Admin:
    def __init__(self, base, realm, token):
        self.base = base.rstrip("/") + "/admin/realms/" + urllib.parse.quote(realm, safe="")
        self.token = token

    def request(self, method, path="", payload=None):
        body = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(self.base + path, data=body, method=method,
            headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as response:
            raw = response.read()
            return json.loads(raw) if raw else None


def configure(admin, client_id, flow_alias="learning-invited-registration", apply=False, enable=False):
    providers = admin.request("GET", "/authentication/form-action-providers")
    if not any(p.get("id") == PROVIDER for p in providers):
        raise RuntimeError("Required provider is not loaded; registration remains unchanged")
    clients = admin.request("GET", "/clients?clientId=" + urllib.parse.quote(client_id))
    if len(clients) != 1 or clients[0].get("clientId") != client_id:
        raise RuntimeError("Create the dedicated education OIDC client before configuring registration")
    realm = admin.request("GET")
    if realm.get("registrationFlow") not in ("registration", flow_alias):
        raise RuntimeError("An existing custom registration flow requires explicit manual integration")
    flows = admin.request("GET", "/authentication/flows")
    existing = next((f for f in flows if f["alias"] == flow_alias), None)
    if not apply:
        return {"providerLoaded": True, "clientFound": True, "flowExists": bool(existing),
                "registrationAllowed": realm.get("registrationAllowed", False), "changed": False}
    # Dedicated education-client claim. A user cannot forge the backend-verifiable HMAC receipt.
    mapper = {"name": RECEIPT, "protocol": "openid-connect", "protocolMapper": "oidc-usermodel-attribute-mapper",
        "consentRequired": False, "config": {"user.attribute": RECEIPT, "claim.name": RECEIPT,
        "jsonType.label": "String", "id.token.claim": "true", "access.token.claim": "false", "userinfo.token.claim": "false"}}
    client = clients[0]
    current = admin.request("GET", "/clients/" + client["id"] + "/protocol-mappers/models")
    matches = [m for m in current if m.get("name") == RECEIPT or
        (m.get("protocolMapper") == mapper["protocolMapper"] and m.get("config", {}).get("claim.name") == RECEIPT)]
    if len(matches) > 1:
        raise RuntimeError("Duplicate registration receipt mappers")
    if matches:
        mapper["id"] = matches[0]["id"]
        admin.request("PUT", "/clients/" + client["id"] + "/protocol-mappers/models/" + mapper["id"], mapper)
    else:
        admin.request("POST", "/clients/" + client["id"] + "/protocol-mappers/models", mapper)
    if not existing:
        admin.request("POST", "/authentication/flows/registration/copy", {"newName": flow_alias})
    quote = urllib.parse.quote
    executions = admin.request("GET", "/authentication/flows/" + quote(flow_alias, safe="") + "/executions")
    form = next((e for e in executions if e.get("providerId") == "registration-page-form"), None)
    if not form:
        raise RuntimeError("Copied registration page could not be located")
    nested_alias = form.get("displayName")
    gates = [e for e in executions if e.get("providerId") == PROVIDER]
    if not gates:
        admin.request("POST", "/authentication/flows/" + quote(nested_alias, safe="") + "/executions/execution", {"provider": PROVIDER})
    executions = admin.request("GET", "/authentication/flows/" + quote(flow_alias, safe="") + "/executions")
    gates = [e for e in executions if e.get("providerId") == PROVIDER]
    if len(gates) != 1:
        raise RuntimeError("Expected exactly one invitation gate")
    gate = gates[0]
    gate["requirement"] = "REQUIRED"
    admin.request("PUT", "/authentication/flows/" + quote(flow_alias, safe="") + "/executions", gate)
    # The new action is appended last. On repeat runs verify rather than reorder unrelated actions.
    executions = admin.request("GET", "/authentication/flows/" + quote(flow_alias, safe="") + "/executions")
    actions = [e for e in executions if e.get("level") == gate.get("level") and not e.get("authenticationFlow")]
    if not actions or actions[-1].get("providerId") != PROVIDER:
        raise RuntimeError("Invitation gate must be the final form action; registration was not enabled")
    if not any(e.get("providerId") == "registration-user-creation" and e.get("requirement") == "REQUIRED" for e in actions):
        raise RuntimeError("A REQUIRED user-creation action is missing")
    # Minimal Realm update: no users, credentials, other flows, themes, or client data imported.
    change = {"registrationFlow": flow_alias}
    if enable:
        change["registrationAllowed"] = True
    admin.request("PUT", "", change)
    return {"providerLoaded": True, "gateRequired": True, "gateLast": True, "registrationEnabled": enable, "changed": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--realm", required=True)
    parser.add_argument("--client-id", required=True)
    parser.add_argument("--flow-alias", default="learning-invited-registration")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--enable-registration", action="store_true",
        help="Use only after provider configuration and isolated acceptance have passed")
    args = parser.parse_args()
    if args.enable_registration and not args.apply:
        parser.error("--enable-registration requires --apply")
    token = os.environ.get("KEYCLOAK_ADMIN_ACCESS_TOKEN")
    if not token:
        parser.error("KEYCLOAK_ADMIN_ACCESS_TOKEN is required")
    print(json.dumps(configure(Admin(args.base_url, args.realm, token), args.client_id,
        args.flow_alias, args.apply, args.enable_registration), ensure_ascii=False))


if __name__ == "__main__":
    main()
