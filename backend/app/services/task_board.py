"""Task board helpers: Approved status, link labels, and staff note timestamps."""
from datetime import datetime
from zoneinfo import ZoneInfo

from app.models import UserRole

TEAM_TIMEZONE = "Asia/Manila"
ZERO_DURATION_MESSAGE = "Please enter your actual work duration."

LINK_DEFAULTS = {
    "google_drive": "Google Drive link",
    "dropbox": "Dropbox link",
}
LEGACY_LINK_NAMES = {
    "Google Drive file",
    "Dropbox file",
    "Google Drive link",
    "Dropbox link",
}

STATUS_ORDER = ("todo", "in_progress", "in_review", "approved", "done", "blocked")


def status_notice(old: str, new: str) -> str | None:
    """Staff moving a task to Approved tells the VA it was approved.

    Jumping from In Review straight to Done is the same approval.
    Sending it back from In Review is a rejection. Done after Approved is just completion.
    """
    if new == "approved" and old != "approved":
        return "approved"
    if new == "done" and old == "in_review":
        return "approved"
    if old == "in_review" and new not in ("approved", "done", "in_review"):
        return "rejected"
    return None


def can_edit_staff_notes(role: UserRole | str) -> bool:
    value = role.value if isinstance(role, UserRole) else role
    return value in (UserRole.admin.value, UserRole.auditor.value)


def display_link_label(provider: str | None, original_name: str | None) -> str:
    """Custom labels win. Blank and older default names stay the current label."""
    name = (original_name or "").strip()
    fallback = LINK_DEFAULTS.get(provider or "", "Link")
    if not name or name in LEGACY_LINK_NAMES:
        return fallback
    return name


def clean_link_label(label: str | None, provider: str) -> str:
    cleaned = " ".join((label or "").split())
    if not cleaned:
        return LINK_DEFAULTS.get(provider, "Link")
    if len(cleaned) > 80:
        raise ValueError("Label must be 80 characters or fewer.")
    return cleaned


def format_team_timestamp(when: datetime, tz_name: str = TEAM_TIMEZONE) -> str:
    """November 4, 2026 at 10:00 AM in the team time zone."""
    try:
        zone = ZoneInfo(tz_name or TEAM_TIMEZONE)
    except Exception:
        zone = ZoneInfo(TEAM_TIMEZONE)
    if when.tzinfo is None:
        when = when.replace(tzinfo=ZoneInfo("UTC"))
    local = when.astimezone(zone)
    clock = local.strftime("%I:%M %p").lstrip("0")
    return f"{local.strftime('%B')} {local.day}, {local.year} at {clock}"
