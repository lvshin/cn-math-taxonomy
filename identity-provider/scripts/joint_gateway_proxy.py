#!/usr/bin/env python3
"""Synthetic joint-test fault proxy, never a production component."""
import argparse
import hmac
import json
from pathlib import Path
import socket
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--environment", type=Path, required=True)
    parser.add_argument("--port", type=int, default=18888)
    args = parser.parse_args()
    env = dict(line.split("=", 1) for line in args.environment.read_text().splitlines())
    key = env["REGISTRATION_KEY"]
    target = "http://127.0.0.1:" + env["PORT"] + "/edu/math"
    state = {"mode": "normal", "failedBefore": 0, "committedResponseDropped": 0}
    lock = threading.Lock()

    class Proxy(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            if not hmac.compare_digest(self.headers.get("X-Registration-Key", ""), key):
                self.send_error(403); return
            body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            if self.path == "/__fault/arm":
                mode = json.loads(body)["mode"]
                if mode not in ("normal", "fail-before-bind", "drop-after-commit"):
                    self.send_error(400); return
                with lock:
                    state.update({"mode": mode, "failedBefore": 0, "committedResponseDropped": 0})
                return self.respond(200, b"{}")
            if self.path == "/__fault/stats":
                with lock:
                    result = json.dumps(state).encode()
                return self.respond(200, result)
            if self.path not in ("/edu/math/internal/registration/reserve", "/edu/math/internal/registration/bind"):
                self.send_error(404); return
            mode = "normal"
            if self.path.endswith("/bind"):
                with lock:
                    mode = state["mode"]
                    state["mode"] = "normal"
                    if mode == "fail-before-bind":
                        state["failedBefore"] += 1
                if mode == "fail-before-bind":
                    return self.respond(503, b"{}")
            request = urllib.request.Request(target + self.path[len("/edu/math"):], data=body,
                headers={"Content-Type": "application/json", "X-Registration-Key": key})
            try:
                with urllib.request.urlopen(request, timeout=15) as response:
                    status, result = response.status, response.read()
            except urllib.error.HTTPError as error:
                status, result = error.code, error.read()
            if mode == "drop-after-commit" and 200 <= status < 300:
                with lock:
                    state["committedResponseDropped"] += 1
                self.connection.shutdown(socket.SHUT_RDWR)
                self.connection.close()
                return
            self.respond(status, result)

        def respond(self, status, body):
            self.send_response(status); self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    ThreadingHTTPServer(("0.0.0.0", args.port), Proxy).serve_forever()


if __name__ == "__main__":
    main()
