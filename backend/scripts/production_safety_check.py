"""
Wodoga Platform — Production Safety Check
==========================================

WHAT THIS DOES (plain English):
Think of this as a pre-flight inspection before you launch.
Run it, and it scans your settings and your code for anything
dangerous that should never reach real clients — demo passwords,
test shortcuts, fake insurance checks, leaked secrets, etc.

It tells you PASS or FAIL for each item, in plain language.
It changes nothing. It only looks.

HOW TO RUN IT:
  1. Open a terminal in the `backend` folder
  2. Make sure (venv) is showing at the start of the line
  3. Type:   python scripts/production_safety_check.py
"""

import re
import sys
from pathlib import Path

# Allow running from the backend folder
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

PASS = "✓ PASS"
FAIL = "✗ FAIL"
WARN = "⚠ WARNING"

results: list[tuple[str, str, str]] = []   # (status, title, explanation)


def record(status: str, title: str, explanation: str) -> None:
    results.append((status, title, explanation))


def check_settings() -> None:
    """Inspect the .env / configuration values."""
    try:
        from app.config import get_settings
        s = get_settings()
    except Exception as exc:
        record(FAIL, "Could not load settings",
               f"The backend configuration failed to load: {exc}")
        return

    # 1 — Environment mode
    if s.app_env == "production":
        record(PASS, "App is set to production mode",
               "APP_ENV=production — demo behaviors should be disabled.")
    else:
        record(WARN, f"App is in '{s.app_env}' mode",
               "Fine for testing. Before launch, set APP_ENV=production "
               "in the .env file.")

    # 2 — Eligibility provider
    provider = getattr(s, "eligibility_provider", "simulated")
    if provider == "simulated":
        if s.app_env == "production":
            record(FAIL, "Insurance checks are FAKE (simulated)",
                   "ELIGIBILITY_PROVIDER is 'simulated' while in production "
                   "mode. Staff would see made-up insurance results. Set it "
                   "to 'availity' or 'waystar' with real credentials, OR "
                   "keep simulation clearly labeled and out of production.")
        else:
            record(WARN, "Insurance checks are simulated",
                   "OK for demos. Must be 'availity' or 'waystar' before "
                   "real clients rely on results.")
    else:
        record(PASS, f"Insurance checks use real provider: {provider}",
               "Eligibility results will come from a real clearinghouse.")

    # 3 — Secret keys
    weak_markers = ("CHANGE_THIS", "secret", "wodoga", "example", "demo",
                    "test", "1234")
    for key_name in ("secret_key", "jwt_secret_key", "encryption_key"):
        value = str(getattr(s, key_name, "") or "")
        lowered = value.lower()
        if not value:
            record(FAIL, f"{key_name.upper()} is empty",
                   "This security key is missing. The app is not safe to "
                   "run without it.")
        elif any(m.lower() in lowered for m in weak_markers) or len(value) < 24:
            record(FAIL, f"{key_name.upper()} looks weak or default",
                   "This key appears to be a sample/guessable value. "
                   "Generate a long random one. In a terminal you can run:\n"
                   "    python -c \"import secrets; print(secrets.token_urlsafe(48))\"")
        else:
            record(PASS, f"{key_name.upper()} looks strong",
                   "Long and random — good.")

    # 4 — Email
    if getattr(s, "sendgrid_api_key", ""):
        record(PASS, "Email sending is configured (SendGrid)",
               "Staff invitations and password resets will actually send.")
    else:
        record(FAIL, "Email sending is NOT configured",
               "No SENDGRID_API_KEY in .env. Staff invites and password "
               "resets will not be delivered. See PLATFORM_RUNDOWN "
               "section 2.2 for the 10-minute setup.")

    # 5 — File storage
    if getattr(s, "azure_storage_connection_string", "") and \
            "AccountName=..." not in str(getattr(s, "azure_storage_connection_string", "")):
        record(PASS, "Document storage is configured (Azure Blob)",
               "Uploaded files (orders, insurance cards) will be stored.")
    else:
        record(FAIL, "Document storage is NOT configured",
               "Azure Blob Storage credentials are missing. Document "
               "uploads will fail. See PLATFORM_RUNDOWN section 2.7.")

    # 6 — Debug flag
    if getattr(s, "debug", False) and s.app_env == "production":
        record(FAIL, "DEBUG is on in production",
               "Debug mode can leak internal details in error messages. "
               "Set DEBUG=false in .env.")
    else:
        record(PASS, "Debug mode is appropriately set", "")


