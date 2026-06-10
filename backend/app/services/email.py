"""
Wodoga Platform — Email Service (SendGrid)

Sends transactional emails: staff invitations, password resets,
and patient portal invitations.

HOW IT BEHAVES:
- If SENDGRID_API_KEY is set in .env  → emails actually send.
- If SENDGRID_API_KEY is empty        → nothing sends; a warning is
  logged so you can see exactly what *would* have been sent.
  Nothing ever crashes because email is unconfigured.

This module uses SendGrid's plain REST API through httpx (which the
backend already depends on), so no new packages need to be installed.
"""

from __future__ import annotations

import logging
from typing import Optional

import httpx

from app.config import get_settings

logger = logging.getLogger("wodoga.email")
settings = get_settings()

_SENDGRID_URL = "https://api.sendgrid.com/v3/mail/send"


def is_email_configured() -> bool:
    """True when a SendGrid API key is present."""
    return bool(getattr(settings, "sendgrid_api_key", ""))


async def _send(
    to_email: str,
    subject: str,
    html_body: str,
    plain_body: Optional[str] = None,
) -> bool:
    """
    Low-level send. Returns True on success, False on any failure.
    Failures are logged but NEVER raised — a broken email provider
    must never block a clinical workflow.
    """
    if not is_email_configured():
        logger.warning(
            "EMAIL NOT SENT (SendGrid not configured). To: %s | Subject: %s",
            to_email, subject,
        )
        return False

    payload = {
        "personalizations": [{"to": [{"email": to_email}]}],
        "from": {
            "email": settings.email_from,
            "name": settings.email_from_name,
        },
        "subject": subject,
        "content": [
            {"type": "text/plain", "value": plain_body or _strip_html(html_body)},
            {"type": "text/html", "value": html_body},
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                _SENDGRID_URL,
                headers={
                    "Authorization": f"Bearer {settings.sendgrid_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if response.status_code in (200, 201, 202):
            logger.info("Email sent to %s: %s", to_email, subject)
            return True
        logger.error(
            "SendGrid rejected email to %s (HTTP %s): %s",
            to_email, response.status_code, response.text[:500],
        )
        return False
    except Exception as exc:  # noqa: BLE001 — email must never crash the app
        logger.error("Email send failed to %s: %s", to_email, exc)
        return False


def _strip_html(html: str) -> str:
    """Very small fallback plain-text version of an HTML email."""
    import re
    text = re.sub(r"<br\s*/?>", "\n", html)
    text = re.sub(r"</p>", "\n\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    return text.strip()


def _frontend_base_url() -> str:
    """
    The address of the website users click through to.
    Uses the first entry in ALLOWED_ORIGINS that is not localhost,
    falling back to localhost for development.
    """
    origins = [o.strip() for o in str(settings.allowed_origins).split(",") if o.strip()]
    for origin in origins:
        if "localhost" not in origin and "127.0.0.1" not in origin:
            return origin.rstrip("/")
    return (origins[0].rstrip("/") if origins else "http://localhost:3000")


# ════════════════════════════════════════════════════════════════
# PUBLIC EMAIL TYPES
# ════════════════════════════════════════════════════════════════

async def send_staff_invite(
    to_email: str,
    first_name: str,
    organization_name: str,
    invite_token: str,
) -> bool:
    """
    Sent when an admin invites a new staff member.
    Contains a one-time link where they set their own password.
    The link expires in 48 hours.
    """
    link = f"{_frontend_base_url()}/accept-invite?token={invite_token}"
    subject = f"You've been invited to {organization_name} on Wodoga"
    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color: #1B4332;">Welcome to Wodoga</h2>
      <p>Hi {first_name},</p>
      <p><strong>{organization_name}</strong> has invited you to join their
         team on the Wodoga clinical platform.</p>
      <p>Click the button below to create your password and set up
         two-factor authentication. This link expires in <strong>48 hours</strong>.</p>
      <p style="margin: 28px 0;">
        <a href="{link}"
           style="background: #1B4332; color: #ffffff; padding: 12px 24px;
                  border-radius: 6px; text-decoration: none; font-weight: bold;">
          Set Up My Account
        </a>
      </p>
      <p style="color: #666; font-size: 13px;">
        If the button doesn't work, copy and paste this address into your browser:<br>
        {link}
      </p>
      <p style="color: #666; font-size: 13px;">
        If you weren't expecting this invitation, you can safely ignore this email.
      </p>
    </div>
    """
    return await _send(to_email, subject, html)


async def send_password_reset(
    to_email: str,
    first_name: str,
    reset_token: str,
) -> bool:
    """Sent when a user requests a password reset. Link expires in 1 hour."""
    link = f"{_frontend_base_url()}/reset-password?token={reset_token}"
    subject = "Reset your Wodoga password"
    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color: #1B4332;">Password Reset</h2>
      <p>Hi {first_name},</p>
      <p>We received a request to reset your Wodoga password.
         Click the button below to choose a new one.
         This link expires in <strong>1 hour</strong>.</p>
      <p style="margin: 28px 0;">
        <a href="{link}"
           style="background: #1B4332; color: #ffffff; padding: 12px 24px;
                  border-radius: 6px; text-decoration: none; font-weight: bold;">
          Reset My Password
        </a>
      </p>
      <p style="color: #666; font-size: 13px;">
        If you didn't request this, ignore this email — your password
        will not change.
      </p>
    </div>
    """
    return await _send(to_email, subject, html)


async def send_portal_invite(
    to_email: str,
    first_name: str,
    organization_name: str,
    invite_token: str,
) -> bool:
    """Sent when a patient is given access to the patient portal."""
    link = f"{_frontend_base_url()}/portal/accept-invite?token={invite_token}"
    subject = f"Your patient portal access — {organization_name}"
    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color: #1B4332;">Your Patient Portal</h2>
      <p>Hi {first_name},</p>
      <p><strong>{organization_name}</strong> has set up secure online access
         to your care information — including your care plan, visit schedule,
         and messages with your care team.</p>
      <p style="margin: 28px 0;">
        <a href="{link}"
           style="background: #1B4332; color: #ffffff; padding: 12px 24px;
                  border-radius: 6px; text-decoration: none; font-weight: bold;">
          Activate My Portal Account
        </a>
      </p>
      <p style="color: #666; font-size: 13px;">
        This link expires in 48 hours. Your health information is encrypted
        and private. If you weren't expecting this email, please contact
        {organization_name} directly.
      </p>
    </div>
    """
    return await _send(to_email, subject, html)
