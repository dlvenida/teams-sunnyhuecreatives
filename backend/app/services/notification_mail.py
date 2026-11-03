"""Important-event emails. Same words as the in-app bell, Sunny Hue styling, one direct link.

Routine updates (new tasks, time logs, project edits, reactions, payroll marked paid)
never come through here.
"""
from __future__ import annotations

import html as _html

from app.config import settings
from app.services.email import send_email

# Events that may email whoever the in-app notification is for (VA, Project Manager, or Admin).
IMPORTANT_TEMPLATE_KEYS = {
    "mention",
    "task_comment",
    "task_assigned",
    "project_assigned",
    "task_updated",
    "task_approved",
    "task_rejected",
    "deadline_soon",
    "deadline_overdue",
    "timesheet_submitted",
    "timesheet_approved",
    "timesheet_rejected",
    "rate_request",
    "inactive_va",
}


def actor_first(name: str | None) -> str:
    raw = (name or "").strip()
    if not raw:
        return "Someone"
    return raw.split()[0]


def notification_html(
    title: str,
    paragraphs: list[str],
    link_url: str,
    link_label: str,
    *,
    logo_src: str | None = None,
    font_css: str | None = None,
) -> str:
    """One blush card, italic heading, one link. No second destination."""
    logo = logo_src or f"{settings.app_url.rstrip('/')}/brand/sunnyhue-logo.png"
    fonts = font_css or (
        "<link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?"
        "family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,600;0,9..40,700"
        "&family=Instrument+Serif:ital@1&display=swap\">"
    )
    body = "".join(
        f"<p style=\"margin:0 0 12px;font-family:'DM Sans',Arial,sans-serif;font-size:16px;line-height:1.55;color:#3D2B33;\">{_html.escape(p)}</p>"
        for p in paragraphs
        if p
    )
    safe_url = _html.escape(link_url, quote=True)
    safe_label = _html.escape(link_label)
    safe_title = _html.escape(title)
    safe_logo = _html.escape(logo, quote=True)
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
{fonts}
<title>{safe_title}</title></head>
<body style="margin:0;padding:0;background:#FDF2F5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FDF2F5;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:18px;">
  <tr><td style="height:8px;background:#F7C6D3;border-radius:18px 18px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
  <tr><td style="background:#FDF2F5;padding:28px 32px 6px;">
    <img src="{safe_logo}" alt="Sunny Hue Creatives" height="64" style="display:block;height:64px;width:auto;border:0;">
  </td></tr>
  <tr><td style="background:#FDF2F5;padding:4px 32px 22px;">
    <h1 style="margin:0;font-family:'Instrument Serif',Georgia,serif;font-style:italic;font-weight:400;font-size:32px;line-height:1.15;color:#E8578A;">{safe_title}</h1>
  </td></tr>
  <tr><td style="padding:22px 32px 28px;">
    {body}
    <p style="margin:20px 0 0;">
      <a href="{safe_url}" style="display:inline-block;background:#B8325F;color:#ffffff;text-decoration:none;font-family:'DM Sans',Arial,sans-serif;font-weight:700;font-size:14px;padding:12px 22px;border-radius:999px;">{safe_label}</a>
    </p>
    <p style="margin:14px 0 0;font-family:'DM Sans',Arial,sans-serif;font-size:13px;line-height:1.4;">
      <a href="{safe_url}" style="color:#B8325F;text-decoration:underline;">{safe_url}</a>
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>"""


def send_notification_email(
    to_email: str,
    subject: str,
    title: str,
    paragraphs: list[str],
    link_url: str,
    link_label: str,
    template_key: str,
) -> bool:
    if template_key not in IMPORTANT_TEMPLATE_KEYS:
        return False
    html = notification_html(title, paragraphs, link_url, link_label)
    return send_email(to_email, subject, html, template_key=template_key)


def absolute_link(path: str, role=None) -> str:
    from app.services.notifications import _link_for_role

    resolved = _link_for_role(path, role) or path or ""
    if resolved.startswith("http://") or resolved.startswith("https://"):
        return resolved
    if not resolved.startswith("/"):
        resolved = "/" + resolved
    return f"{settings.app_url.rstrip('/')}{resolved}"


def email_user_ids(
    db,
    user_ids,
    *,
    title: str,
    paragraphs: list[str],
    link: str,
    template_key: str,
    link_label: str = "Open in Teams.SHC",
    event_key: str | None = None,
) -> int:
    """Email each recipient. A VA who turned this event's email off is skipped. Admin and PM are not."""
    from app.models import User
    from app.services.notification_prefs import va_channel_enabled

    ids = []
    for uid in user_ids or []:
        if uid and uid not in ids:
            ids.append(uid)
    if not ids:
        return 0
    users = db.query(User).filter(User.id.in_(ids), User.is_active.is_(True)).all()
    sent = 0
    for user in users:
        if not getattr(user, "email", None):
            continue
        if not va_channel_enabled(user, event_key, "email"):
            continue
        url = absolute_link(link, getattr(user, "role", None))
        if send_notification_email(user.email, title, title, paragraphs, url, link_label, template_key):
            sent += 1
    return sent
