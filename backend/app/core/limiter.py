"""
Wodoga Platform — Shared Rate Limiter

A single Limiter instance importable by both main.py (for app wiring) and
individual routers (to decorate sensitive endpoints), without circular imports.

Rate limiting is a security control: it prevents brute-force attacks against
authentication endpoints. Login, MFA verification, password reset, and forgot-
password are all sensitive and must be throttled per client IP.

NOTE: behind Railway/Vercel the real client IP must be forwarded
(X-Forwarded-For) for per-client limiting to work correctly. slowapi's
get_remote_address reads the immediate client by default; if all requests
appear to come from one proxy IP, configure the app to trust the forwarded
header.
"""

from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.util import get_remote_address


def _rate_limit_response(request, exc):
    """Returns 429 in the same {error, message} shape the frontend expects."""
    return JSONResponse(
        status_code=429,
        content={
            "error": "rate_limited",
            "message": "Too many login attempts from your network. Please wait a minute and try again.",
        },
    )


limiter = Limiter(
    key_func=get_remote_address,
    default_limits_exceeded_response=_rate_limit_response,
)
