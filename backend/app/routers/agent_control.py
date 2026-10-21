"""Headless control API for the owner's Grok Bot (no UI).

Auth: `X-Agent-Key: $AGENT_API_KEY` header, or an admin JWT (Bearer).
The bot acts with full admin power: it can read and manage EVERYTHING —
tasks, projects, clients, users/VAs, work logs, time clock, invoices,
payroll, notifications, email and settings — plus context/analytics/reports.
Every mutating action is written to agent_audit_logs.
"""
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from jose import JWTError
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.auth import decode_token
from app.config import settings
from app.database import get_db
from app.models import (
    AgentAuditLog, Client, CommentReaction, Invoice, InvoiceStatus, PayrollRun, Project,
    ProjectComment, SubClient, Task, TaskComment, TaskPriority, TaskStatus,
    TimeClockEntry, ClockStatus, User, UserRole, VA, WorkLog, WorkLogStatus,
)
from app.routers.agent import _local_reply, _workspace_context
from app.routers.reports import generate_report
from app.schemas import (
    ClientCreate, ClientUpdate, CreateAppUserRequest, CreateVAUserRequest,
    InvoiceGenerateRequest, PayrollRequest, ProjectCreate, ProjectUpdate,
    ReportRequest, SettingsUpdate, TaskCreate,
)
from app.routers.auth import create_app_user, create_va_user
from app.routers.clients import create_client
from app.routers.dashboard import get_team_activity
from app.routers.invoices import generate_invoice, mark_paid, mark_unpaid
from app.routers.payroll import calculate_payroll
from app.routers.projects import create_project
from app.routers.settings import get_settings as read_settings, update_settings as write_settings
from app.routers.tasks import create_task
from app.services import comments as comment_svc
from app.services.email import branded_email, send_email
from app.services.notifications import admin_user_ids, push, va_user_id
from app.deps import CurrentUser

router = APIRouter(prefix="/agent", tags=["agent-control"])


def require_agent(request: Request, db: Annotated[Session, Depends(get_db)]) -> str:
    key = request.headers.get("x-agent-key")
    if settings.agent_api_key and key and key == settings.agent_api_key:
        return "grok-bot"
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        try:
            payload = decode_token(auth.split(" ", 1)[1])
            user = db.query(User).filter(User.id == UUID(payload["sub"]), User.is_active == True).first()
            if user and user.role == UserRole.admin:
                return f"admin:{user.email}"
        except (JWTError, KeyError, ValueError, Exception):
            pass
    raise HTTPException(401, "Agent access requires X-Agent-Key or an admin token")


def _audit(db: Session, actor: str, action: str, entity_type: str | None = None, entity_id: str | None = None, payload: dict | None = None, result: str | None = None):
    db.add(AgentAuditLog(actor=actor, action=action, entity_type=entity_type, entity_id=entity_id, payload=payload, result=result))
    db.commit()


class ActionRequest(BaseModel):
    action: str = Field(description=(
        "Tasks: create_task update_task delete_task move_task assign_task comment_task react_task_comment · "
        "Projects: create_project update_project delete_project comment_project · "
        "Clients: create_client update_client archive_client restore_client add_sub_client · "
        "People: create_va create_user update_user set_reviewer archive_va restore_va · "
        "Logs: create_log update_log delete_log approve_log reject_log · "
        "Clock: clock_in clock_out · Invoices: generate_invoice mark_invoice_paid mark_invoice_unpaid delete_invoice · "
        "Payroll: payroll_calculate mark_va_paid void_payroll_run · Comms: notify send_email · Settings: update_settings"
    ))
    payload: dict[str, Any] = {}


class ReportGenerateRequest(BaseModel):
    type: str = Field(default="daily", description="daily | weekly | board | client")
    report_date: date | None = None
    client_id: UUID | None = None
    year: int | None = None
    month: int | None = None
    cutoff: int = 15


