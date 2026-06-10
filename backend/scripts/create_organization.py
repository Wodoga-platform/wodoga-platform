"""
Wodoga Platform — New Organization Provisioning Script
=======================================================

WHAT THIS DOES (in plain English):
This is the official, safe way to set up a brand-new client clinic.
It creates, in one go:

  1. The organization (the clinic itself)
  2. All six standard roles with the correct permissions
  3. The clinic's first Admin account, with a strong randomly
     generated password that is shown to you EXACTLY ONCE

No demo data. No shared passwords. No placeholder anything.

HOW TO RUN IT:
  1. Open a terminal in the `backend` folder
  2. Make sure your virtual environment is active — you should
     see (venv) at the start of the line
  3. Type:   python scripts/create_organization.py
  4. Answer the questions it asks
  5. Write down the admin password it prints — it is never shown again.
     Give it to the client's admin and tell them to change it on
     first login and enable MFA immediately.
"""

import asyncio
import secrets
import string
import sys
import uuid
from getpass import getpass
from pathlib import Path

# Allow running from the backend folder
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text                              # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine   # noqa: E402

from app.config import get_settings                      # noqa: E402
from app.core.security import hash_password              # noqa: E402

settings = get_settings()


# ── The six standard roles and their permissions ──────────────
ROLE_DEFINITIONS = {
    "admin": (
        "Administrator",
        ["patients:view", "patients:create", "patients:edit", "patients:delete",
         "intake_forms:create", "intake_forms:view",
         "visits:view", "visits:create", "visits:edit", "visits:checkin", "visits:soap_note",
         "care_plans:view", "care_plans:create",
         "vitals:view", "vitals:create",
         "medications:view", "medications:prescribe", "medications:reconcile",
         "pharm_orders:view", "pharm_orders:create", "pharm_orders:advance",
         "referrals:view", "referrals:create", "referrals:advance",
         "billing:view", "billing:create", "billing:update",
         "eligibility:check",
         "oasis:view", "oasis:create",
         "messages:send", "messages:view",
         "documents:view", "documents:upload",
         "staff:view", "staff:manage",
         "audit:view", "notifications:view",
         "reports:view", "organizations:manage"],
    ),
    "provider": (
        "Provider / Physician",
        ["patients:view", "patients:create", "patients:edit",
         "intake_forms:create", "intake_forms:view",
         "visits:view", "visits:create", "visits:edit", "visits:soap_note",
         "care_plans:view", "care_plans:create",
         "vitals:view", "vitals:create",
         "medications:view", "medications:prescribe", "medications:reconcile",
         "pharm_orders:view", "pharm_orders:create",
         "referrals:view", "referrals:create", "referrals:advance",
         "eligibility:check",
         "oasis:view", "oasis:create",
         "messages:send", "messages:view",
         "documents:view", "documents:upload",
         "notifications:view", "reports:view"],
    ),
    "pharmacy": (
        "Pharmacy Staff",
        ["patients:view",
         "medications:view", "medications:reconcile",
         "pharm_orders:view", "pharm_orders:create", "pharm_orders:advance",
         "messages:send", "messages:view",
         "documents:view", "documents:upload",
         "notifications:view"],
    ),
    "biller": (
        "Billing Specialist",
        ["patients:view",
         "billing:view", "billing:create", "billing:update",
         "eligibility:check",
         "messages:send", "messages:view",
         "notifications:view", "reports:view"],
    ),
    "viewer": (
        "Read-Only Viewer",
        ["patients:view", "visits:view", "care_plans:view", "vitals:view",
         "medications:view", "billing:view", "messages:view",
         "documents:view", "notifications:view"],
    ),
    "caregiver": (
        "Caregiver / CNA",
        ["patients:view", "patients:edit",
         "intake_forms:create", "intake_forms:view",
         "visits:view", "visits:create", "visits:checkin", "visits:soap_note",
         "vitals:view", "vitals:create",
         "medications:view",
         "messages:send", "messages:view",
         "documents:view", "documents:upload",
         "notifications:view"],
    ),
    "patient": (
        "Patient Portal",
        ["portal:access", "messages:send", "messages:view", "notifications:view"],
    ),
}


def generate_strong_password(length: int = 20) -> str:
    """A random password with letters, digits, and symbols — never reused."""
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*-_+="
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(length))
        if (any(c.islower() for c in pw) and any(c.isupper() for c in pw)
                and any(c.isdigit() for c in pw)
                and any(c in "!@#$%^&*-_+=" for c in pw)):
            return pw


def slugify(name: str) -> str:
    """Turn 'Arlington Home Health' into 'arlington-home-health'."""
    out = "".join(c.lower() if c.isalnum() else "-" for c in name)
    while "--" in out:
        out = out.replace("--", "-")
    return out.strip("-")


def ask(prompt: str, required: bool = True, default: str = "") -> str:
    while True:
        suffix = f" [{default}]" if default else ""
        value = input(f"{prompt}{suffix}: ").strip() or default
        if value or not required:
            return value
        print("  → This one is required, please enter a value.")


