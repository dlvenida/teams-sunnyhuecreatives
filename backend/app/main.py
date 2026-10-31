from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import SessionLocal
from app.routers import (
    agent,
    agent_control,
    auth,
    clients,
    collaboration,
    dashboard,
    expenses,
    invoices,
    notifications,
    payroll,
    profile,
    projects,
    reports,
    settings as settings_router,
    tasks,
    timeclock,
    user_reports,
    va_portal,
    va_rates,
    vas,
    work_logs,
)
from app.services.seed import seed_database


_reminder_thread_started = False


def _session_permanently_closed(db) -> bool:
    state = getattr(db, "_close_state", None)
    return getattr(state, "name", None) == "CLOSED"


def _safe_rollback(db) -> None:
    if db is None or _session_permanently_closed(db):
        return
    try:
        db.rollback()
    except Exception:
        pass


def _safe_close(db) -> None:
    if db is None:
        return
    try:
        db.close()
    except Exception:
        pass


def _safe_commit(db) -> None:
    """Commit only while the session can still take a transaction. Never commit after a permanent close."""
    if db is None or _session_permanently_closed(db):
        return
    try:
        db.commit()
    except Exception:
        _safe_rollback(db)


def _run_in_session(fn) -> None:
    db = None
    try:
        db = SessionLocal()
        fn(db)
        _safe_commit(db)
    except Exception:
        _safe_rollback(db)
    finally:
        _safe_close(db)


def _scheduled_reminders() -> None:
    """Hourly timesheet emails, without waiting for someone to open the dashboard.

    Imports stay inside the loop so a bad import cannot kill the process at startup.
    Each job gets its own session. Mail is sent only after that job commits; a later
    failure rolls back its own session and does not replay the previous email.
    """
    import time

    time.sleep(15)
    while True:
        try:
            from app.services.timesheet_reminders import run_timesheet_reminders

            _run_in_session(run_timesheet_reminders)
        except Exception:
            pass
        try:
            from app.services.task_recurrence import process_due_repeating

            _run_in_session(process_due_repeating)
        except Exception:
            pass
        time.sleep(60 * 60)


@asynccontextmanager
async def lifespan(_: FastAPI):
    import threading

    global _reminder_thread_started
    db = SessionLocal()
    try:
        seed_database(db)
    finally:
        db.close()
    # Start only when the app is actually running — not when this module is imported.
    if not _reminder_thread_started:
        _reminder_thread_started = True
        threading.Thread(target=_scheduled_reminders, name="shc-reminders", daemon=True).start()
    yield


app = FastAPI(title="Sunny Hue Creatives API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Activity logging: record who did what (mutations only) ───────────
from app.auth import decode_token  # noqa: E402
from app.database import SessionLocal as _SessionLocal  # noqa: E402
from app.models import ActivityLog, User, VA  # noqa: E402
from starlette.middleware.base import BaseHTTPMiddleware  # noqa: E402

_SKIP_PREFIXES = ("/auth/login", "/auth/refresh", "/payroll/calculate", "/reports/generate", "/agent", "/health", "/settings/activity-logs", "/settings/email-activity")


def _describe(method: str, path: str) -> tuple[str, str]:
    p = path.strip("/")
    parts = p.split("/")
    res = parts[0] if parts else ""
    tail = parts[-1] if parts else ""
    rules = [
        ("work-logs" in p and tail == "approve", ("approve", "Approved a time log")),
        ("work-logs" in p and tail == "reject", ("reject", "Rejected a time log")),
        ("invoices" in p and tail == "generate", ("create", "Generated an invoice")),
        ("invoices" in p and tail == "mark-paid", ("update", "Marked an invoice as paid")),
        ("invoices" in p and tail == "mark-unpaid", ("update", "Marked an invoice as unpaid")),
        ("payroll/runs" in p and method == "POST", ("pay", "Marked a VA as paid (payroll)")),
        ("payroll/runs" in p and method == "DELETE", ("delete", "Voided a payroll payment")),
        ("time-clock/clock-in" in p, ("clock", "Clocked in")),
        ("time-clock/clock-out" in p, ("clock", "Clocked out")),
        ("time-clock/pause" in p, ("clock", "Paused the clock")),
        ("time-clock/resume" in p, ("clock", "Resumed the clock")),
        ("tasks" in p and tail == "comments" and method == "POST", ("comment", "Commented on a task")),
        ("tasks" in p and tail == "move", ("update", "Moved a task on the board")),
        ("delegate-and-delete" in p, ("delegate", "Delegated work and deleted a user")),
        ("reviewer" in p, ("assign", "Assigned an auditor/reviewer to a VA")),
        ("va/work-logs" in p and method == "POST", ("create", "Submitted a time log")),
        ("email-templates" in p and tail == "test", ("email", "Sent a test email")),
        ("email-templates" in p and method == "PUT", ("update", "Edited an email template")),
        ("settings" in p and method == "PUT", ("update", "Updated app settings")),
        ("notifications" in p and tail == "read-all", ("update", "Marked all notifications as read")),
        ("user-reports" in p and method == "POST", ("create", "Created a report to Administrator & Auditor")),
        ("user-reports" in p and method == "PATCH", ("update", "Updated a user report status")),
    ]
    for cond, out in rules:
        if cond:
            return out
    verb = {"POST": ("create", "Created"), "PATCH": ("update", "Updated"), "PUT": ("update", "Updated"), "DELETE": ("delete", "Deleted")}.get(method, ("update", "Changed"))
    label = {"tasks": "a task", "projects": "a project", "clients": "a client", "work-logs": "a time log", "vas": "a user", "auth": "a user account", "invoices": "an invoice", "notifications": "notifications"}.get(res, res or "a record")
    return verb[0], f"{verb[1]} {label}"


class ActivityLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        try:
            method = request.method
            path = request.url.path
            if method == "GET" or response.status_code >= 400 or any(path.startswith(s) for s in _SKIP_PREFIXES) or path.endswith("/adjust"):
                # /adjust writes its own detailed ActivityLog (before → after + reason)
                return response
            auth = request.headers.get("authorization", "")
            if not auth.lower().startswith("bearer "):
                return response
            payload = decode_token(auth.split(" ", 1)[1])
            if payload.get("type") != "access":
                return response
            from uuid import UUID as _UUID
            db = _SessionLocal()
            try:
                user = db.query(User).filter(User.id == _UUID(payload["sub"])).first()
                if not user:
                    return response
                name = user.display_name or user.email.split("@")[0]
                if user.role.value == "va":
                    va = db.query(VA).filter(VA.user_id == user.id).first()
                    if va:
                        name = va.name
                action, description = _describe(method, path)
                db.add(ActivityLog(user_id=user.id, user_name=name, user_role=user.role.value, action=action, description=description, path=path, method=method))
                db.commit()
            finally:
                db.close()
        except Exception:
            pass
        return response


app.add_middleware(ActivityLogMiddleware)

app.include_router(auth.router)
app.include_router(profile.router)
app.include_router(clients.router)
app.include_router(vas.router)
app.include_router(work_logs.router)
app.include_router(va_portal.router)
app.include_router(va_rates.router)
app.include_router(dashboard.router)
app.include_router(expenses.router)
app.include_router(payroll.router)
app.include_router(reports.router)
app.include_router(invoices.router)
app.include_router(settings_router.router)
app.include_router(projects.router)
app.include_router(tasks.router)
app.include_router(timeclock.router)
app.include_router(user_reports.router)
app.include_router(notifications.router)
app.include_router(collaboration.router)
app.include_router(agent.router)
app.include_router(agent_control.router)


@app.get("/health")
def health():
    return {"status": "ok"}
