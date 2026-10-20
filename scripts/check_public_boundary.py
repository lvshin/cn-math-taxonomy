#!/usr/bin/env python3
"""Check publishable files and commit history without printing private values."""
import argparse
import ipaddress
import re
import subprocess
from pathlib import Path


RULES = [
    ("personal network settings", re.compile(rb"\b(?:[t]ailscale|[t]ailnet)\b", re.I)),
    ("personal network domain", re.compile(rb"\b[a-z0-9.-]+[.]ts[.]net\b", re.I)),
    ("machine-specific home path", re.compile(rb"/(?:[U]sers|[h]ome)/[^/\s]+")),
    ("private vault reference", re.compile(rb"\b[a-z]+-(?:Family|Travel)-KB\b", re.I)),
    ("machine service identifier", re.compile(rb"com[.][a-z0-9_-]+[.](?:family|pipi)[a-z0-9_.-]*", re.I)),
]
IPV4 = re.compile(rb"\b(?:\d{1,3}\.){3}\d{1,3}\b")
UPSTREAM_BASE = "10a0f562b32433b785729661c2164756cb933154"


def git(*args):
    return subprocess.check_output(["git", *args])


def text_issues(data):
    issues = [label for label, pattern in RULES if pattern.search(data)]
    for match in IPV4.finditer(data):
        try:
            address = ipaddress.IPv4Address(match.group().decode())
        except ValueError:
            continue
        first, second, *_ = address.packed
        shared = first == 100 and 64 <= second <= 127
        if not address.is_loopback and not address.is_unspecified and (address.is_private or shared):
            issues.append("private network address")
            break
    return issues


def path_issues(name):
    path = Path(name)
    if ".local" in path.parts or name.startswith("docs/screenshots/"):
        return ["private deployment file"]
    if path.suffix.lower() in {".pdf", ".pem", ".p12", ".key", ".bundle"}:
        return ["non-public file type"]
    return []


def check_worktree():
    issues = []
    for raw in git("ls-files", "-z").split(b"\0"):
        if not raw:
            continue
        name = raw.decode()
        path = Path(name)
        if not path.is_file():
            continue  # A tracked file removed for the next commit.
        for label in path_issues(name) + text_issues(path.read_bytes()):
            issues.append(f"{name}: {label}")
    return issues


def check_history(ref):
    issues, seen = [], set()
    inherited = set()
    probe = subprocess.run(["git", "merge-base", "--is-ancestor", UPSTREAM_BASE, ref],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if probe.returncode == 0:
        # Preserve public upstream ancestry. Only identical inherited files are
        # exempt; every new/modified blob and adaptation commit is inspected.
        for entry in git("ls-tree", "-rz", UPSTREAM_BASE).split(b"\0"):
            if entry:
                spec, name = entry.split(b"\t", 1)
                inherited.add((spec.split()[2], name))
        revisions = git("rev-list", ref, "--not", UPSTREAM_BASE)
    else:
        revisions = git("rev-list", ref)
    for revision in revisions.decode().splitlines():
        message = git("show", "-s", "--format=%B", revision)
        for label in text_issues(message):
            issues.append(f"{revision[:8]} commit message: {label}")
        for entry in git("ls-tree", "-rz", revision).split(b"\0"):
            if not entry:
                continue
            spec, raw_name = entry.split(b"\t", 1)
            _, kind, oid = spec.split()
            if kind != b"blob":
                continue
            if (oid, raw_name) in inherited:
                continue
            name = raw_name.decode()
            for label in path_issues(name):
                issues.append(f"{revision[:8]} {name}: {label}")
            if oid in seen:
                continue
            seen.add(oid)
            for label in text_issues(git("cat-file", "blob", oid.decode())):
                issues.append(f"{revision[:8]} {name}: {label}")
    return issues


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", metavar="REF", help="check every reachable commit of REF")
    args = parser.parse_args()
    issues = check_history(args.history) if args.history else check_worktree()
    for issue in issues:
        print(issue)
    if issues:
        print(f"Public boundary check failed: {len(issues)} findings (values omitted)")
        return 1
    print("Public boundary check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
