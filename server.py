#!/usr/bin/env python3
"""
herdr-mobile: Minimal mobile gateway & web server for Herdr.
Connects directly to the Herdr UNIX socket and serves a mobile-friendly PWA.
"""

import os
import sys
import json
import socket
import hashlib
import mimetypes
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote
from http import HTTPStatus
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler


def default_socket_path() -> str:
    """Locate herdr.sock: explicit env, then the current user's config dir, then root's."""
    candidates = [
        Path.home() / ".config/herdr/herdr.sock",
        Path("/root/.config/herdr/herdr.sock"),
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    return str(candidates[0])


HERDR_SOCKET_PATH = os.environ.get("HERDR_SOCKET") or default_socket_path()
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "3009"))
STATIC_DIR = Path(__file__).resolve().parent / "static"


def call_herdr_rpc(method: str, params: dict = None, timeout: float = 5.0) -> dict:
    """Send JSON-RPC request to Herdr UNIX domain socket and return response."""
    if not os.path.exists(HERDR_SOCKET_PATH):
        return {
            "id": "",
            "error": {
                "code": "socket_not_found",
                "message": f"Herdr socket not found at {HERDR_SOCKET_PATH}",
            },
        }

    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect(HERDR_SOCKET_PATH)
        req = {"id": "herdr-mobile", "method": method, "params": params or {}}
        payload = json.dumps(req).encode("utf-8") + b"\n"
        s.sendall(payload)

        chunks = []
        while True:
            chunk = s.recv(16384)
            if not chunk:
                break
            chunks.append(chunk)
            if b"\n" in chunk:
                break

        raw_data = b"".join(chunks).decode("utf-8", errors="replace")
        line = raw_data.split("\n", 1)[0].strip()
        if not line:
            return {"id": "", "error": {"code": "empty_response", "message": "Empty response from Herdr"}}
        return json.loads(line)
    except socket.timeout:
        return {"id": "", "error": {"code": "timeout", "message": "Timeout communicating with Herdr"}}
    except Exception as e:
        return {"id": "", "error": {"code": "socket_error", "message": str(e)}}
    finally:
        s.close()


class HerdrHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def send_json(self, data: dict, status_code: int = 200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.end_headers()
        self.wfile.write(body)
    def do_HEAD(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/"):
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.end_headers()
            return
        self.serve_static(path, head_only=True)


    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        qs = parse_qs(parsed.query)

        # API: List all active agents
        if path == "/api/agents":
            res = call_herdr_rpc("agent.list")
            if "error" in res:
                self.send_json(res, 500)
                return

            agents_raw = res.get("result", {}).get("agents", [])

            # Workspace labels are what the desktop UI shows ("herdr-mobile",
            # "ib-orbit"); agent.list only carries opaque ids like "w2:p1".
            ws_res = call_herdr_rpc("workspace.list")
            workspaces = {
                w.get("workspace_id"): w
                for w in ws_res.get("result", {}).get("workspaces", [])
            }

            agents = []
            for a in agents_raw:
                pane_id = a.get("pane_id") or ""
                ws = workspaces.get(a.get("workspace_id"), {})
                label = ws.get("label") or ""
                # Disambiguate only when a workspace actually holds several panes.
                if label and ws.get("pane_count", 1) > 1:
                    label = f"{label} \u00b7{pane_id.rsplit(':p', 1)[-1]}"
                agents.append({
                    "pane_id": pane_id,
                    "name": label or a.get("name") or pane_id,
                    "workspace_label": ws.get("label") or "",
                    "workspace_number": ws.get("number"),
                    "agent": a.get("agent"),
                    "status": a.get("agent_status", "unknown"),
                    "title": a.get("terminal_title_stripped") or a.get("terminal_title") or "",
                    "cwd": a.get("cwd", ""),
                    "workspace_id": a.get("workspace_id"),
                    "tab_id": a.get("tab_id"),
                    "focused": a.get("focused", False),
                })
            self.send_json({"ok": True, "agents": agents})
            return

        # API: Get history / output for a specific agent pane
        # /api/agents/{pane_id}/history
        if path.startswith("/api/agents/") and path.endswith("/history"):
            parts = path.split("/")
            # ["", "api", "agents", "<pane_id>", "history"]
            if len(parts) == 5:
                pane_id = unquote(parts[3])
                lines = int(qs.get("lines", ["100"])[0])
                lines = min(max(lines, 10), 1000)
                source = qs.get("source", ["recent_unwrapped"])[0]

                res = call_herdr_rpc("agent.read", {
                    "target": pane_id,
                    "source": source,
                    "lines": lines,
                    "strip_ansi": True,
                })

                if "error" in res:
                    # fallback to pane.read if agent.read fails
                    res = call_herdr_rpc("pane.read", {
                        "pane_id": pane_id,
                        "source": source,
                        "lines": lines,
                        "strip_ansi": True,
                    })

                if "error" in res:
                    self.send_json(res, 400)
                    return

                text = res.get("result", {}).get("read", {}).get("text", "")
                self.send_json({
                    "ok": True,
                    "pane_id": pane_id,
                    "source": source,
                    "text": text,
                })
                return

        # Serve static frontend files
        self.serve_static(path)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)

        # Read JSON body
        content_length = int(self.headers.get("Content-Length", 0))
        body_bytes = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            body = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
        except Exception:
            self.send_json({"ok": False, "error": "Invalid JSON"}, 400)
            return

        # API: Send prompt to agent
        # /api/agents/{pane_id}/prompt
        if path.startswith("/api/agents/") and path.endswith("/prompt"):
            parts = path.split("/")
            if len(parts) == 5:
                pane_id = unquote(parts[3])
                text = body.get("text", "").strip()
                if not text:
                    self.send_json({"ok": False, "error": "Empty prompt text"}, 400)
                    return

                # Send prompt to agent
                res = call_herdr_rpc("agent.prompt", {
                    "target": pane_id,
                    "text": text,
                })

                if "error" in res:
                    # If agent.prompt fails (e.g. agent not recognized or blocked), try pane.send_text
                    fallback_res = call_herdr_rpc("pane.send_text", {
                        "pane_id": pane_id,
                        "text": text + "\n",
                    })
                    if "error" in fallback_res:
                        self.send_json(res, 400)
                        return
                    self.send_json({"ok": True, "method": "pane.send_text"})
                    return

                self.send_json({"ok": True, "method": "agent.prompt", "result": res.get("result")})
                return

        # API: Send keys (e.g. ctrl+c, esc, enter)
        # /api/agents/{pane_id}/keys
        if path.startswith("/api/agents/") and path.endswith("/keys"):
            parts = path.split("/")
            if len(parts) == 5:
                pane_id = unquote(parts[3])
                keys = body.get("keys")
                if not keys:
                    key = body.get("key")
                    keys = [key] if key else []

                if not keys:
                    self.send_json({"ok": False, "error": "Missing key(s)"}, 400)
                    return

                res = call_herdr_rpc("agent.send_keys", {
                    "target": pane_id,
                    "keys": keys,
                })

                if "error" in res:
                    res = call_herdr_rpc("pane.send_keys", {
                        "pane_id": pane_id,
                        "keys": keys,
                    })

                if "error" in res:
                    self.send_json(res, 400)
                    return

                self.send_json({"ok": True, "result": res.get("result")})
                return

        self.send_json({"error": "Not Found"}, 404)

    def serve_static(self, req_path: str, head_only: bool = False):
        if req_path == "/" or not req_path:
            rel_path = "index.html"
        else:
            rel_path = req_path.lstrip("/")

        target_file = (STATIC_DIR / rel_path).resolve()

        # Prevent directory traversal
        if not str(target_file).startswith(str(STATIC_DIR)):
            self.send_error(HTTPStatus.FORBIDDEN, "Access denied")
            return

        if not target_file.is_file():
            # SPA fallback: if not an asset, serve index.html
            target_file = STATIC_DIR / "index.html"
            if not target_file.is_file():
                self.send_error(HTTPStatus.NOT_FOUND, "File not found")
                return

        ctype, _ = mimetypes.guess_type(str(target_file))
        if not ctype:
            ctype = "application/octet-stream"

        try:
            with open(target_file, "rb") as f:
                content = f.read()

            # Without a validator, "no-cache" leaves iOS free to reuse a stale
            # copy, which strands home-screen installs on an old build. Serve a
            # strong ETag so revalidation is meaningful, and answer 304 to it.
            etag = '"%s"' % hashlib.sha1(content).hexdigest()[:16]
            if self.headers.get("If-None-Match") == etag:
                self.send_response(HTTPStatus.NOT_MODIFIED)
                self.send_header("ETag", etag)
                self.send_header("Cache-Control", "no-cache, must-revalidate")
                self.end_headers()
                return

            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", "no-cache, must-revalidate")
            self.end_headers()
            if not head_only:
                self.wfile.write(content)
        except Exception as e:
            self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR, str(e))

    def log_message(self, format, *args):
        # Terse logging: suppress noisy polling logs
        msg = format % args
        if '"GET /api/' in msg and " 200 " in msg:
            return
        sys.stderr.write(f"[{self.log_date_time_string()}] {msg}\n")


def run():
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    server_address = (HOST, PORT)
    httpd = ThreadingHTTPServer(server_address, HerdrHandler)
    print(f"herdr-mobile listening on http://{HOST}:{PORT}")
    print(f"Herdr socket target: {HERDR_SOCKET_PATH}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        httpd.server_close()


if __name__ == "__main__":
    run()
