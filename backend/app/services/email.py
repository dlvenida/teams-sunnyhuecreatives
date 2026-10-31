"""Monday-style branded emails via Resend.

Every template shares one shell: pink gradient header, white card, detail rows,
and a big CTA button. If RESEND_API_KEY is not set, sends are skipped gracefully
(the in-app notification still happens) and functions return False.
"""
import html as _html

import resend

from app.config import settings

PRIMARY = "#ec4899"
DARK = "#500724"


def _esc(v) -> str:
    return _html.escape(str(v)) if v is not None else ""


def branded_email(title: str, preheader: str, body_html: str, cta_label: str | None = None, cta_url: str | None = None, accent: str = PRIMARY) -> str:
    cta = ""
    if cta_label and cta_url:
        cta = f"""
        <tr><td style="padding:8px 32px 28px;">
          <a href="{_esc(cta_url)}" style="display:inline-block;background:{accent};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 28px;border-radius:999px;box-shadow:0 8px 20px -6px {accent};">{_esc(cta_label)}</a>
        </td></tr>"""
    logo = f"{settings.app_url.rstrip('/')}/brand/sunnyhue-logo.png"
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{_esc(title)}</title></head>
<body style="margin:0;padding:0;background:#fff1f5;font-family:Georgia,'Times New Roman',serif;color:{DARK};">
<span style="display:none;max-height:0;overflow:hidden;">{_esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff1f5;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 16px 40px -16px rgba(236,72,153,.35);">
  <tr><td style="background:linear-gradient(120deg,#f9a8d4,#ec4899 45%,#db2777);padding:22px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="64" valign="middle"><img src="{_esc(logo)}" width="56" height="56" alt="Sunny Hue Creatives" style="display:block;border-radius:12px;border:2px solid rgba(255,255,255,.5);" /></td>
      <td style="padding-left:14px;" valign="middle">
        <div style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-.02em;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">sunnyhue creatives</div>
        <div style="font-size:12px;color:#ffe4f1;margin-top:2px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Work that shines · since 2020 💕</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:26px 32px 6px;">
    <h1 style="margin:0;font-size:22px;line-height:1.35;letter-spacing:-.02em;font-style:italic;color:#be185d;">{_esc(title)}</h1>
  </td></tr>
  <tr><td style="padding:6px 32px 18px;font-size:15px;line-height:1.7;color:#831843;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">{body_html}</td></tr>
  {cta}
  <tr><td style="padding:16px 32px;background:#fff7fa;border-top:1px solid #fce7f3;font-size:11px;color:#be185d;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    You're receiving this because you're part of the Sunny Hue Creatives family. Spread kindness and do cute work. 🌸
    <br><a href="{_esc(settings.app_url)}" style="color:{PRIMARY};font-weight:600;text-decoration:none;">Open Teams.SHC →</a>
  </td></tr>
</table>
<p style="font-size:11px;color:#f9a8d4;margin:14px 0 0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">© Sunny Hue Creatives · Dumaguete City, Philippines</p>
</td></tr></table>
</body></html>"""


def detail_rows(rows: list[tuple[str, str]]) -> str:
    items = "".join(
        f"""<tr>
          <td style="padding:8px 12px;font-size:12px;color:#9d174d;background:#fff7fa;border-bottom:1px solid #fce7f3;width:34%;font-weight:600;">{_esc(k)}</td>
          <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #fce7f3;">{_esc(v)}</td>
        </tr>"""
        for k, v in rows if v
    )
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #fce7f3;border-radius:12px;overflow:hidden;margin:12px 0;">{items}</table>'


def _resend_config() -> tuple[str, str, str]:
    """Resend config from Settings (DB) first, env second. Returns (api_key, from_email, admin_email).

    The from address stays the configured resend_from_email. The code default is
    onboarding@resend.dev — Resend's sandbox sender. Do not replace that fallback
    with a Sunny Hue address; an unverified domain is rejected and the send fails.
    """
    api_key, from_email, admin_email = settings.resend_api_key, settings.resend_from_email, settings.admin_notify_email
    try:
        from app.database import SessionLocal
        from app.models import SystemSetting
        db = SessionLocal()
        try:
            row = db.query(SystemSetting).filter(SystemSetting.key == "company").first()
            if row and row.value:
                api_key = row.value.get("resend_api_key") or api_key
                from_email = row.value.get("resend_from_email") or from_email
                admin_email = row.value.get("admin_notify_email") or admin_email
        finally:
            db.close()
    except Exception:
        pass
    return api_key, from_email, admin_email


def _log_email(to_email: str, subject: str, status: str, template_key: str | None = None, error: str | None = None) -> None:
    try:
        from app.database import SessionLocal
        from app.models import EmailLog
        db = SessionLocal()
        try:
            db.add(EmailLog(to_email=to_email or "", subject=subject, status=status, template_key=template_key, error=error))
            db.commit()
        finally:
            db.close()
    except Exception:
        pass


def send_email(to_email: str, subject: str, html_body: str, template_key: str | None = None) -> bool:
    api_key, from_email, _ = _resend_config()
    if not api_key or not to_email:
        _log_email(to_email, subject, "skipped", template_key, None if to_email else "No recipient")
        return False
    resend.api_key = api_key
    try:
        resend.Emails.send({"from": from_email, "to": [to_email], "subject": subject, "html": html_body})
        _log_email(to_email, subject, "sent", template_key)
        return True
    except Exception as exc:
        _log_email(to_email, subject, "failed", template_key, str(exc)[:300])
        return False


def email_cta_url(role, link: str | None) -> str | None:
    """Absolute button URL for a board deep link.

    VAs go to /va/tasks or /va/projects. Admin and auditor go to /admin/....
    A bare /tasks or /projects path is never returned.
    """
    if not link:
        return None
    raw = str(link).strip()
    base = (settings.app_url or "").rstrip("/")
    if raw.startswith("http://") or raw.startswith("https://"):
        if base and raw.startswith(base):
            raw = raw[len(base):] or "/"
        else:
            return raw
    role_val = role.value if hasattr(role, "value") else str(role or "")
    prefix = "/va" if role_val == "va" else "/admin"
    path = raw if raw.startswith("/") else f"/{raw}"

    def _matches(candidate: str) -> bool:
        return path == candidate or path.startswith(candidate + "?") or path.startswith(candidate + "/") or path.startswith(candidate + "#")

    for board in ("/tasks", "/projects"):
        if _matches(board):
            path = f"{prefix}{path}"
            break
        rewritten = False
        for old in ("/va", "/admin"):
            candidate = f"{old}{board}"
            if _matches(candidate):
                path = f"{prefix}{path[len(old):]}"
                rewritten = True
                break
        if rewritten:
            break
    return f"{base}{path}"


def render_template(db, key: str, variables: dict, cta_url: str | None = None) -> tuple[str, str] | None:
    """Render an active DB email template with {{variables}}. Returns (subject, full_html) or None.

    Pass cta_url to put a role-specific deep link on the button (task id, and comment id
    when the event is a comment or mention). Stored template URLs are used only when
    the caller does not supply one.
    """
    try:
        from app.models import EmailTemplate
        t = db.query(EmailTemplate).filter(EmailTemplate.key == key, EmailTemplate.is_active.is_(True)).first()
        if not t:
            return None

        def fill(text: str, escape: bool = True) -> str:
            out = text or ""
            for k, v in variables.items():
                out = out.replace("{{" + k + "}}", _esc(v) if escape else str(v if v is not None else ""))
            return out

        subject = fill(t.subject, escape=False)
        stored = fill(t.cta_url) if t.cta_url else None
        button = cta_url or stored
        return subject, branded_email(subject, subject, fill(t.body_html), t.cta_label, button)
    except Exception:
        return None


# ── Legacy helpers (kept) ──────────────────────────────────────────────
def send_email_verification(to_email: str, code: str, display_name: str) -> tuple[bool, str | None]:
    """Send verification code. Returns (sent, dev_code if Resend unavailable)."""
    html_body = branded_email(
        "Verify your new email",
        f"Your Teams.SHC code is {code}",
        f"<p>Hi {_esc(display_name)},</p><p>Your verification code is:</p>"
        f'<p style="font-size:30px;font-weight:800;letter-spacing:6px;color:{PRIMARY};margin:10px 0;">{_esc(code)}</p>'
        "<p>This code expires in 15 minutes. If you did not request this change, you can ignore this email.</p>",
    )
    if not _resend_config()[0]:
        return False, code
    sent = send_email(to_email, "Verify your new Teams.SHC email", html_body, template_key="email_verification")
    return (True, None) if sent else (False, None)


def send_va_submission_notification(va_name: str, client_name: str, hours: str, work_date: str, description: str) -> bool:
    html_body = branded_email(
        f"New time log from {va_name}",
        f"{va_name} logged {hours}h for {client_name}",
        f"<p>A VA just submitted a time log for review.</p>" + detail_rows([
            ("VA", va_name), ("Client", client_name), ("Date", work_date), ("Hours", hours), ("Work", description),
        ]),
        "Review in All Logs", f"{settings.app_url}/admin/logs",
    )
    return send_email(_resend_config()[2], f"New submission from {va_name} — {client_name}", html_body, template_key="log_submitted")


def send_timesheet_submitted_notification(
    va_name: str,
    period_start: str,
    period_end: str,
    hours: str,
    entry_count: int,
) -> bool:
    """Email admins and Project Managers when a VA submits a timesheet for review.

    Recipient addresses are copied out and the read session is closed before any send,
    so mail is not sent inside a transaction that can still roll back.
    """
    from app.models import User, UserRole
    from app.database import SessionLocal

    html_body = branded_email(
        f"Timesheet waiting for review — {va_name}",
        f"{va_name} submitted {hours} hrs for {period_start} – {period_end}",
        (
            f"<p><strong>{_esc(va_name)}</strong> submitted their timesheet and it’s waiting for your approval.</p>"
            + detail_rows([
                ("VA", va_name),
                ("Period", f"{period_start} – {period_end}"),
                ("Hours", hours),
                ("Entries", str(entry_count)),
            ])
            + "<p>Open VA Payroll → Timesheet Review to approve before generating the payroll PDF.</p>"
        ),
        "Review timesheet",
        f"{settings.app_url}/admin/payroll",
    )
    subject = f"📋 Timesheet submitted by {va_name} — awaiting approval"
    recipients: list[str] = []
    db = None
    try:
        db = SessionLocal()
        rows = db.query(User).filter(
            User.role.in_([UserRole.admin, UserRole.auditor]),
            User.is_active.is_(True),
        ).all()
        recipients = [row.email for row in rows if row.email]
    except Exception:
        recipients = []
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                pass
    sent_any = False
    for email in recipients:
        if send_email(email, subject, html_body, template_key="timesheet_submitted"):
            sent_any = True
    if not sent_any:
        fallback = _resend_config()[2]
        if fallback:
            return send_email(fallback, subject, html_body, template_key="timesheet_submitted")
    return sent_any
