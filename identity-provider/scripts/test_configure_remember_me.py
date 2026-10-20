#!/usr/bin/env python3
"""Focused policy checks for safe incremental Remember Me configuration."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from configure_remember_me import configure, FIELDS, settings


class AdminFixture:
    def __init__(self):
        self.realm = {"rememberMe": False, "ssoSessionIdleTimeout": 1800, "ssoSessionMaxLifespan": 28800,
            "browserFlow": "custom-browser", "registrationFlow": "custom-registration", "registrationAllowed": True}
        self.client = {"id": "synthetic", "clientId": "education", "attributes": {"unchanged": "value"}}
        self.writes = []

    def request(self, method, path="", payload=None):
        if method == "GET":
            return copy.deepcopy([self.client] if path.startswith("/clients?") else self.realm)
        if method == "PUT" and path == "":
            self.writes.append(copy.deepcopy(payload))
            self.realm.update(payload)
            return None
        raise AssertionError("Unexpected operation")


class ConfigurationPolicyTest(unittest.TestCase):
    def test_preview_never_writes(self):
        admin = AdminFixture()
        before = copy.deepcopy(admin.realm)
        self.assertFalse(configure(admin, "education")["applied"])
        self.assertEqual(admin.realm, before)
        self.assertEqual(admin.writes, [])

    def test_apply_is_narrow_protected_and_idempotent(self):
        admin = AdminFixture()
        with tempfile.TemporaryDirectory() as directory:
            backup = Path(directory) / "before.json"
            self.assertTrue(configure(admin, "education", apply=True, backup_file=backup)["changed"])
            self.assertEqual(set(admin.writes[0]), set(FIELDS))
            self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
            self.assertEqual(admin.realm["browserFlow"], "custom-browser")
            self.assertEqual(admin.realm["ssoSessionIdleTimeout"], 1800)
            again = Path(directory) / "again.json"
            self.assertFalse(configure(admin, "education", apply=True, backup_file=again)["changed"])
            self.assertEqual(len(admin.writes), 1)

    def test_existing_recovery_point_is_never_overwritten(self):
        admin = AdminFixture()
        with tempfile.TemporaryDirectory() as directory:
            backup = Path(directory) / "before.json"
            backup.write_text("preserve recovery point")
            with self.assertRaises(FileExistsError):
                configure(admin, "education", apply=True, backup_file=backup)
            self.assertEqual(admin.writes, [])
            self.assertEqual(backup.read_text(), "preserve recovery point")

    def test_apply_requires_backup_and_max_bound_refuses_longer_ordinary_session(self):
        admin = AdminFixture()
        with self.assertRaises(ValueError):
            configure(admin, "education", apply=True)
        admin.realm["ssoSessionMaxLifespan"] = 31 * 86400
        with self.assertRaises(RuntimeError):
            configure(admin, "education")
        self.assertEqual(admin.writes, [])

    def test_restore_writes_only_validated_remember_fields(self):
        admin = AdminFixture()
        initial = settings(admin.realm)
        with tempfile.TemporaryDirectory() as directory:
            backup = Path(directory) / "before.json"
            configure(admin, "education", apply=True, backup_file=backup)
            configure(admin, "education", apply=True, backup_file=Path(directory) / "restore.json", restore_file=backup)
            self.assertEqual(settings(admin.realm), initial)
            self.assertTrue(all(set(write) == set(FIELDS) for write in admin.writes))
            backup.write_text(json.dumps({"schema": 1, "settings": {**initial, "browserFlow": "unsafe"}}))
            with self.assertRaises(ValueError):
                configure(admin, "education", restore_file=backup)


if __name__ == "__main__":
    unittest.main()
