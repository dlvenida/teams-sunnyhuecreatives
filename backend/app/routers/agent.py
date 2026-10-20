"""Admin-only Grok (xAI) agent.

Reads live workspace data (tasks, projects, logs, clock, invoices) as context and
answers through Grok when XAI_API_KEY/GROK_API_KEY is set. Without a key it still
answers from the same live data in a built-in local mode, so admins always get
something useful. VAs receive 403 — this router is admin-only by design.
"""
from datetime import date, timedelta
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.config import settings
from app.database import get_db
from app.deps import CurrentUser, require_admin
from app.models import ClockStatus, Invoice, InvoiceStatus, Project, Task, TaskStatus, TimeClockEntry, WorkLog, WorkLogStatus

router = APIRouter(prefix="/admin/agent", tags=["agent"])


class ChatMessage(BaseModel):
    role: str = "user"
    content: str


class AgentChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    history: list[ChatMessage] = []


def _workspace_context(db: Session) -> dict:
    today = date.today()
    tasks = db.query(Task).options(joinedload(Task.client), joinedload(Task.assignee)).all()
    def titles(items, n=8):
        return [f"{t.title} ({t.client.name if t.client else '?'}, {t.assignee.name if t.assignee else 'unassigned'}, due {t.due_date or 'no date'})" for t in items[:n]]
    overdue = [t for t in tasks if t.due_date and t.due_date < today and t.status != TaskStatus.done]
    due_today = [t for t in tasks if t.due_date == today and t.status != TaskStatus.done]
    blocked = [t for t in tasks if t.status == TaskStatus.blocked]
    unassigned = [t for t in tasks if not t.assignee_va_id and t.status != TaskStatus.done]
    live = db.query(TimeClockEntry).filter(TimeClockEntry.status.in_([ClockStatus.running, ClockStatus.paused])).count()
    return {
        "today": str(today),
        "task_counts": {s.value: len([t for t in tasks if t.status == s]) for s in TaskStatus},
        "overdue": titles(overdue), "due_today": titles(due_today), "blocked": titles(blocked), "unassigned": titles(unassigned),
        "active_projects": db.query(Project).filter(Project.status == "active").count(),
        "pending_logs": db.query(WorkLog).filter(WorkLog.status == WorkLogStatus.submitted).count(),
        "unpaid_invoices": db.query(Invoice).filter(Invoice.status == InvoiceStatus.unpaid).count(),
        "live_clock_sessions": live,
        "hours_this_week": str(db.query(func.coalesce(func.sum(WorkLog.hours), 0)).filter(WorkLog.work_date >= today - timedelta(days=today.weekday())).scalar() or 0),
    }


def _suggested_actions(ctx: dict) -> list[dict]:
    actions = []
    if ctx["overdue"]: actions.append({"label": f"Review {len(ctx['overdue'])} overdue task(s)", "link": "/admin/tasks"})
    if ctx["pending_logs"]: actions.append({"label": f"Approve {ctx['pending_logs']} pending log(s)", "link": "/admin/logs"})
    if ctx["unassigned"]: actions.append({"label": "Assign unassigned tasks", "link": "/admin/tasks"})
    if ctx["unpaid_invoices"]: actions.append({"label": "Follow up unpaid invoices", "link": "/admin/invoices"})
    actions.append({"label": "Open the board", "link": "/admin/tasks"})
    return actions


def _local_reply(message: str, ctx: dict) -> str:
    m = message.lower()
    lines = []
    if any(k in m for k in ("overdue", "late", "attention", "risk")):
        lines.append(f"You have {len(ctx['overdue'])} overdue task(s)" + (": " + "; ".join(ctx["overdue"]) if ctx["overdue"] else "."))
        if ctx["blocked"]: lines.append(f"Blocked: {'; '.join(ctx['blocked'])}")
    elif any(k in m for k in ("today", "morning", "prepare", "plan", "summary", "status")):
        c = ctx["task_counts"]
        lines.append(f"Today ({ctx['today']}): {c.get('in_progress', 0)} in progress, {c.get('todo', 0)} to do, {len(ctx['due_today'])} due today, {len(ctx['overdue'])} overdue.")
        if ctx["due_today"]: lines.append("Due today: " + "; ".join(ctx["due_today"]))
        lines.append(f"{ctx['pending_logs']} log(s) pending approval · {ctx['live_clock_sessions']} VA(s) on the clock · {ctx['hours_this_week']} hrs logged this week.")
    elif "assign" in m:
        lines.append(f"{len(ctx['unassigned'])} unassigned task(s)" + (": " + "; ".join(ctx["unassigned"]) if ctx["unassigned"] else "."))
    elif "invoice" in m or "pay" in m:
        lines.append(f"{ctx['unpaid_invoices']} unpaid invoice(s) outstanding. Open Invoices to follow up.")
    elif "project" in m:
        lines.append(f"{ctx['active_projects']} active project(s). See Projects for per-client progress and cadence.")
    else:
        c = ctx["task_counts"]
        lines.append(f"Here's the workspace right now: {c.get('todo', 0)} to do, {c.get('in_progress', 0)} in progress, {c.get('in_review', 0)} in review, {c.get('done', 0)} done. {len(ctx['overdue'])} overdue, {ctx['pending_logs']} logs pending approval, {ctx['live_clock_sessions']} live clock session(s).")
        lines.append("Ask me about overdue work, today's plan, unassigned tasks, or invoices — or set XAI_API_KEY on the API for full Grok reasoning.")
    return "\n\n".join(lines)


@router.get("/status")
def agent_status(_: Annotated[CurrentUser, Depends(require_admin)]):
    return {"configured": bool(settings.grok_api_key), "model": settings.grok_model, "mode": "grok" if settings.grok_api_key else "local", "note": None if settings.grok_api_key else "Set XAI_API_KEY (or GROK_API_KEY) on the API service to enable live Grok replies."}


@router.post("/chat")
async def agent_chat(body: AgentChatRequest, _: Annotated[CurrentUser, Depends(require_admin)], db: Annotated[Session, Depends(get_db)]):
    ctx = _workspace_context(db)
    actions = _suggested_actions(ctx)
    if not settings.grok_api_key:
        return {"reply": _local_reply(body.message, ctx), "mode": "local", "model": settings.grok_model, "suggested_actions": actions}

    system = (
        "You are Grok, the admin assistant inside Teams.SHC (Sunny Hue Creatives). "
        "You help the administrator manage VA tasks, projects, time logs, payroll and invoices. "
        "Be concise, practical, and action-oriented. Never invent data — only use the workspace context provided. "
        f"Live workspace context (JSON): {ctx}"
    )
    messages = [{"role": "system", "content": system}]
    for h in body.history[-10:]:
        if h.role in ("user", "assistant"):
            messages.append({"role": h.role, "content": h.content[:4000]})
    messages.append({"role": "user", "content": body.message})
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            resp = await client.post(
                "https://api.x.ai/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.grok_api_key}", "Content-Type": "application/json"},
                json={"model": settings.grok_model, "messages": messages, "temperature": 0.4},
            )
        if resp.status_code >= 400:
            raise HTTPException(502, f"Grok API error ({resp.status_code}). Check GROK_MODEL / XAI_API_KEY.")
        reply = resp.json()["choices"][0]["message"]["content"]
    except HTTPException:
        raise
    except Exception:
        # Never leave the admin stuck — fall back to local data answer
        return {"reply": _local_reply(body.message, ctx), "mode": "local-fallback", "model": settings.grok_model, "suggested_actions": actions}
    return {"reply": reply, "mode": "grok", "model": settings.grok_model, "suggested_actions": actions}
