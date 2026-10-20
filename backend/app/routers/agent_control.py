"""Headless control API for the owner's Grok Bot (no UI).

Auth: `X-Agent-Key: $AGENT_API_KEY` header, or an admin JWT (Bearer).
The bot can read context, manage tasks/projects/logs, and generate reports.
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
    AgentAuditLog, Client, Invoice, InvoiceStatus, Project, Task, TaskComment, TaskStatus,
    TimeClockEntry, ClockStatus, User, UserRole, VA, WorkLog, WorkLogStatus,
)
from app.routers.agent import _local_reply, _workspace_context
from app.routers.reports import generate_report
from app.schemas import ProjectCreate, ReportRequest, TaskCreate
from app.routers.projects import create_project
from app.routers.tasks import create_task
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
    action: str = Field(description="create_task | move_task | assign_task | comment_task | create_project | approve_log | reject_log")
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
        raise HTTPException(400, f"Unknown action: {body.action}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


@router.get("/audit")
def audit_log(actor: Annotated[str, Depends(require_agent)], db: Annotated[Session, Depends(get_db)], limit: int = 50):
    rows = db.query(AgentAuditLog).order_by(AgentAuditLog.created_at.desc()).limit(min(limit, 200)).all()
    return [{"id": str(r.id), "actor": r.actor, "action": r.action, "entity_type": r.entity_type, "entity_id": r.entity_id, "result": r.result, "created_at": r.created_at.isoformat() if r.created_at else None} for r in rows]