def _period_report(db: Session, start: date, end: date, label: str) -> dict:
    logs = db.query(WorkLog).options(joinedload(WorkLog.va), joinedload(WorkLog.client)).filter(WorkLog.work_date >= start, WorkLog.work_date <= end).all()
    by_va: dict[str, float] = {}
    by_client: dict[str, float] = {}
    for log in logs:
        by_va[log.va.name if log.va else "?"] = by_va.get(log.va.name if log.va else "?", 0) + float(log.hours)
        by_client[log.client.name if log.client else "?"] = by_client.get(log.client.name if log.client else "?", 0) + float(log.hours)
    tasks_done = db.query(Task).filter(Task.completed_at >= datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc), Task.completed_at <= datetime.combine(end, datetime.max.time(), tzinfo=timezone.utc)).count()
    clock_secs = db.query(func.coalesce(func.sum(TimeClockEntry.duration_seconds), 0)).filter(TimeClockEntry.clock_in >= datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc), TimeClockEntry.clock_in <= datetime.combine(end, datetime.max.time(), tzinfo=timezone.utc), TimeClockEntry.status == ClockStatus.completed).scalar() or 0
    return {
        "type": label, "period_start": str(start), "period_end": str(end),
        "total_hours_logged": str(DecimalHours(logs)), "entries": len(logs),
        "pending_entries": len([l for l in logs if l.status == WorkLogStatus.submitted]),
        "approved_entries": len([l for l in logs if l.status in (WorkLogStatus.approved, WorkLogStatus.invoiced)]),
        "tasks_completed": tasks_done, "clock_hours": round(int(clock_secs) / 3600, 2),
        "hours_by_va": by_va, "hours_by_client": by_client,
    }


def DecimalHours(logs):
    from decimal import Decimal
    total = Decimal("0")
    for l in logs: total += l.hours
    return total


@router.get("/status")
def agent_control_status(actor: Annotated[str, Depends(require_agent)]):
    return {"ok": True, "actor": actor, "grok_configured": bool(settings.grok_api_key), "key_auth_configured": bool(settings.agent_api_key)}


@router.get("/context")
def agent_context(actor: Annotated[str, Depends(require_agent)], db: Annotated[Session, Depends(get_db)]):
    return {"actor": actor, **_workspace_context(db)}


@router.get("/entities/{kind}")
def agent_entities(kind: str, actor: Annotated[str, Depends(require_agent)], db: Annotated[Session, Depends(get_db)],
                   status: str | None = None, client_id: UUID | None = None, assignee_va_id: UUID | None = None,
                   project_id: UUID | None = None, pending: bool = False, limit: int = 100):
    """List anything the bot needs IDs for: clients | vas | users | projects | tasks | logs | invoices | payroll_runs."""
    limit = min(max(limit, 1), 200)
    if kind == "clients":
        rows = db.query(Client).order_by(Client.name).limit(limit).all()
        return [{"id": str(c.id), "name": c.name, "billing_type": c.billing_type.value, "default_rate": str(c.default_rate) if c.default_rate is not None else None,
                 "is_active": c.is_active, "sub_clients": [{"id": str(s.id), "name": s.name, "is_active": s.is_active} for s in c.sub_clients]} for c in rows]
    if kind == "vas":
        rows = db.query(VA).order_by(VA.name).limit(limit).all()
        return [{"id": str(v.id), "user_id": str(v.user_id), "name": v.name, "currency": v.currency.value, "is_active": v.is_active,
                 "email": v.user.email if v.user else None, "reviewer_user_id": str(v.reviewer_user_id) if v.reviewer_user_id else None} for v in rows]
    if kind == "users":
        rows = db.query(User).order_by(User.role, User.email).limit(limit).all()
        return [{"id": str(u.id), "email": u.email, "name": u.display_name or u.email.split("@")[0], "role": u.role.value, "is_active": u.is_active} for u in rows]
    if kind == "projects":
        q = db.query(Project)
        if client_id: q = q.filter(Project.client_id == client_id)
        if status: q = q.filter(Project.status == status)
        rows = q.order_by(Project.created_at.desc()).limit(limit).all()
        return [{"id": str(p.id), "name": p.name, "client_id": str(p.client_id), "status": p.status.value if hasattr(p.status, "value") else p.status,
                 "cadence": p.cadence.value if hasattr(p.cadence, "value") else p.cadence} for p in rows]
    if kind == "tasks":
        q = db.query(Task)
        if status: q = q.filter(Task.status == TaskStatus(status))
        if client_id: q = q.filter(Task.client_id == client_id)
        if assignee_va_id: q = q.filter(Task.assignee_va_id == assignee_va_id)
        if project_id: q = q.filter(Task.project_id == project_id)
        rows = q.order_by(Task.due_date.asc().nullslast(), Task.created_at.desc()).limit(limit).all()
        return [{"id": str(t.id), "title": t.title, "status": t.status.value, "priority": t.priority.value,
                 "client_id": str(t.client_id), "project_id": str(t.project_id) if t.project_id else None,
                 "assignee_va_id": str(t.assignee_va_id) if t.assignee_va_id else None,
                 "due_date": t.due_date.isoformat() if t.due_date else None,
                 "estimated_hours": str(t.estimated_hours) if t.estimated_hours is not None else None} for t in rows]
    if kind == "logs":
        q = db.query(WorkLog)
        if pending: q = q.filter(WorkLog.status == WorkLogStatus.submitted)
        elif status: q = q.filter(WorkLog.status == WorkLogStatus(status))
        rows = q.order_by(WorkLog.work_date.desc()).limit(limit).all()
        return [{"id": str(l.id), "work_date": l.work_date.isoformat(), "va_id": str(l.va_id), "va": l.va.name if l.va else None,
                 "client_id": str(l.client_id), "client": l.client.name if l.client else None, "hours": str(l.hours),
                 "description": l.description_plain, "status": l.status.value} for l in rows]
    if kind == "invoices":
        q = db.query(Invoice)
        if status: q = q.filter(Invoice.status == InvoiceStatus(status))
        if client_id: q = q.filter(Invoice.client_id == client_id)
        rows = q.order_by(Invoice.created_at.desc()).limit(limit).all()
        return [{"id": str(i.id), "invoice_number": i.invoice_number, "client_id": str(i.client_id), "period_label": i.period_label,
                 "total_hours": str(i.total_hours), "amount": str(i.amount), "status": i.status.value} for i in rows]
    if kind == "payroll_runs":
        rows = db.query(PayrollRun).order_by(PayrollRun.paid_at.desc()).limit(limit).all()
        return [{"id": str(r.id), "va_id": str(r.va_id), "va": r.va.name if r.va else None, "period_start": r.period_start.isoformat(),
                 "period_end": r.period_end.isoformat(), "total_hours": str(r.total_hours), "total_pay": str(r.total_pay),
                 "currency": r.currency, "paid_at": r.paid_at.isoformat() if r.paid_at else None} for r in rows]
    raise HTTPException(400, f"Unknown entity kind: {kind}")