def check_database_for_demo_accounts() -> None:
    """Look for leftover demo accounts in the database (synchronously)."""
    try:
        import asyncio
        from sqlalchemy import text
        from sqlalchemy.ext.asyncio import create_async_engine
        from app.config import get_settings

        async def _run() -> tuple[int, int]:
            engine = create_async_engine(get_settings().database_url)
            async with engine.connect() as conn:
                demo_orgs = (await conn.execute(text(
                    "SELECT COUNT(*) FROM organizations "
                    "WHERE slug = 'arlington-home-health'"
                ))).scalar() or 0
                bad_hashes = (await conn.execute(text(
                    "SELECT COUNT(*) FROM users "
                    "WHERE password_hash LIKE '%DEMO_HASH%'"
                ))).scalar() or 0
            await engine.dispose()
            return demo_orgs, bad_hashes

        demo_orgs, bad_hashes = asyncio.run(_run())

        if demo_orgs:
            record(FAIL, "Demo organization still exists in the database",
                   "The 'Arlington Home Health' demo clinic is still "
                   "present. Run database/remove_demo_data.sql before "
                   "launch.")
        else:
            record(PASS, "No demo organization in the database", "")

        if bad_hashes:
            record(FAIL, f"{bad_hashes} account(s) have placeholder passwords",
                   "Some users still have the 'DEMO_HASH' placeholder "
                   "instead of a real password. Remove them with "
                   "remove_demo_data.sql or recreate them properly.")
        else:
            record(PASS, "No placeholder-password accounts found", "")

    except Exception as exc:
        record(WARN, "Could not check the database",
               f"Skipped the database inspection ({exc}). Make sure the "
               "database is running and DATABASE_URL is correct, then "
               "run this check again.")


def check_code_for_leftovers() -> None:
    """Scan the backend source code for known dangerous leftovers."""
    app_dir = Path(__file__).resolve().parents[1] / "app"
    if not app_dir.exists():
        record(WARN, "Could not find the app folder to scan", str(app_dir))
        return

    patterns = {
        r'"invite_token":\s*invite_token':
            ("Invite token is exposed in an API response",
             "backend code still returns the secret invite link token to "
             "whoever calls the staff-invite endpoint. Apply the "
             "clinical_ops.py patch from PATCHES.md."),
        r"ChangeMe!123":
            ("A shared default password exists in the code",
             "All invited staff would share a known temporary password. "
             "Apply the clinical_ops.py patch from PATCHES.md."),
        r"demo_mfa|mfa_demo|demo_code|show_mfa":
            ("Demo MFA code display may still exist",
             "Found code that may show the 2FA code on screen. Make sure "
             "it only runs when APP_ENV is 'development'."),
    }

    found_any = False
    for py_file in app_dir.rglob("*.py"):
        try:
            content = py_file.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for pattern, (title, explanation) in patterns.items():
            if re.search(pattern, content):
                found_any = True
                record(FAIL, title,
                       f"{explanation}\n    Found in: {py_file}")

    if not found_any:
        record(PASS, "No known dangerous code leftovers found",
               "Scanned all backend files for demo passwords, leaked "
               "tokens, and demo MFA displays.")


def main() -> None:
    print("=" * 64)
    print("  WODOGA — PRODUCTION SAFETY CHECK")
    print("=" * 64)

    check_settings()
    check_database_for_demo_accounts()
    check_code_for_leftovers()

    print()
    fails = 0
    for status, title, explanation in results:
        print(f"{status}  {title}")
        if explanation:
            for line in explanation.split("\n"):
                print(f"        {line}")
        if status == FAIL:
            fails += 1
        print()

    print("=" * 64)
    if fails:
        print(f"  RESULT: {fails} item(s) MUST be fixed before launch.")
    else:
        print("  RESULT: All checks passed. ✓")
    print("=" * 64)


if __name__ == "__main__":
    main()