async def main() -> None:
    print("=" * 62)
    print("  WODOGA — CREATE A NEW CLIENT ORGANIZATION")
    print("=" * 62)
    print()

    # ── Gather information ─────────────────────────────────────
    org_name = ask("Clinic / organization name")
    org_slug = ask("Short web name (letters and dashes only)",
                   default=slugify(org_name))
    org_type = ask("Type — home_health, pharmacy, or both", default="both")
    if org_type not in ("home_health", "pharmacy", "both"):
        print("  → Unknown type, using 'both'.")
        org_type = "both"
    org_email = ask("Organization contact email")
    org_phone = ask("Organization phone", required=False)
    org_city  = ask("City", required=False)
    org_state = ask("State (2 letters, e.g. TX)", required=False)
    tier      = ask("Subscription tier — trial, basic, professional, enterprise",
                    default="trial")
    if tier not in ("trial", "basic", "professional", "enterprise"):
        tier = "trial"

    print()
    print("Now the clinic's FIRST ADMIN account:")
    admin_first = ask("Admin first name")
    admin_last  = ask("Admin last name")
    admin_email = ask("Admin email (they will log in with this)")

    baa = ask("Has this client signed your HIPAA Business Associate "
              "Agreement? (yes/no)", default="no").lower().startswith("y")
    baa_by = ask("Signed by (name)", required=False) if baa else None

    admin_password = generate_strong_password()
    password_hash  = hash_password(admin_password)

    org_id   = str(uuid.uuid4())
    admin_id = str(uuid.uuid4())

    # ── Write to the database ──────────────────────────────────
    engine = create_async_engine(settings.database_url)
    async with engine.begin() as conn:
        # Bypass row-level security for provisioning: this script is run
        # by you (the platform owner), not through the app.
        await conn.execute(
            text("SET app.organization_id = :org"), {"org": org_id}
        )

        existing = await conn.execute(
            text("SELECT id FROM organizations WHERE slug = :slug"),
            {"slug": org_slug},
        )
        if existing.first():
            print(f"\n✗ An organization with the web name '{org_slug}' "
                  "already exists. Nothing was created.")
            return

        await conn.execute(
            text("""
                INSERT INTO organizations (
                    id, name, slug, type, email, phone, city, state,
                    subscription_tier, subscription_status,
                    hipaa_baa_signed, hipaa_baa_signed_at, hipaa_baa_signed_by
                ) VALUES (
                    :id, :name, :slug, :type, :email, :phone, :city, :state,
                    :tier, 'active',
                    :baa, CASE WHEN :baa THEN NOW() ELSE NULL END, :baa_by
                )
            """),
            {"id": org_id, "name": org_name, "slug": org_slug,
             "type": org_type, "email": org_email, "phone": org_phone or None,
             "city": org_city or None, "state": org_state or None,
             "tier": tier, "baa": baa, "baa_by": baa_by},
        )

        admin_role_id = None
        for role_name, (display, perms) in ROLE_DEFINITIONS.items():
            role_id = str(uuid.uuid4())
            if role_name == "admin":
                admin_role_id = role_id
            import json
            await conn.execute(
                text("""
                    INSERT INTO roles (id, organization_id, name,
                                       display_name, permissions)
                    VALUES (:id, :org, :name, :display, CAST(:perms AS jsonb))
                """),
                {"id": role_id, "org": org_id, "name": role_name,
                 "display": display, "perms": json.dumps(perms)},
            )

        await conn.execute(
            text("""
                INSERT INTO users (
                    id, organization_id, role_id,
                    first_name, last_name, email,
                    password_hash, is_active, is_email_verified
                ) VALUES (
                    :id, :org, :role,
                    :fn, :ln, :email,
                    :pw, TRUE, TRUE
                )
            """),
            {"id": admin_id, "org": org_id, "role": admin_role_id,
             "fn": admin_first, "ln": admin_last,
             "email": admin_email.lower(), "pw": password_hash},
        )

        await conn.execute(
            text("""
                INSERT INTO audit_logs (organization_id, user_id, action,
                                        description)
                VALUES (:org, :uid, 'ORGANIZATION_CREATED',
                        :description)
            """),
            {"org": org_id, "uid": admin_id,
             "description": f"Organization '{org_name}' provisioned with "
                            f"admin {admin_first} {admin_last}"},
        )

    await engine.dispose()

    # ── Show the result exactly once ───────────────────────────
    print()
    print("=" * 62)
    print("  ✓ ORGANIZATION CREATED SUCCESSFULLY")
    print("=" * 62)
    print(f"  Organization : {org_name}")
    print(f"  Admin login  : {admin_email.lower()}")
    print(f"  Admin password (SHOWN ONLY ONCE — write it down now):")
    print()
    print(f"      {admin_password}")
    print()
    print("  Next steps for the client's admin:")
    print("   1. Log in and CHANGE THIS PASSWORD immediately")
    print("   2. Enable MFA (two-factor) in account settings")
    print("   3. Invite their staff from the Staff page")
    print("=" * 62)


if __name__ == "__main__":
    asyncio.run(main())