@router.get("/analytics")
def agent_analytics(actor: Annotated[str, Depends(require_agent)], db: Annotated[Session, Depends(get_db)]):
    """Team activity / auditor view (inactive & low-activity VAs, hours, live clock)."""
    admin = db.query(User).filter(User.role == UserRole.admin).first()
    return get_team_activity(CurrentUser(user=admin), db)


@router.get("/settings")
def agent_settings(actor: Annotated[str, Depends(require_agent)], db: Annotated[Session, Depends(get_db)]):
    admin = db.query(User).filter(User.role == UserRole.admin).first()
    return read_settings(CurrentUser(user=admin), db).model_dump(mode="json")


@router.post("/ask")
def agent_ask(body: dict, actor: Annotated[str, Depends(require_agent)], db: Annotated[Session, Depends(get_db)]):
    """Data-grounded answer for the bot (full Grok reasoning happens in the bot itself)."""
    ctx = _workspace_context(db)
    return {"answer": _local_reply(str(body.get("message", "")), ctx), "context": ctx}


@router.get("/reports/daily")
def daily_report(actor: Annotated[str, Depends(require_agent)], db: Annotated[Session, Depends(get_db)], report_date: date | None = None):
    d = report_date or date.today()
    return _period_report(db, d, d, "daily")


@router.get("/reports/weekly")
def weekly_report(actor: Annotated[str, Depends(require_agent)], db: Annotated[Session, Depends(get_db)], report_date: date | None = None):
    d = report_date or date.today()
    start = d - timedelta(days=d.weekday())
    return _period_report(db, start, start + timedelta(days=6), "weekly")


