"""Client IP resolution shared by the rate limiter and the audit log."""
from __future__ import annotations

import os

from flask import request


def get_client_ip() -> str:
    """Return the client IP ('' when unknown).

    X-Forwarded-For is trusted only when TRUSTED_PROXY is set; otherwise clients could
    spoof their address. Without it, ``request.remote_addr`` is used.
    """
    if os.environ.get("TRUSTED_PROXY"):
        ip = request.headers.get("X-Forwarded-For", request.remote_addr) or ""
        return ip.split(",")[0].strip()
    return request.remote_addr or ""
