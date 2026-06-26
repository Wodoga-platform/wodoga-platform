"""
Wodoga Platform — Alembic Environment

This file is loaded by Alembic whenever a migration command is run. It controls
how Alembic connects to the database and how migrations are executed.

KEY DESIGN DECISIONS (read these before changing anything):

1. NO ORM MODELS. Wodoga is a raw-SQL codebase. We deliberately do NOT import
   any SQLAlchemy models and we set `target_metadata = None`. This DISABLES
   autogenerate — which is correct for us. Autogenerate would compare empty
   metadata to the live database and try to drop every table.

2. SYNC DRIVER FOR MIGRATIONS. The app uses asyncpg, but Alembic runs migrations
   synchronously. We rewrite the URL from `postgresql+asyncpg://...` to
   `postgresql+psycopg2://...` so the standard sync flow works. psycopg2-binary
   is already in requirements.txt.

3. SEPARATE OWNER CREDENTIALS. The runtime `wodoga_app` role intentionally
   does NOT have DDL permissions (this is by design — see schema.sql). Alembic
   migrations MUST run as a role that owns the tables, normally the postgres
   superuser. We read this from `ALEMBIC_DATABASE_URL`. We fall back to
   `DATABASE_URL` ONLY if ALEMBIC_DATABASE_URL is unset (which should only
   happen in local development against a dev DB where the app role owns
   everything).

4. SAFETY LOGGING. Every migration command logs which database it's about to
   touch (host, db name, role) BEFORE running. This is intentional friction —
   if you see the wrong target, hit Ctrl+C.
"""

from __future__ import annotations

import os
import sys
import logging
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool
from sqlalchemy.engine.url import make_url

# Make `app` importable so we can read settings from a single source of truth
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Alembic Config object
config = context.config

# Set up logging from alembic.ini
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

log = logging.getLogger("alembic.env")

# NO MODELS. This intentionally disables autogenerate.
target_metadata = None


def _resolve_database_url() -> str:
    """
    Pick the right database URL for migrations, with safety logging.

    Precedence:
      1. ALEMBIC_DATABASE_URL  (owner credentials — required for production)
      2. DATABASE_URL          (only acceptable in local dev where app role
                                  owns everything)

    Always rewrites asyncpg → psycopg2 for sync migration execution.
    """
    url = os.environ.get("ALEMBIC_DATABASE_URL")
    using_runtime_url = False
    if not url:
        url = os.environ.get("DATABASE_URL")
        using_runtime_url = True
        if not url:
            raise RuntimeError(
                "No database URL found. Set ALEMBIC_DATABASE_URL (preferred, "
                "with owner credentials) or DATABASE_URL (local dev only)."
            )

    # Rewrite asyncpg → psycopg2 so the sync Alembic flow works
    if "+asyncpg" in url:
        url = url.replace("+asyncpg", "+psycopg2")
    elif url.startswith("postgresql://") or url.startswith("postgres://"):
        # Plain postgres:// URLs work with psycopg2 by default
        url = url.replace("postgres://", "postgresql://", 1) if url.startswith("postgres://") else url
        url = url.replace("postgresql://", "postgresql+psycopg2://", 1)

    # SAFETY LOGGING — print the target before we run anything
    parsed = make_url(url)
    log.info("=" * 60)
    log.info("ALEMBIC TARGET DATABASE")
    log.info("  Host:  %s", parsed.host)
    log.info("  Port:  %s", parsed.port)
    log.info("  DB:    %s", parsed.database)
    log.info("  Role:  %s", parsed.username)
    log.info("  Via:   %s", "ALEMBIC_DATABASE_URL" if not using_runtime_url else "DATABASE_URL (fallback)")
    if using_runtime_url:
        log.warning("Falling back to DATABASE_URL — fine for local dev only.")
    log.info("=" * 60)

    return url


def run_migrations_offline() -> None:
    """
    Run migrations in 'offline' mode — emits SQL to a script instead of
    executing it. Useful for reviewing exactly what will run, and for
    environments where you want a DBA to apply the SQL manually.

    Usage: `alembic upgrade head --sql`
    """
    url = _resolve_database_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        # For raw-SQL projects, transactional DDL is what we want — each
        # migration is its own transaction.
        transaction_per_migration=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """
    Run migrations in 'online' mode — connects to the database and applies them.
    """
    url = _resolve_database_url()

    # Build engine config from alembic.ini settings, overriding the URL
    cfg_section = config.get_section(config.config_ini_section, {})
    cfg_section["sqlalchemy.url"] = url

    connectable = engine_from_config(
        cfg_section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,  # Don't pool — migrations are one-shot
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            transaction_per_migration=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
