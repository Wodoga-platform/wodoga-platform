"""
Wodoga Platform — Database Layer
Async SQLAlchemy engine with per-request organization context
for row-level security enforcement.
"""

from contextlib import asynccontextmanager
from typing import AsyncGenerator
from uuid import UUID

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

settings = get_settings()

# ── Engine ───────────────────────────────────────────────────
engine = create_async_engine(
    settings.database_url,
    pool_size=settings.database_pool_size,
    max_overflow=settings.database_max_overflow,
    pool_pre_ping=True,         # Verify connections before use
    pool_recycle=3600,          # Recycle connections every hour
    echo=settings.is_development,  # Log SQL in development only
)

# ── Session Factory ──────────────────────────────────────────
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

# ── Declarative Base ─────────────────────────────────────────
class Base(DeclarativeBase):
    pass


# ── Session Dependency ───────────────────────────────────────
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency that provides a database session.
    Session is committed on success, rolled back on any exception.
    Usage: db: AsyncSession = Depends(get_db)
    """
    async with AsyncSessionLocal() as session:
        try:
            # Clear any stale org context left by a previous get_db_for_tenant
            # call on this pooled connection — ensures the RLS carve-out on
            # users/roles/audit_logs works correctly for unauthenticated endpoints.
            await session.execute(text("SELECT set_config('app.organization_id', '', false)"))
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# ── Tenant-Scoped Session ────────────────────────────────────
async def get_tenant_db(
    organization_id: UUID,
) -> AsyncGenerator[AsyncSession, None]:
    """
    Provides a database session with the organization context set.
    This activates row-level security policies for the organization.

    Every query executed on this session can only return rows
    belonging to the specified organization — enforced at the
    database level, not the application level.

    Usage: db = Depends(get_tenant_db) — called from middleware.
    """
    async with AsyncSessionLocal() as session:
        try:
            # Set the RLS context variable for this connection
            await session.execute(
            await db.execute(text(f"SET LOCAL app.organization_id = '{str(organization_id)}'")),
            )
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# ── Health Check ─────────────────────────────────────────────
async def check_database_connection() -> bool:
    """
    Verifies the database is reachable.
    Called during application startup and health checks.
    """
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


# ── Startup / Shutdown ───────────────────────────────────────
@asynccontextmanager
async def lifespan(app):
    """
    Manages database connection lifecycle.
    Verifies connectivity on startup, disposes pool on shutdown.
    """
    # Startup
    connected = await check_database_connection()
    if not connected:
        raise RuntimeError("Cannot connect to the database. Check DATABASE_URL.")

    yield  # Application runs here

    # Shutdown
    await engine.dispose()
