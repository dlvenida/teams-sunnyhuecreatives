from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser, get_current_user, require_admin
from app.models import ActivityLog, EmailLog, EmailTemplate, SystemSetting, UserRole
from app.schemas import (
    ActivityLogResponse,
    DisplaySettingsResponse,
    EmailLogResponse,
    EmailTemplateResponse,
    EmailTemplateUpdate,
    EmailTestRequest,
    SettingsResponse,
    SettingsUpdate,
)
from app.services.email import branded_email, render_template, send_email

DEFAULT_TEMPLATES = [
    {"key": "task_assigned", "name": "New Task Assigned", "subject": "📌 New task assigned: {{task_title}}",
     "body_html": "<p>Hi {{name}},</p><p>A new task was assigned to you:</p><p><strong>{{task_title}}</strong><br>Client: {{client}}<br>Project: {{project}}<br>Status: {{status}} · Priority: {{priority}} · Due: {{due}}</p>",
     "cta_label": "Open My Board", "cta_url": "", "variables": ["name", "task_title", "client", "project", "status", "priority", "due"]},
    {"key": "task_updated", "name": "Task Updated", "subject": "🔔 Task updated: {{task_title}}",
     "body_html": "<p>Hi {{name}},</p><p>{{change}}</p><p><strong>{{task_title}}</strong> ({{client}}) was updated by {{actor}}.</p>",
     "cta_label": "View Task", "cta_url": "", "variables": ["name", "task_title", "client", "project", "change", "actor"]},
    {"key": "task_comment", "name": "New Task Comment", "subject": "💬 New comment on: {{task_title}}",
     "body_html": "<p>Hi {{name}},</p><p><strong>{{author}}</strong> commented on <strong>{{task_title}}</strong> ({{client}}):</p><blockquote style='margin:10px 0;padding:10px 14px;background:#fff7fa;border-left:3px solid #ec4899;border-radius:8px;'>{{comment}}</blockquote>",
     "cta_label": "Reply on the Board", "cta_url": "", "variables": ["name", "task_title", "client", "author", "comment"]},
    {"key": "mention", "name": "You Were Mentioned", "subject": "💕 Hey {{name}}, someone tagged you in a task!",
     "body_html": "<p>Hey <strong>{{name}}</strong>! 🌸</p><p>Someone tagged/mentioned you in a task — how sweet!</p><p><strong>{{task_title}}</strong></p><blockquote style='margin:10px 0;padding:10px 14px;background:#fff7fa;border-left:3px solid #ec4899;border-radius:8px;'>{{comment}}</blockquote>",
     "cta_label": "Open the task ✨", "cta_url": "", "variables": ["name", "task_title", "comment"]},
    {"key": "reaction", "name": "Comment Reaction", "subject": "{{emoji}} Someone reacted on your comment",
     "body_html": "<p>Hey <strong>{{name}}</strong>! 💕</p><p><strong>{{author}}</strong> left a {{emoji}} on your comment in <em>{{task_title}}</em>.</p>",
     "cta_label": "Open the task ✨", "cta_url": "", "variables": ["name", "author", "emoji", "task_title"]},
    {"key": "delegation", "name": "Work Delegated to You", "subject": "🤝 Work delegated to you from {{from_name}}",
     "body_html": "<p>Hi {{name}},</p><p>Tasks and history from <strong>{{from_name}}</strong> were delegated to you: {{tasks}} task(s) and {{work_logs}} work log(s) are now synced to your board.</p>",
     "cta_label": "Open My Board", "cta_url": "", "variables": ["name", "from_name", "tasks", "work_logs"]},
    {"key": "log_submitted", "name": "New Time Log Submitted (Admin)", "subject": "🕒 New time log from {{va_name}} — {{client}}",
     "body_html": "<p>A VA just submitted a time log for review.</p><p><strong>{{va_name}}</strong> · {{client}} · {{date}} · {{hours}} hrs<br>{{description}}</p>",
     "cta_label": "Review in All Logs", "cta_url": "", "variables": ["va_name", "client", "date", "hours", "description"]},
    {"key": "log_approved", "name": "Time Log Approved", "subject": "✅ Your time log was approved — {{client}}",
     "body_html": "<p>Hi {{name}},</p><p>Good news — your time log for <strong>{{client}}</strong> on {{date}} ({{hours}} hrs) was approved and now counts toward payroll.</p>",
     "cta_label": "View My Logs", "cta_url": "", "variables": ["name", "client", "date", "hours"]},
    {"key": "log_rejected", "name": "Time Log Needs Changes", "subject": "⚠️ Your time log needs changes — {{client}}",
     "body_html": "<p>Hi {{name}},</p><p>Your time log for <strong>{{client}}</strong> on {{date}} ({{hours}} hrs) was sent back. Please review it and resubmit.</p>",
     "cta_label": "Fix My Log", "cta_url": "", "variables": ["name", "client", "date", "hours"]},
    {"key": "payroll_paid", "name": "Payroll Sent", "subject": "💸 Payroll sent — {{period}}",
     "body_html": "<p>Hi {{name}},</p><p>Your payroll for {{period}} ({{hours}} hrs) has been sent{{method}}. Thank you for the great work!</p>",
     "cta_label": "View My Logs", "cta_url": "", "variables": ["name", "period", "hours", "method"]},
    {"key": "email_verification", "name": "Email Verification Code", "subject": "Verify your new Teams.SHC email",
     "body_html": "<p>Hi {{name}},</p><p>Your verification code is:</p><p style='font-size:30px;font-weight:800;letter-spacing:6px;color:#ec4899;'>{{code}}</p><p>This code expires in 15 minutes.</p>",
     "cta_label": None, "cta_url": None, "variables": ["name", "code"]},
]

