"""Per-event pop-up and email switches. Defaults are both on.

Only a VA's switches are applied. Admin and Project Manager delivery stays as it is,
but the same preference shape is stored for them so it can be turned on later.
"""
from __future__ import annotations

VA_EVENT_KEYS = (
    "task_assigned",
    "project_assigned",
    "deadline_soon",
    "deadline_overdue",
    "task_updated",
    "task_comment",
    "task_mention",
    "task_approved",
    "task_rejected",
    "timesheet_approved",
    "timesheet_rejected",
)


def _role(user) -> str:
    role = getattr(user, "role", None)
    return role.value if hasattr(role, "value") else str(role or "")


def va_channel_enabled(user, event_key: str | None, channel: str) -> bool:
    """True unless this VA turned that channel off for the event. Missing means on."""
    if user is None or not event_key or _role(user) != "va":
        return True
    prefs = getattr(user, "notification_preferences", None)
    if not isinstance(prefs, dict):
        return True
    events = prefs.get("events")
    if not isinstance(events, dict):
        return True
    row = events.get(event_key)
    if not isinstance(row, dict) or channel not in row:
        return True
    return bool(row[channel])
