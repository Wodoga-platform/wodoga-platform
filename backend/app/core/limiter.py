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

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
