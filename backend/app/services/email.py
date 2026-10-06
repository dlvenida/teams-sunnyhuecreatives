import random

import resend

from app.config import settings


def send_email_verification(to_email: str, code: str, display_name: str) -> tuple[bool, str | None]:
    """Send verification code. Returns (sent, dev_code if Resend unavailable)."""
    html = f"""
    <h2>Verify your new email</h2>
    <p>Hi {display_name},</p>
    <p>Your Teams.SHC verification code is:</p>
    <p style="font-size:28px;font-weight:bold;letter-spacing:4px;">{code}</p>
    <p>This code expires in 15 minutes.</p>
    <p>If you did not request this change, you can ignore this email.</p>
    """
    if not settings.resend_api_key:
        return False, code
    resend.api_key = settings.resend_api_key
    try:
        resend.Emails.send(
            {
                "from": settings.resend_from_email,
                "to": [to_email],
                "subject": "Verify your new Teams.SHC email",
                "html": html,
            }
        )
        return True, None
    except Exception:
        return False, None


def send_va_submission_notification(
    va_name: str,
    client_name: str,
    hours: str,
    work_date: str,
    description: str,
) -> bool:
    if not settings.resend_api_key:
        return False

    resend.api_key = settings.resend_api_key
    html = f"""
    <h2>New VA Work Log Submission</h2>
    <p><strong>VA:</strong> {va_name}</p>
    <p><strong>Client:</strong> {client_name}</p>
    <p><strong>Date:</strong> {work_date}</p>
    <p><strong>Hours:</strong> {hours}</p>
    <p><strong>Description:</strong> {description}</p>
    <p><a href="{settings.app_url}/admin/logs">Review in dashboard</a></p>
    """
    try:
        resend.Emails.send(
            {
                "from": settings.resend_from_email,
                "to": [settings.admin_notify_email],
                "subject": f"New submission from {va_name} — {client_name}",
                "html": html,
            }
        )
        return True
    except Exception:
        return False
