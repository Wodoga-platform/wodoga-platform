"""
Wodoga Platform — Main Application Entry Point
FastAPI application with all middleware, routers, and error handlers.
"""

import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded

from app.core.limiter import limiter

from app.config import get_settings
from app.database import check_database_connection, engine
from app.core.exceptions import WodogaException, to_http_exception

# All API routers
from app.api.v1 import auth, patients, visits, vitals, eligibility, portal, documents
from app.api.v1.clinical_ops import (
    medications_router, care_plans_router, referrals_router,
    billing_router, pharm_router, oasis_router,
    messages_router, staff_router, notifications_router, audit_router,
)

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"[Wodoga] Starting {settings.app_name} v{settings.app_version} ({settings.app_env})")
    connected = await check_database_connection()
    if not connected:
        raise RuntimeError("[Wodoga] Database connection failed. Check DATABASE_URL in .env")
    print("[Wodoga] Database connected.")
    # ── PRODUCTION SAFETY GUARD ───────────────────────────────
    if settings.is_production:
        _problems = []
        if settings.eligibility_provider not in ("waystar", "availity"):
            _problems.append(
                "ELIGIBILITY_PROVIDER is 'simulated' — insurance checks "
                "would be FAKE. Set it to 'availity' or 'waystar'."
            )
        for _key_name in ("secret_key", "jwt_secret_key", "encryption_key"):
            _v = str(getattr(settings, _key_name, "") or "")
            if (not _v) or ("CHANGE_THIS" in _v) or (len(_v) < 24):
                _problems.append(
                    f"{_key_name.upper()} is missing or looks like a "
                    "placeholder."
                )
        if getattr(settings, "debug", False):
            _problems.append("DEBUG=true in production. Set DEBUG=false.")
        if _problems:
            for _p in _problems:
                print(f"[Wodoga] UNSAFE FOR PRODUCTION: {_p}")
            raise RuntimeError(
                "Wodoga refused to start in production mode. Fix the "
                "problems above in the environment variables and restart."
            )

    # Idempotent lightweight migrations (safe to run on every boot)
    try:
        from sqlalchemy import text as _text
        from app.database import engine as _engine
        async with _engine.begin() as conn:
            await conn.execute(_text(
                "ALTER TABLE patients ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION"
            ))
            await conn.execute(_text(
                "ALTER TABLE patients ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION"
            ))
            await conn.execute(_text(
                "ALTER TABLE visits ADD COLUMN IF NOT EXISTS overdue_alerted BOOLEAN DEFAULT FALSE"
            ))
            await conn.execute(_text(
                "ALTER TABLE vitals ADD COLUMN IF NOT EXISTS alert_acknowledged BOOLEAN DEFAULT FALSE"
            ))
        print("[Wodoga] Schema check complete (patient geo columns ensured).")
    except Exception as e:
        print(f"[Wodoga] Schema check warning: {e}")

    yield
    await engine.dispose()
    print("[Wodoga] Shutdown complete.")


app = FastAPI(
    title="Wodoga Platform API",
    description="HIPAA-conscious home health and pharmaceutical operations platform.",
    version=settings.app_version,
    docs_url="/docs"            if not settings.is_production else None,
    redoc_url="/redoc"          if not settings.is_production else None,
    openapi_url="/openapi.json" if not settings.is_production else None,
    lifespan=lifespan,
)

app.state.limiter = limiter


async def _structured_rate_limit_handler(request: Request, exc: RateLimitExceeded):
    """
    Return rate-limit responses in the same {error, message} shape the rest of
    the app uses, so the frontend can read it consistently. The default slowapi
    handler returns plain text, which the API client can't parse uniformly.
    """
    return JSONResponse(
        status_code=429,
        content={
            "error": "rate_limited",
            "message": "Too many login attempts from your network. Please wait a minute and try again.",
        },
    )


app.add_exception_handler(RateLimitExceeded, _structured_rate_limit_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    expose_headers=["X-Request-ID", "X-Response-Time"],
)

@app.middleware("http")
async def request_metadata_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request.state.request_id = request_id
    start = time.monotonic()
    response = await call_next(request)
    response.headers["X-Request-ID"]    = request_id
    response.headers["X-Response-Time"] = f"{round((time.monotonic()-start)*1000,2)}ms"
    return response

@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"]  = "nosniff"
    response.headers["X-Frame-Options"]         = "DENY"
    response.headers["X-XSS-Protection"]        = "1; mode=block"
    response.headers["Referrer-Policy"]         = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"]      = "geolocation=(self), camera=(), microphone=()"
    if settings.is_production:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

@app.exception_handler(WodogaException)
async def wodoga_exception_handler(request: Request, exc: WodogaException):
    http_exc = to_http_exception(exc)
    return JSONResponse(
        status_code=http_exc.status_code,
        content={"error": exc.code, "message": exc.message},
    )

@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    if settings.is_production:
        return JSONResponse(
            status_code=500,
            content={"error": "internal_error", "message": "An unexpected error occurred."},
        )
    return JSONResponse(
        status_code=500,
        content={"error": "internal_error", "message": str(exc), "type": type(exc).__name__},
    )

V1 = "/api/v1"
app.include_router(auth.router,               prefix=V1)
app.include_router(patients.router,           prefix=V1)
app.include_router(visits.router,             prefix=V1)
app.include_router(vitals.router,             prefix=V1)
app.include_router(medications_router,        prefix=V1)
app.include_router(care_plans_router,         prefix=V1)
app.include_router(oasis_router,              prefix=V1)
app.include_router(pharm_router,              prefix=V1)
app.include_router(referrals_router,          prefix=V1)
app.include_router(billing_router,            prefix=V1)
app.include_router(eligibility.router,        prefix=V1)
app.include_router(messages_router,           prefix=V1)
app.include_router(notifications_router,      prefix=V1)
app.include_router(staff_router,              prefix=V1)
app.include_router(audit_router,              prefix=V1)
app.include_router(portal.router,             prefix=V1)
app.include_router(documents.router,          prefix=V1)

@app.get("/health", include_in_schema=False)
async def health_check():
    db_ok = await check_database_connection()
    return {"status": "healthy" if db_ok else "degraded", "version": settings.app_version}

@app.get("/", include_in_schema=False)
async def root():
    return {"name": "Wodoga Platform API", "version": settings.app_version}
