#!/usr/bin/env python3
"""Read-only readiness probe; no session, account, record, or secret is logged."""
import os
import sys
import urllib.request


def main():
    url = os.environ["LEARNING_HEALTH_URL"]
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            if response.status != 200:
                raise RuntimeError("unready")
        print("learning readiness: OK")
        return 0
    except Exception:
        print("learning readiness: FAILED", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