@router.post("/reports/generate")
def generate(actor: Annotated[str, Depends(require_agent)], db: Annotated[Session, Depends(get_db)], body: ReportGenerateRequest = ReportGenerateRequest()):
    if body.type == "board":
        result = {"type": "board", **_workspace_context(db)}
    elif body.type == "weekly":
        d = body.report_date or date.today(); start = d - timedelta(days=d.weekday()); result = _period_report(db, start, start + timedelta(days=6), "weekly")
    elif body.type == "client":
        if not body.client_id: raise HTTPException(400, "client_id required for client report")
        today = date.today()
        rep = generate_report(ReportRequest(client_id=body.client_id, year=body.year or today.year, month=body.month or today.month, cutoff=body.cutoff, show_rate=False), CurrentUser(user=db.query(User).filter(User.role == UserRole.admin).first()), db)
        result = {"type": "client", **rep.model_dump(mode="json")}
    else:
        d = body.report_date or date.today(); result = _period_report(db, d, d, "daily")
    _audit(db, actor, "generate_report", "report", None, body.model_dump(mode="json"), result.get("type"))
    return result


@router.post("/actions")
def run_action(body: ActionRequest, actor: Annotated[str, Depends(require_agent)], db: Annotated[Session, Depends(get_db)]):
    p = body.payload
    admin = db.query(User).filter(User.role == UserRole.admin).first()
    cu = CurrentUser(user=admin)
    try:
        if body.action == "create_task":
            t = create_task(TaskCreate(**p), cu, db)
            _audit(db, actor, body.action, "task", str(t.id), p, t.title)
            return {"ok": True, "task": t.model_dump(mode="json")}
        if body.action == "create_project":
            proj = create_project(ProjectCreate(**p), cu, db)
            _audit(db, actor, body.action, "project", str(proj.id), p, proj.name)
            return {"ok": True, "project": proj.model_dump(mode="json")}
        if body.action in ("move_task", "assign_task"):
            task = db.query(Task).filter(Task.id == UUID(p["task_id"])).first()
            if not task: raise HTTPException(404, "Task not found")
            if "status" in p: task.status = TaskStatus(p["status"])
            if "assignee_va_id" in p: task.assignee_va_id = UUID(p["assignee_va_id"]) if p["assignee_va_id"] else None
            if task.status == TaskStatus.done and not task.completed_at: task.completed_at = datetime.now(timezone.utc)
            db.commit()
            _audit(db, actor, body.action, "task", str(task.id), p, task.status.value)
            return {"ok": True, "task_id": str(task.id), "status": task.status.value}
        if body.action == "comment_task":
            task = db.query(Task).filter(Task.id == UUID(p["task_id"])).first()
            if not task: raise HTTPException(404, "Task not found")
            c = TaskComment(task_id=task.id, author_user_id=admin.id, author_name="Grok Bot", body=str(p["body"]))
            db.add(c); db.commit()
            _audit(db, actor, body.action, "task", str(task.id), p, "comment")
            return {"ok": True, "comment_id": str(c.id)}
        if body.action in ("approve_log", "reject_log"):
            log = db.query(WorkLog).filter(WorkLog.id == UUID(p["log_id"])).first()
            if not log: raise HTTPException(404, "Work log not found")
            log.status = WorkLogStatus.approved if body.action == "approve_log" else WorkLogStatus.rejected
            db.commit()
            _audit(db, actor, body.action, "work_log", str(log.id), p, log.status.value)
            return {"ok": True, "log_id": str(log.id), "status": log.status.value}

        # ── Tasks: full management ──────────────────────────────────────
        if body.action == "update_task":
            task = db.query(Task).filter(Task.id == UUID(p["task_id"])).first()
            if not task: raise HTTPException(404, "Task not found")
            for field in ("title", "description"):
                if field in p: setattr(task, field, p[field])
            if "status" in p:
                task.status = TaskStatus(p["status"])
                if task.status == TaskStatus.done and not task.completed_at: task.completed_at = datetime.now(timezone.utc)
                if task.status != TaskStatus.done: task.completed_at = None
            if "priority" in p: task.priority = TaskPriority(p["priority"])
            for field in ("client_id", "project_id", "sub_client_id", "assignee_va_id"):
                if field in p: setattr(task, field, UUID(p[field]) if p[field] else None)
            for field in ("due_date", "start_date"):
                if field in p: setattr(task, field, date.fromisoformat(p[field]) if p[field] else None)
            if "estimated_hours" in p:
                from decimal import Decimal as _D
                task.estimated_hours = _D(str(p["estimated_hours"])) if p["estimated_hours"] is not None else None
            db.commit()
            _audit(db, actor, body.action, "task", str(task.id), p, task.title)
            return {"ok": True, "task_id": str(task.id), "title": task.title, "status": task.status.value}
        if body.action == "delete_task":
            task = db.query(Task).filter(Task.id == UUID(p["task_id"])).first()
            if not task: raise HTTPException(404, "Task not found")
            title = task.title
            db.delete(task); db.commit()
            _audit(db, actor, body.action, "task", p["task_id"], p, title)
            return {"ok": True, "deleted_task": title}
        if body.action == "react_task_comment":
            c = db.query(TaskComment).filter(TaskComment.id == UUID(p["comment_id"])).first()
            if not c: raise HTTPException(404, "Comment not found")
            emoji = str(p.get("emoji", "👍"))
            if emoji not in comment_svc.ALLOWED_EMOJI: raise HTTPException(400, "Emoji not allowed")
            existing = db.query(CommentReaction).filter(CommentReaction.scope == "task", CommentReaction.comment_id == c.id,
                                                        CommentReaction.user_id == admin.id, CommentReaction.emoji == emoji).first()
            if existing: db.delete(existing); db.commit(); result = "removed"
            else:
                db.add(CommentReaction(scope="task", comment_id=c.id, user_id=admin.id, user_name="Grok Bot", emoji=emoji)); db.commit()
                task = db.query(Task).filter(Task.id == c.task_id).first()
                comment_svc.notify_reaction(db, scope="task", comment=c, emoji=emoji, reactor_name="Grok Bot",
                                            scope_title=task.title if task else "Task", link="/va/tasks", exclude_user_id=admin.id)
                result = "added"
            _audit(db, actor, body.action, "task_comment", str(c.id), p, result)
            return {"ok": True, "reaction": result, "emoji": emoji}

        # ── Projects ────────────────────────────────────────────────────
        if body.action == "update_project":
            proj = db.query(Project).filter(Project.id == UUID(p["project_id"])).first()
            if not proj: raise HTTPException(404, "Project not found")
            updates = {k: v for k, v in p.items() if k != "project_id"}
            updated = ProjectUpdate(**updates)
            for field, value in updated.model_dump(exclude_unset=True).items():
                setattr(proj, field, value)
            db.commit()
            _audit(db, actor, body.action, "project", str(proj.id), p, proj.name)
            return {"ok": True, "project_id": str(proj.id), "name": proj.name}
        if body.action == "delete_project":
            proj = db.query(Project).filter(Project.id == UUID(p["project_id"])).first()
            if not proj: raise HTTPException(404, "Project not found")
            name = proj.name
            db.delete(proj); db.commit()
            _audit(db, actor, body.action, "project", p["project_id"], p, name)
            return {"ok": True, "deleted_project": name}
        if body.action == "comment_project":
            proj = db.query(Project).filter(Project.id == UUID(p["project_id"])).first()
            if not proj: raise HTTPException(404, "Project not found")
            c = ProjectComment(project_id=proj.id, author_user_id=admin.id, author_name="Grok Bot", author_role="admin", body=str(p["body"]))
            db.add(c); db.commit()
            _audit(db, actor, body.action, "project", str(proj.id), p, "comment")
            return {"ok": True, "comment_id": str(c.id)}

        # ── Clients ─────────────────────────────────────────────────────
        if body.action == "create_client":
            client = create_client(ClientCreate(**p), cu, db)
            _audit(db, actor, body.action, "client", str(client.id), p, client.name)
            return {"ok": True, "client": {"id": str(client.id), "name": client.name}}
        if body.action == "update_client":
            client = db.query(Client).filter(Client.id == UUID(p["client_id"])).first()
            if not client: raise HTTPException(404, "Client not found")
            updates = ClientUpdate(**{k: v for k, v in p.items() if k != "client_id"})
            for field, value in updates.model_dump(exclude_unset=True).items():
                setattr(client, field, value)
            db.commit()
            _audit(db, actor, body.action, "client", str(client.id), p, client.name)
            return {"ok": True, "client_id": str(client.id), "name": client.name, "is_active": client.is_active}
        if body.action in ("archive_client", "restore_client"):
            client = db.query(Client).filter(Client.id == UUID(p["client_id"])).first()
            if not client: raise HTTPException(404, "Client not found")
            client.is_active = body.action == "restore_client"
            db.commit()
            _audit(db, actor, body.action, "client", str(client.id), p, client.name)
            return {"ok": True, "client_id": str(client.id), "is_active": client.is_active}
        if body.action == "add_sub_client":
            client = db.query(Client).filter(Client.id == UUID(p["client_id"])).first()
            if not client: raise HTTPException(404, "Client not found")
            sub = SubClient(client_id=client.id, name=str(p["name"]))
            db.add(sub); db.commit()
            _audit(db, actor, body.action, "sub_client", str(sub.id), p, sub.name)
            return {"ok": True, "sub_client_id": str(sub.id), "name": sub.name}

        # ── People: VAs, users, auditors ────────────────────────────────
        if body.action == "create_va":
            va = create_va_user(CreateVAUserRequest(**p), cu, db)
            _audit(db, actor, body.action, "va", str(va.id), {k: v for k, v in p.items() if k != "password"}, va.name)
            return {"ok": True, "va": {"id": str(va.id), "user_id": str(va.user_id), "name": va.name}}
        if body.action == "create_user":
            user = create_app_user(CreateAppUserRequest(**p), cu, db)
            _audit(db, actor, body.action, "user", str(user.id), {k: v for k, v in p.items() if k != "password"}, user.email)
            return {"ok": True, "user": user.model_dump(mode="json")}
        if body.action == "update_user":
            user = db.query(User).filter(User.id == UUID(p["user_id"])).first()
            if not user: raise HTTPException(404, "User not found")
            if "name" in p: user.display_name = p["name"]
            if "is_active" in p: user.is_active = bool(p["is_active"])
            if "job_title" in p: user.job_title = p["job_title"]
            db.commit()
            _audit(db, actor, body.action, "user", str(user.id), p, user.email)
            return {"ok": True, "user_id": str(user.id), "is_active": user.is_active}
        if body.action == "set_reviewer":
            va = db.query(VA).filter(VA.id == UUID(p["va_id"])).first()
            if not va: raise HTTPException(404, "VA not found")
            va.reviewer_user_id = UUID(p["reviewer_user_id"]) if p.get("reviewer_user_id") else None
            db.commit()
            _audit(db, actor, body.action, "va", str(va.id), p, va.name)
            return {"ok": True, "va_id": str(va.id), "reviewer_user_id": str(va.reviewer_user_id) if va.reviewer_user_id else None}
        if body.action in ("archive_va", "restore_va"):
            va = db.query(VA).filter(VA.id == UUID(p["va_id"])).first()
            if not va: raise HTTPException(404, "VA not found")
            va.is_active = body.action == "restore_va"
            db.commit()
            _audit(db, actor, body.action, "va", str(va.id), p, va.name)
            return {"ok": True, "va_id": str(va.id), "is_active": va.is_active}

        # ── Work logs ───────────────────────────────────────────────────
        if body.action == "create_log":
            from decimal import Decimal as _D
            from datetime import time as _time
            va = db.query(VA).filter(VA.id == UUID(p["va_id"])).first()
            if not va: raise HTTPException(404, "VA not found")
            hours = _D(str(p["hours"]))
            rate = _D(str(p["rate"])) if p.get("rate") is not None else _D("0")
            log = WorkLog(
                work_date=date.fromisoformat(p["work_date"]), va_id=va.id, client_id=UUID(p["client_id"]),
                sub_client_id=UUID(p["sub_client_id"]) if p.get("sub_client_id") else None,
                project_id=UUID(p["project_id"]) if p.get("project_id") else None,
                task_id=UUID(p["task_id"]) if p.get("task_id") else None,
                description_plain=str(p.get("description", "Bot-logged work")),
                start_time=_time.fromisoformat(p.get("start_time", "09:00")), end_time=_time.fromisoformat(p.get("end_time", "10:00")),
                hours=hours, va_rate=rate, va_pay=(hours * rate).quantize(_D("0.01")),
                status=WorkLogStatus(p.get("status", "approved")), source="manual",
            )
            db.add(log); db.commit()
            _audit(db, actor, body.action, "work_log", str(log.id), p, str(log.hours))
            return {"ok": True, "log_id": str(log.id), "hours": str(log.hours), "status": log.status.value}
        if body.action == "update_log":
            from decimal import Decimal as _D
            log = db.query(WorkLog).filter(WorkLog.id == UUID(p["log_id"])).first()
            if not log: raise HTTPException(404, "Work log not found")
            if "description" in p: log.description_plain = str(p["description"])
            if "work_date" in p: log.work_date = date.fromisoformat(p["work_date"])
            if "hours" in p: log.hours = _D(str(p["hours"]))
            if "status" in p: log.status = WorkLogStatus(p["status"])
            if "client_id" in p: log.client_id = UUID(p["client_id"])
            log.va_pay = (log.hours * log.va_rate).quantize(_D("0.01"))
            db.commit()
            _audit(db, actor, body.action, "work_log", str(log.id), p, log.status.value)
            return {"ok": True, "log_id": str(log.id), "status": log.status.value}
        if body.action == "delete_log":
            log = db.query(WorkLog).filter(WorkLog.id == UUID(p["log_id"])).first()
            if not log: raise HTTPException(404, "Work log not found")
            db.delete(log); db.commit()
            _audit(db, actor, body.action, "work_log", p["log_id"], p, "deleted")
            return {"ok": True, "deleted_log": p["log_id"]}

        # ── Time clock ──────────────────────────────────────────────────
        if body.action == "clock_in":
            va = db.query(VA).filter(VA.id == UUID(p["va_id"])).first()
            if not va: raise HTTPException(404, "VA not found")
            running = db.query(TimeClockEntry).filter(TimeClockEntry.va_id == va.id, TimeClockEntry.status.in_([ClockStatus.running, ClockStatus.paused])).first()
            if running: raise HTTPException(400, "That user is already clocked in")
            entry = TimeClockEntry(va_id=va.id, task_id=UUID(p["task_id"]) if p.get("task_id") else None,
                                   clock_in=datetime.now(timezone.utc), status=ClockStatus.running, notes="Clocked in by Grok Bot")
            db.add(entry); db.commit()
            push(db, admin_user_ids(db), "clock", f"⏱️ {va.name} clocked in (via Grok Bot)", "", "/admin/time-clock")
            db.refresh(entry)
            _audit(db, actor, body.action, "time_clock", str(entry.id), p, va.name)
            return {"ok": True, "entry_id": str(entry.id), "va": va.name}
        if body.action == "clock_out":
            va = db.query(VA).filter(VA.id == UUID(p["va_id"])).first()
            if not va: raise HTTPException(404, "VA not found")
            entry = db.query(TimeClockEntry).filter(TimeClockEntry.va_id == va.id, TimeClockEntry.status.in_([ClockStatus.running, ClockStatus.paused])).first()
            if not entry: raise HTTPException(400, "That user is not clocked in")
            now = datetime.now(timezone.utc)
            paused = entry.total_paused_seconds or 0
            if entry.status == ClockStatus.paused and entry.paused_at:
                paused += int((now - entry.paused_at).total_seconds())
            entry.clock_out = now
            entry.duration_seconds = max(0, int((now - entry.clock_in).total_seconds()) - paused)
            entry.total_paused_seconds = paused
            entry.status = ClockStatus.completed
            db.commit()
            _audit(db, actor, body.action, "time_clock", str(entry.id), p, va.name)
            return {"ok": True, "entry_id": str(entry.id), "va": va.name, "hours": round(entry.duration_seconds / 3600, 2)}

        # ── Invoices ────────────────────────────────────────────────────
        if body.action == "generate_invoice":
            inv = generate_invoice(InvoiceGenerateRequest(**p), cu, db)
            _audit(db, actor, body.action, "invoice", str(inv.id), p, inv.invoice_number)
            return {"ok": True, "invoice": inv.model_dump(mode="json")}
        if body.action in ("mark_invoice_paid", "mark_invoice_unpaid"):
            inv = mark_paid(UUID(p["invoice_id"]), cu, db) if body.action == "mark_invoice_paid" else mark_unpaid(UUID(p["invoice_id"]), cu, db)
            _audit(db, actor, body.action, "invoice", str(inv.id), p, inv.status.value)
            return {"ok": True, "invoice_id": str(inv.id), "status": inv.status.value}
        if body.action == "delete_invoice":
            inv = db.query(Invoice).filter(Invoice.id == UUID(p["invoice_id"])).first()
            if not inv: raise HTTPException(404, "Invoice not found")
            number = inv.invoice_number
            db.query(WorkLog).filter(WorkLog.invoice_id == inv.id).update({WorkLog.invoice_id: None, WorkLog.status: WorkLogStatus.approved}, synchronize_session=False)
            db.delete(inv); db.commit()
            _audit(db, actor, body.action, "invoice", p["invoice_id"], p, number)
            return {"ok": True, "deleted_invoice": number}

        # ── Payroll ─────────────────────────────────────────────────────
        if body.action == "payroll_calculate":
            result = calculate_payroll(PayrollRequest(**p), cu, db)
            _audit(db, actor, body.action, "payroll", None, p, result.period_label if hasattr(result, "period_label") else "calculated")
            return {"ok": True, "payroll": result.model_dump(mode="json")}
        if body.action == "mark_va_paid":
            from decimal import Decimal as _D
            va = db.query(VA).filter(VA.id == UUID(p["va_id"])).first()
            if not va: raise HTTPException(404, "VA not found")
            run = PayrollRun(va_id=va.id, period_start=date.fromisoformat(p["period_start"]), period_end=date.fromisoformat(p["period_end"]),
                             total_hours=_D(str(p["total_hours"])), total_pay=_D(str(p["total_pay"])),
                             currency=p.get("currency") or va.currency.value, method=p.get("method"), notes=p.get("notes", "Marked paid by Grok Bot"))
            db.add(run); db.commit()
            push(db, [va.user_id], "system", "💸 Payroll sent", f"Your pay for {run.period_start} – {run.period_end} ({run.total_hours} hrs) was marked paid by Grok Bot.", "/va/time-log")
            _audit(db, actor, body.action, "payroll_run", str(run.id), p, va.name)
            return {"ok": True, "run_id": str(run.id), "va": va.name}
        if body.action == "void_payroll_run":
            run = db.query(PayrollRun).filter(PayrollRun.id == UUID(p["run_id"])).first()
            if not run: raise HTTPException(404, "Payroll run not found")
            db.delete(run); db.commit()
            _audit(db, actor, body.action, "payroll_run", p["run_id"], p, "voided")
            return {"ok": True, "voided_run": p["run_id"]}

        # ── Comms: notifications + email ────────────────────────────────
        if body.action == "notify":
            ids: list = []
            if p.get("user_id"): ids.append(UUID(p["user_id"]))
            if p.get("va_id"): ids.append(va_user_id(db, UUID(p["va_id"])))
            if p.get("role"):
                ids += [u.id for u in db.query(User).filter(User.role == UserRole(p["role"]), User.is_active == True).all()]
            if p.get("all"):
                ids += [u.id for u in db.query(User).filter(User.is_active == True).all()]
            push(db, ids, str(p.get("type", "system")), str(p["title"]), str(p.get("body", "")), str(p.get("link", "")), exclude_user_id=admin.id)
            _audit(db, actor, body.action, "notification", None, {k: v for k, v in p.items()}, str(len([i for i in ids if i])))
            return {"ok": True, "notified": len([i for i in dict.fromkeys(ids) if i and i != admin.id])}
        if body.action == "send_email":
            html = branded_email(str(p.get("title", p["subject"])), "", str(p["body"]), p.get("cta_label"), p.get("cta_url"))
            ok = send_email(str(p["to"]), str(p["subject"]), html, template_key="agent_bot")
            _audit(db, actor, body.action, "email", None, {"to": p["to"], "subject": p["subject"]}, "sent" if ok else "failed/skipped")
            return {"ok": bool(ok), "sent": bool(ok)}

        # ── Settings ────────────────────────────────────────────────────
        if body.action == "update_settings":
            result = write_settings(SettingsUpdate(**p), cu, db)
            safe = {k: v for k, v in p.items() if k != "resend_api_key"}
            _audit(db, actor, body.action, "settings", None, safe, "updated")
            return {"ok": True, "settings": result.model_dump(mode="json")}

        raise HTTPException(400, f"Unknown action: {body.action}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


@router.get("/audit")
def audit_log(actor: Annotated[str, Depends(require_agent)], db: Annotated[Session, Depends(get_db)], limit: int = 50):
    rows = db.query(AgentAuditLog).order_by(AgentAuditLog.created_at.desc()).limit(min(limit, 200)).all()
    return [{"id": str(r.id), "actor": r.actor, "action": r.action, "entity_type": r.entity_type, "entity_id": r.entity_id, "result": r.result, "created_at": r.created_at.isoformat() if r.created_at else None} for r in rows]
