"""
Wodoga Platform — Shared Rate Limiter

A single Limiter instance importable by both main.py (for app wiring) and
individual routers (to decorate sensitive endpoints), without circular imports.

Rate limiting is a security control: it prevents brute-force attacks against
authentication endpoints. Login, MFA verification, password reset, and forgot-
password are all sensitive and must be throttled per client IP.

PROXY HANDLING:
Railway sits in front of the app as a reverse proxy. Without configuration,
slowapi's get_remote_address reads request.client.host, which behind the proxy
returns Railway's internal proxy IP — meaning every real client shares one
rate-limit bucket, which makes the limiter effectively useless. We use a
custom key function that reads the first IP from X-Forwarded-For (the real
client), falling back to the direct client only if the header is absent.
"""

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def _client_ip(request: Request) -> str:
    """
    Return the real client IP for rate-limit bucketing.

    Railway sets X-Forwarded-For with the chain: "real_client, proxy1, proxy2".
    The first entry is the originating client, which is what we want.

    Falls back to the direct client address if the header is missing (e.g.
    local development without a proxy).
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        # First IP in the chain is the originating client
        return forwarded.split(",")[0].strip()
    return get_remote_address(request)


limiter = Limiter(key_func=_client_ip)