SAMPLE_VARS = {
    "name": "Myra", "task_title": "Inbox & email triage", "client": "EmpowerHQ Consulting", "project": "Operations",
    "status": "To Do", "priority": "High", "due": "Oct 25, 2026", "change": "Status moved to In Progress", "actor": "Jane",
    "author": "Jane", "comment": "Great start — please prioritize the finance inbox today.", "from_name": "Peter",
    "tasks": 4, "work_logs": 12, "va_name": "Myra", "date": "Oct 21, 2026", "hours": "3.50",
    "description": "Inbox & email triage", "period": "Oct 13 – Oct 19, 2026", "method": " via Wise", "code": "482913",
}

router = APIRouter(prefix="/settings", tags=["settings"])

DEFAULTS = {
    "company_name": "Sunny Hue Creatives",
    "principal_name": "Jane Laurine Venida",
    "location": "Dumaguete City, Philippines",
    "wise_email": "janelaurine@gmail.com",
    "paypal_email": "janelaurine@gmail.com",
    "hide_pricing": True,
    "booking_url": "",
    "booking_hide_pricing": True,
    "default_va_hourly_rate": "75.00",
    "resend_api_key": "",
    "resend_from_email": "onboarding@resend.dev",
    "admin_notify_email": "janelaurine@gmail.com",
}


def _seed_templates(db: Session) -> None:
    if db.query(EmailTemplate).count() == 0:
        for tpl in DEFAULT_TEMPLATES:
            db.add(EmailTemplate(**tpl))
        db.commit()


def _template_out(t: EmailTemplate) -> EmailTemplateResponse:
    return EmailTemplateResponse(
        id=t.id, key=t.key, name=t.name, subject=t.subject, body_html=t.body_html,
        cta_label=t.cta_label, cta_url=t.cta_url, variables=t.variables or [],
        is_active=bool(t.is_active), updated_at=t.updated_at,
    )


def _get_settings(db: Session) -> dict:
    row = db.query(SystemSetting).filter(SystemSetting.key == "company").first()
    if row:
        return {**DEFAULTS, **row.value}
    return DEFAULTS.copy()


def pricing_hidden(db: Session) -> bool:
    return bool(_get_settings(db).get("hide_pricing", True))


