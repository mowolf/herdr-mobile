#!/usr/bin/env python3
"""
Web Push (VAPID) for herdr-mobile, using only the standard library plus the
openssl binary.

Two deliberate constraints shape this module:

* Python's stdlib has no ECDSA, so the ES256 signature for the VAPID JWT is
  produced by shelling out to `openssl` and converting its DER output to the
  raw r||s form JWT requires.
* Encrypting a push payload needs ECDH + AES-GCM, which the stdlib also
  cannot do. Payload-less pushes are legal, so we send none: the service
  worker fetches /api/agents when it wakes and builds the notification from
  live data. That removes the encryption problem entirely.
"""

import os
import json
import time
import base64
import subprocess
import urllib.request
import urllib.error
from pathlib import Path
from urllib.parse import urlparse

STATE_DIR = Path(os.environ.get("HERDR_STATE_DIR", Path.home() / ".config/herdr-mobile"))
KEY_PATH = STATE_DIR / "vapid_private.pem"
SUBS_PATH = STATE_DIR / "subscriptions.json"
# RFC 8292 wants a contact for the push service; a URL is as valid as a mailto.
VAPID_SUB = os.environ.get("HERDR_PUSH_SUB", "https://github.com/mowolf/herdr-mobile")


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def ensure_keys() -> None:
    """Generate the VAPID keypair once, readable only by this user."""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    if KEY_PATH.exists():
        return
    subprocess.run(
        ["openssl", "ecparam", "-genkey", "-name", "prime256v1", "-noout", "-out", str(KEY_PATH)],
        check=True, capture_output=True,
    )
    KEY_PATH.chmod(0o600)


def public_key_b64() -> str:
    """The uncompressed P-256 point (0x04||X||Y) the browser needs."""
    ensure_keys()
    der = subprocess.run(
        ["openssl", "ec", "-in", str(KEY_PATH), "-pubout", "-outform", "DER"],
        check=True, capture_output=True,
    ).stdout
    return b64url(der[-65:])


def _der_to_raw(der: bytes) -> bytes:
    """SEQUENCE{INTEGER r, INTEGER s} -> r||s, each left-padded to 32 bytes."""
    if not der or der[0] != 0x30:
        raise ValueError("not a DER sequence")
    idx = 2 if der[1] < 0x80 else 2 + (der[1] & 0x7F)
    out = b""
    for _ in range(2):
        if der[idx] != 0x02:
            raise ValueError("expected INTEGER")
        length = der[idx + 1]
        value = der[idx + 2: idx + 2 + length].lstrip(b"\x00")
        out += value.rjust(32, b"\x00")
        idx += 2 + length
    return out


def _sign_es256(message: bytes) -> bytes:
    ensure_keys()
    der = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", str(KEY_PATH)],
        input=message, check=True, capture_output=True,
    ).stdout
    return _der_to_raw(der)


def _vapid_header(endpoint: str) -> str:
    origin = urlparse(endpoint)
    header = b64url(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    claims = b64url(json.dumps({
        "aud": f"{origin.scheme}://{origin.netloc}",
        "exp": int(time.time()) + 12 * 3600,
        "sub": VAPID_SUB,
    }, separators=(",", ":")).encode())
    signing_input = f"{header}.{claims}".encode()
    jwt = f"{header}.{claims}.{b64url(_sign_es256(signing_input))}"
    return f"vapid t={jwt}, k={public_key_b64()}"


def load_subs() -> list:
    try:
        return json.loads(SUBS_PATH.read_text())
    except Exception:
        return []


def save_subs(subs: list) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    SUBS_PATH.write_text(json.dumps(subs, indent=2))
    SUBS_PATH.chmod(0o600)


def add_sub(sub: dict) -> int:
    subs = [s for s in load_subs() if s.get("endpoint") != sub.get("endpoint")]
    subs.append(sub)
    save_subs(subs)
    return len(subs)


def remove_sub(endpoint: str) -> int:
    subs = [s for s in load_subs() if s.get("endpoint") != endpoint]
    save_subs(subs)
    return len(subs)


def send_one(sub: dict, ttl: int = 120) -> int:
    """Return the push service's status code; 404/410 mean the sub is dead."""
    endpoint = sub.get("endpoint", "")
    req = urllib.request.Request(endpoint, data=b"", method="POST")
    req.add_header("Authorization", _vapid_header(endpoint))
    req.add_header("TTL", str(ttl))
    req.add_header("Urgency", "high")
    req.add_header("Content-Length", "0")
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return res.status
    except urllib.error.HTTPError as e:
        return e.code


def broadcast() -> dict:
    """Push to every subscription, dropping the ones the service rejects."""
    results = {}
    alive = []
    for sub in load_subs():
        code = send_one(sub)
        results[sub.get("endpoint", "")[-24:]] = code
        if code not in (404, 410):
            alive.append(sub)
    if len(alive) != len(load_subs()):
        save_subs(alive)
    return results
