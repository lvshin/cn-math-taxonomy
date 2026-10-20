"""A clean current tree must not hide a private value in earlier commits."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

CHECKER = Path(__file__).resolve().parents[1] / "scripts/check_public_boundary.py"


class PublicBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git("init", "-q")

    def git(self, *args):
        return subprocess.check_output(["git", "-c", "user.name=Public checks",
                                       "-c", "user.email=checks@example.invalid", *args],
                                      cwd=self.root, stderr=subprocess.STDOUT)

    def commit(self, message="test snapshot"):
        self.git("add", "--all")
        self.git("commit", "-qm", message)

    def check(self, *args):
        return subprocess.run([sys.executable, str(CHECKER), *args], cwd=self.root,
                              capture_output=True, text=True)

    def test_private_domain_removed_from_current_tree_still_fails_history(self):
        private_domain = ".".join(["device", "example", "ts", "net"])
        path = self.root / "index.html"
        path.write_text("https://" + private_domain)
        self.commit()
        path.write_text("generic application")
        self.commit()
        self.assertEqual(self.check().returncode, 0)
        result = self.check("--history", "HEAD")
        self.assertEqual(result.returncode, 1)
        self.assertNotIn(private_domain, result.stdout)

    def test_generic_preview_passes_but_tracked_private_directory_fails(self):
        (self.root / "README.md").write_text("Preview on localhost")
        self.commit()
        self.assertEqual(self.check("--history", "HEAD").returncode, 0)
        private = self.root / ".local"
        private.mkdir()
        (private / "settings.json").write_text("{}")
        self.commit()
        self.assertEqual(self.check().returncode, 1)
        self.assertEqual(self.check("--history", "HEAD").returncode, 1)


if __name__ == "__main__":
    unittest.main()