@router.get("/display", response_model=DisplaySettingsResponse)
def get_display_settings(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    s = _get_settings(db)
    # Auditors must never receive money-related defaults
    rate = s.get("default_va_hourly_rate", "75.00")
    if current.role == UserRole.auditor:
        rate = "0"
    return DisplaySettingsResponse(
        hide_pricing=True if current.role == UserRole.auditor else bool(s.get("hide_pricing", True)),
        booking_url=s.get("booking_url") or "",
        booking_hide_pricing=bool(s.get("booking_hide_pricing", True)),
        default_va_hourly_rate=rate,
    )


@router.get("", response_model=SettingsResponse)
def get_settings(
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    return SettingsResponse(**_get_settings(db))


@router.put("", response_model=SettingsResponse)
def update_settings(
    body: SettingsUpdate,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    current = _get_settings(db)
    updates = body.model_dump(exclude_unset=True)
    if "default_va_hourly_rate" in updates and updates["default_va_hourly_rate"] is not None:
        updates["default_va_hourly_rate"] = str(updates["default_va_hourly_rate"])
    current.update(updates)

    row = db.query(SystemSetting).filter(SystemSetting.key == "company").first()
    if row:
        row.value = current
    else:
        db.add(SystemSetting(key="company", value=current))
    db.commit()
    return SettingsResponse(**current)


# ── Email templates ────────────────────────────────────────────────────

@router.get("/email-templates", response_model=list[EmailTemplateResponse])
def list_email_templates(
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    _seed_templates(db)
    return [_template_out(t) for t in db.query(EmailTemplate).order_by(EmailTemplate.name).all()]


@router.put("/email-templates/{key}", response_model=EmailTemplateResponse)
def update_email_template(
    key: str,
    body: EmailTemplateUpdate,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    _seed_templates(db)
    t = db.query(EmailTemplate).filter(EmailTemplate.key == key).first()
    if not t:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(t, field, value)
    db.commit()
    db.refresh(t)
    return _template_out(t)


@router.get("/email-templates/{key}/preview")
def preview_email_template(
    key: str,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    _seed_templates(db)
    rendered = render_template(db, key, SAMPLE_VARS)
    if not rendered:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found or inactive")
    return {"subject": rendered[0], "html": rendered[1]}


@router.post("/email-templates/{key}/test")
def test_email_template(
    key: str,
    body: EmailTestRequest,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    _seed_templates(db)
    rendered = render_template(db, key, SAMPLE_VARS)
    if not rendered:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found or inactive")
    sent = send_email(body.to_email, f"[TEST] {rendered[0]}", rendered[1], template_key=key)
    return {"sent": sent, "to": body.to_email, "message": "Test email sent" if sent else "Not sent — add a Resend API key in Settings → Emails (the attempt was logged in Email Activity)."}


# ── Email activity ─────────────────────────────────────────────────────

@router.get("/email-activity", response_model=list[EmailLogResponse])
def list_email_activity(
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    search: str = "",
    limit: int = 100,
):
    q = db.query(EmailLog).order_by(EmailLog.created_at.desc())
    if search:
        like = f"%{search}%"
        q = q.filter((EmailLog.to_email.ilike(like)) | (EmailLog.subject.ilike(like)) | (EmailLog.template_key.ilike(like)))
    return q.limit(min(limit, 200)).all()


@router.delete("/email-activity/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_email_activity(
    log_id: UUID,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    row = db.query(EmailLog).filter(EmailLog.id == log_id).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Email log not found")
    db.delete(row)
    db.commit()


# ── User activity logs ─────────────────────────────────────────────────

@router.get("/activity-logs", response_model=list[ActivityLogResponse])
def list_activity_logs(
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    search: str = "",
    limit: int = 100,
):
    q = db.query(ActivityLog).order_by(ActivityLog.created_at.desc())
    if search:
        like = f"%{search}%"
        q = q.filter((ActivityLog.user_name.ilike(like)) | (ActivityLog.description.ilike(like)) | (ActivityLog.action.ilike(like)))
    return q.limit(min(limit, 300)).all()


@router.get("/activity-logs/{log_id}", response_model=ActivityLogResponse)
def get_activity_log(
    log_id: UUID,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    row = db.query(ActivityLog).filter(ActivityLog.id == log_id).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Activity log not found")
    return row


@router.delete("/activity-logs/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_activity_log(
    log_id: UUID,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    row = db.query(ActivityLog).filter(ActivityLog.id == log_id).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Activity log not found")
    db.delete(row)
    db.commit()


@router.delete("/activity-logs", status_code=status.HTTP_204_NO_CONTENT)
def clear_activity_logs(
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    db.query(ActivityLog).delete()
    db.commit()
