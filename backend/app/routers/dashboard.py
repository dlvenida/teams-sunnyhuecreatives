from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import CurrentUser, get_current_user, require_admin, require_admin_or_auditor
from app.services.pay_access import hide_team_money
from app.models import (
    BusinessExpense,
    Client,
    ClientApprovalStatus,
    Invoice,
    InvoiceStatus,
    ManualEarning,
    PayrollRun,
    Project,
    Task,
    TaskComment,
    TaskStatus,
    TimeClockEntry,
    ClockStatus,
    User,
    UserRole,
    VA,
    WorkLog,
    WorkLogStatus,
)
from app.services.owner_finance import MoneySplit, combine, currency_code, pack_money, quantize_money
from app.routers.work_logs import _serialize_log
from app.schemas import DashboardSummary
from app.services.billing import get_week_period

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _task_mini(db, t: Task) -> dict:
    from app.routers.tasks import _serialize
    s = _serialize(db, t)
    return s.model_dump(mode="json")


@router.get("/overview")
def get_overview(current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    """Monday-style morning overview for admin (team) or VA (personal)."""
    from datetime import timedelta
    from sqlalchemy import func as _func, or_

    today = date.today()
    try:
        from app.services.task_deadlines import notify_task_deadlines
        notify_task_deadlines(db)
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
    week_start = today - timedelta(days=today.weekday())
    week_end = week_start + timedelta(days=6)
    is_admin = current.role in (UserRole.admin, UserRole.auditor)
    is_va = current.role == UserRole.va

    tq = db.query(Task).options(joinedload(Task.client), joinedload(Task.project), joinedload(Task.assignee))
    if is_va:
        tq = tq.filter(or_(Task.assignee_va_id == current.va_id, Task.created_by == current.user.id))
    all_tasks = tq.order_by(Task.due_date.asc().nullslast(), Task.created_at.asc()).all()

    def by_status(s): return [t for t in all_tasks if t.status == s]
    overdue = [t for t in all_tasks if t.due_date and t.due_date < today and t.status != TaskStatus.done]
    due_today = [t for t in all_tasks if t.due_date == today and t.status != TaskStatus.done]
    in_progress = by_status(TaskStatus.in_progress)
    blocked = by_status(TaskStatus.blocked)
    backlog = [t for t in by_status(TaskStatus.todo) if not t.due_date or t.due_date < today][:10] or by_status(TaskStatus.todo)[:10]
    upcoming = [t for t in all_tasks if t.due_date and today < t.due_date <= today + timedelta(days=7) and t.status != TaskStatus.done]
    unassigned = [t for t in all_tasks if not t.assignee_va_id and t.status != TaskStatus.done] if is_admin else []

    # Hours
    lq = db.query(WorkLog)
    if is_va:
        lq = lq.filter(WorkLog.va_id == current.va_id)
    hours_today = lq.filter(WorkLog.work_date == today).with_entities(_func.coalesce(_func.sum(WorkLog.hours), 0)).scalar() or 0
    hours_week = lq.filter(WorkLog.work_date >= week_start, WorkLog.work_date <= week_end).with_entities(_func.coalesce(_func.sum(WorkLog.hours), 0)).scalar() or 0
    done_week = [t for t in by_status(TaskStatus.done) if t.completed_at and week_start <= t.completed_at.date() <= week_end]

    # Timesheet deadline reminders (semi-monthly) — also push notifications (deduped)
    try:
        from app.services.timesheet_reminders import dashboard_timesheet_attention, run_timesheet_reminders
        run_timesheet_reminders(db)
    except Exception:
        pass

    # Attention + prepare
    attention, prepare = [], []
    try:
        from app.services.timesheet_reminders import dashboard_timesheet_attention
        for item in dashboard_timesheet_attention(db, is_va=is_va, va_id=current.va_id, is_staff=is_admin):
            attention.append(item)
            prepare.insert(0, item["title"])
    except Exception:
        pass
    for t in overdue[:5]:
        attention.append({"type": "overdue_task", "severity": "high", "title": f"Overdue: {t.title}", "detail": f"{t.client.name if t.client else ''} · due {t.due_date}", "link": "/admin/tasks" if is_admin else "/va/tasks"})
    # Repeating tasks that missed their deadline — next copy waits until Done
    from app.services.task_recurrence import recurrence_label as _recurrence_label
    overdue_repeating = [
        t for t in overdue
        if t.recurrence and getattr(t.recurrence, "value", t.recurrence) not in (None, "none")
    ]
    for t in overdue_repeating[:5]:
        rlabel = _recurrence_label(
            t.recurrence,
            interval=t.recurrence_interval or 1,
            unit=t.recurrence_unit,
            weekdays=t.recurrence_weekdays,
        ) or "repeating"
        attention.append({
            "type": "overdue_repeat",
            "severity": "high",
            "title": f"Repeating task not completed on time: {t.title}",
            "detail": f"{t.client.name if t.client else ''} · due {t.due_date} · {rlabel} — finish this before the next one is created",
            "link": "/admin/tasks" if is_admin else "/va/tasks",
        })
    for t in blocked[:5]:
        attention.append({"type": "blocked_task", "severity": "high", "title": f"Blocked: {t.title}", "detail": t.client.name if t.client else "", "link": "/admin/tasks" if is_admin else "/va/tasks"})
    for t in unassigned[:5]:
        attention.append({"type": "unassigned", "severity": "medium", "title": f"Unassigned: {t.title}", "detail": "Assign a VA so work can start", "link": "/admin/tasks"})
    if is_admin:
        try:
            from app.services.va_inactivity import notify_daily_inactivity
            for flag in notify_daily_inactivity(db, today):
                attention.append({
                    "type": "va_inactive_day",
                    "severity": "high",
                    "title": flag["title"],
                    "detail": flag["body"],
                    "link": "/admin/analytics",
                })
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass
        pending = db.query(WorkLog).filter(WorkLog.status == WorkLogStatus.submitted).count()
        if pending: attention.append({"type": "pending_logs", "severity": "medium", "title": f"{pending} time log(s) waiting for approval", "detail": "Open Review logs", "link": "/admin/logs"})
        unpaid = db.query(Invoice).filter(Invoice.status == InvoiceStatus.unpaid).count()
        if unpaid and current.role == UserRole.admin:
            attention.append({"type": "unpaid_invoices", "severity": "medium", "title": f"{unpaid} unpaid invoice(s)", "detail": "Follow up on payments", "link": "/admin/invoices"})
        prepare.append(f"Review {pending} pending time log(s)") if pending else None
    else:
        rejected = lq.filter(WorkLog.status == WorkLogStatus.rejected).count()
        if rejected: attention.append({"type": "rejected_logs", "severity": "high", "title": f"{rejected} rejected log(s) need fixing", "detail": "Edit & resubmit in Log Time", "link": "/va/time-log"})
    if due_today: prepare.append(f"Finish {len(due_today)} task(s) due today: " + ", ".join(t.title for t in due_today[:3]))
    if in_progress: prepare.append(f"Continue in-progress work: {in_progress[0].title}")
    if not is_admin: prepare.append("Clock in when you start — your hours log automatically")
    prepare.append("Check comments on your tasks for updates from the team")
    if overdue: prepare.insert(0, f"Clear {len(overdue)} overdue item(s) first")

    # Live clock
    cq = db.query(TimeClockEntry).options(joinedload(TimeClockEntry.va), joinedload(TimeClockEntry.task), joinedload(TimeClockEntry.client)).filter(TimeClockEntry.status.in_([ClockStatus.running, ClockStatus.paused]))
    if is_va: cq = cq.filter(TimeClockEntry.va_id == current.va_id)
    from app.routers.timeclock import _serialize as serialize_clock
    live = [serialize_clock(e).model_dump(mode="json") for e in cq.all()]

    # Projects progress
    pq = db.query(Project).options(joinedload(Project.client)).filter(Project.status == "active")
    projects = []
    from app.routers.projects import _serialize as serialize_project
    for p in pq.order_by(Project.due_date.asc().nullslast()).limit(6).all():
        projects.append(serialize_project(db, p).model_dump(mode="json"))

    # Recent comments on visible tasks
    task_ids = [t.id for t in all_tasks]
    comments = []
    if task_ids:
        rows = db.query(TaskComment).filter(TaskComment.task_id.in_(task_ids)).order_by(TaskComment.created_at.desc()).limit(5).all()
        comments = [{"id": str(c.id), "task_id": str(c.task_id), "author_name": c.author_name, "body": c.body, "created_at": c.created_at.isoformat() if c.created_at else None} for c in rows]

    tomorrow = today + timedelta(days=1)
    tomorrow_tasks = [t for t in all_tasks if t.due_date == tomorrow and t.status != TaskStatus.done]
    est_today = sum(float(t.estimated_hours or 0) for t in due_today)
    # Workload per VA (admin) — who is overloaded / free
    team_load = []
    if is_admin:
        va_map: dict[str, dict] = {}
        for t in all_tasks:
            if t.status == TaskStatus.done or not t.assignee:
                continue
            row = va_map.setdefault(t.assignee.name, {"name": t.assignee.name, "open": 0, "overdue": 0, "due_today": 0})
            row["open"] += 1
            if t.due_date and t.due_date < today: row["overdue"] += 1
            if t.due_date == today: row["due_today"] += 1
        team_load = sorted(va_map.values(), key=lambda r: (-r["overdue"], -r["open"]))[:6]

    return {
        "role": current.role.value, "today": str(today), "week_start": str(week_start), "week_end": str(week_end),
        "tomorrow_tasks": [_task_mini(db, t) for t in tomorrow_tasks[:6]],
        "estimated_hours_today": str(est_today),
        "team_load": team_load,
        "counts": {"total_tasks": len(all_tasks), "todo": len(by_status(TaskStatus.todo)), "in_progress": len(in_progress), "in_review": len(by_status(TaskStatus.in_review)), "approved": len(by_status(TaskStatus.approved)), "done": len(by_status(TaskStatus.done)), "blocked": len(blocked), "overdue": len(overdue), "due_today": len(due_today), "unassigned": len(unassigned), "done_this_week": len(done_week)},
        "hours_today": str(hours_today), "hours_this_week": str(hours_week),
        "today_tasks": [_task_mini(db, t) for t in (due_today + [t for t in in_progress if t not in due_today])[:8]],
        "backlog": [_task_mini(db, t) for t in backlog[:8]],
        "upcoming": [_task_mini(db, t) for t in upcoming[:8]],
        "needs_attention": attention, "prepare": [p for p in prepare if p],
        "live_clock": live, "projects": projects, "recent_comments": comments,
    }


@router.get("/activity")
def get_team_activity(_: Annotated[CurrentUser, Depends(require_admin_or_auditor)], db: Annotated[Session, Depends(get_db)]):
    """Monday-style team activity: who is working, who is low, and who has assigned
    clients/tasks but no logs today or this week. Flags a VA who logged no time
    or no tasks for the day and notifies admins and project managers."""
    today = date.today()
    week_start, week_end = get_week_period("this_week")
    vas = (
        db.query(VA)
        .options(joinedload(VA.user), joinedload(VA.reviewer))
        .join(User, VA.user_id == User.id)
        .filter(VA.is_active.is_(True), User.role == UserRole.va)
        .order_by(VA.name)
        .all()
    )

    out = []
    for va in vas:
        tasks = db.query(Task).options(joinedload(Task.client)).filter(Task.assignee_va_id == va.id).all()
        open_tasks = [t for t in tasks if t.status != TaskStatus.done]
        overdue = [t for t in open_tasks if t.due_date and t.due_date < today]
        due_today = [t for t in open_tasks if t.due_date == today]

        logs = db.query(WorkLog).options(joinedload(WorkLog.client)).filter(WorkLog.va_id == va.id).order_by(WorkLog.work_date.desc()).all()
        logs_today = [l for l in logs if l.work_date == today]
        logs_week = [l for l in logs if week_start <= l.work_date <= week_end]
        hours_today = sum((l.hours for l in logs_today), Decimal("0"))
        hours_week = sum((l.hours for l in logs_week), Decimal("0"))

        live = db.query(TimeClockEntry).filter(
            TimeClockEntry.va_id == va.id, TimeClockEntry.status.in_([ClockStatus.running, ClockStatus.paused])
        ).first()

        # Clients this VA is assigned to (via open tasks), with their logged hours this week
        client_map: dict = {}
        for t in open_tasks:
            if not t.client:
                continue
            c = client_map.setdefault(t.client.id, {"client_id": str(t.client.id), "name": t.client.name, "open_tasks": 0, "hours_week": Decimal("0"), "last_log_date": None})
            c["open_tasks"] += 1
        for l in logs_week:
            if l.client_id in client_map:
                client_map[l.client_id]["hours_week"] += l.hours
        for l in logs:
            if l.client_id in client_map and client_map[l.client_id]["last_log_date"] is None:
                client_map[l.client_id]["last_log_date"] = l.work_date
        assigned_clients = [
            {**c, "hours_week": str(c["hours_week"]), "last_log_date": str(c["last_log_date"]) if c["last_log_date"] else None,
             "no_activity_week": c["hours_week"] == 0}
            for c in sorted(client_map.values(), key=lambda x: x["hours_week"])
        ]
        idle_clients = [c for c in assigned_clients if c["no_activity_week"]]

        last_activity = None
        if logs:
            last_activity = logs[0].work_date
        reasons: list[str] = []
        pretty_today = f"{today.strftime('%b')} {today.day}, {today.year}"
        task_logs_today = [l for l in logs_today if l.task_id or (getattr(l, "task_name", None) or "").strip()]
        if not logs_today and not live:
            reasons.append(f"No time logged on {pretty_today}")
        if not task_logs_today and not (live and live.task_id):
            reasons.append(f"No tasks logged on {pretty_today}")
        if open_tasks and not logs_week:
            reasons.append("No logs this week")
        if idle_clients:
            reasons.append(f"No activity this week for {', '.join(c['name'] for c in idle_clients[:2])}")
        if overdue:
            reasons.append(f"{len(overdue)} overdue task(s)")
        if hours_week and hours_week < Decimal("8"):
            reasons.append(f"Only {hours_week}h logged this week")

        if not open_tasks and not logs_week:
            act_status = "idle"  # nothing assigned — available for work
        elif open_tasks and not logs_week:
            act_status = "inactive"
        elif (not logs_today and hours_week < Decimal("15")) or overdue:
            act_status = "low"
        else:
            act_status = "active"

        out.append({
            "va_id": str(va.id), "user_id": str(va.user_id), "name": va.name,
            "email": va.user.email if va.user else None,
            "reviewer_user_id": str(va.reviewer_user_id) if va.reviewer_user_id else None,
            "reviewer_name": (va.reviewer.display_name or va.reviewer.email) if va.reviewer else None,
            "status": act_status, "reasons": reasons,
            "assigned_clients": assigned_clients,
            "open_tasks": len(open_tasks), "overdue": len(overdue), "due_today": len(due_today),
            "in_progress": len([t for t in open_tasks if t.status == TaskStatus.in_progress]),
            "hours_today": str(hours_today), "hours_week": str(hours_week),
            "logs_today": len(logs_today), "logs_week": len(logs_week),
            "clock_status": live.status.value if live else None,
            "last_activity": str(last_activity) if last_activity else None,
        })

    # Daily alert: no hours or no tasks. Bell stays with admins and project managers.
    # Email goes to the VA and project managers, not to Jane.
    try:
        from app.services.task_deadlines import notify_task_deadlines
        from app.services.va_inactivity import notify_daily_inactivity
        notify_task_deadlines(db)
        notify_daily_inactivity(db, today)
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass

    order = {"inactive": 0, "low": 1, "active": 2, "idle": 3}
    out.sort(key=lambda r: (order.get(r["status"], 9), -int(r["overdue"]), r["name"]))
    return {
        "week_start": str(week_start), "week_end": str(week_end), "today": str(today),
        "members": out,
        "counts": {
            "inactive": len([r for r in out if r["status"] == "inactive"]),
            "low": len([r for r in out if r["status"] == "low"]),
            "active": len([r for r in out if r["status"] == "active"]),
            "idle": len([r for r in out if r["status"] == "idle"]),
        },
    }


@router.get("/summary", response_model=DashboardSummary)
def get_dashboard_summary(
    current: Annotated[CurrentUser, Depends(require_admin_or_auditor)],
    db: Annotated[Session, Depends(get_db)],
):
    # Auditors get ops metrics only — money fields zeroed
    if hide_team_money(current.role):
        pending_entries = db.query(WorkLog).filter(WorkLog.status == WorkLogStatus.submitted).count()
        approved_hours = (
            db.query(func.coalesce(func.sum(WorkLog.hours), 0))
            .filter(WorkLog.status.in_([WorkLogStatus.approved, WorkLogStatus.invoiced]))
            .scalar()
            or Decimal("0")
        )
        active_clients = db.query(Client).filter(
            Client.is_active == True, Client.approval_status == ClientApprovalStatus.approved
        ).count()
        active_vas = (
            db.query(VA)
            .join(User, VA.user_id == User.id)
            .filter(VA.is_active == True, User.role == UserRole.va)
            .count()
        )
        pending_logs = (
            db.query(WorkLog)
            .options(joinedload(WorkLog.va), joinedload(WorkLog.client), joinedload(WorkLog.sub_client), joinedload(WorkLog.project), joinedload(WorkLog.task), joinedload(WorkLog.attachments))
            .filter(WorkLog.status == WorkLogStatus.submitted)
            .order_by(WorkLog.created_at.desc())
            .limit(10)
            .all()
        )
        hours_by_client = (
            db.query(Client.name, func.sum(WorkLog.hours).label("hours"))
            .join(WorkLog, WorkLog.client_id == Client.id)
            .filter(WorkLog.status.in_([WorkLogStatus.approved, WorkLogStatus.invoiced]))
            .group_by(Client.name)
            .order_by(func.sum(WorkLog.hours).desc())
            .all()
        )
        return DashboardSummary(
            total_invoiced=Decimal("0"),
            paid_by_clients=Decimal("0"),
            total_va_payout=Decimal("0"),
            estimated_profit=Decimal("0"),
            pending_entries=pending_entries,
            approved_hours=Decimal(str(approved_hours)),
            active_clients=active_clients,
            invoices_issued=0,
            unpaid_invoices=0,
            this_week_va_pay=Decimal("0"),
            active_vas=active_vas,
            hours_by_client=[{"client": r.name, "hours": float(r.hours)} for r in hours_by_client],
            va_pay_this_week=[],
            pending_logs=[_serialize_log(log, redact_money=True) for log in pending_logs],
        )

    total_invoiced = db.query(func.coalesce(func.sum(Invoice.amount), 0)).scalar() or Decimal("0")
    paid_by_clients = (
        db.query(func.coalesce(func.sum(Invoice.amount), 0))
        .filter(Invoice.status == InvoiceStatus.paid)
        .scalar()
        or Decimal("0")
    )
    total_va_payout = (
        db.query(func.coalesce(func.sum(WorkLog.va_pay), 0))
        .filter(WorkLog.status.in_([WorkLogStatus.approved, WorkLogStatus.invoiced]))
        .scalar()
        or Decimal("0")
    )
    pending_entries = db.query(WorkLog).filter(WorkLog.status == WorkLogStatus.submitted).count()
    approved_hours = (
        db.query(func.coalesce(func.sum(WorkLog.hours), 0))
        .filter(WorkLog.status.in_([WorkLogStatus.approved, WorkLogStatus.invoiced]))
        .scalar()
        or Decimal("0")
    )
    active_clients = db.query(Client).filter(
        Client.is_active == True, Client.approval_status == ClientApprovalStatus.approved
    ).count()
    invoices_issued = db.query(Invoice).count()
    unpaid_invoices = db.query(Invoice).filter(Invoice.status == InvoiceStatus.unpaid).count()
    active_vas = (
        db.query(VA)
        .join(User, VA.user_id == User.id)
        .filter(VA.is_active == True, User.role == UserRole.va)
        .count()
    )

    week_start, week_end = get_week_period("this_week")
    this_week_va_pay = (
        db.query(func.coalesce(func.sum(WorkLog.va_pay), 0))
        .filter(
            WorkLog.status.in_([WorkLogStatus.approved, WorkLogStatus.invoiced]),
            WorkLog.work_date >= week_start,
            WorkLog.work_date <= week_end,
        )
        .scalar()
        or Decimal("0")
    )

    hours_by_client = (
        db.query(Client.name, func.sum(WorkLog.hours).label("hours"))
        .join(WorkLog, WorkLog.client_id == Client.id)
        .filter(WorkLog.status.in_([WorkLogStatus.approved, WorkLogStatus.invoiced]))
        .group_by(Client.name)
        .order_by(func.sum(WorkLog.hours).desc())
        .all()
    )

    va_pay_rows = (
        db.query(VA.id, VA.name, VA.currency, func.sum(WorkLog.va_pay).label("pay"), func.sum(WorkLog.hours).label("hours"))
        .join(WorkLog, WorkLog.va_id == VA.id)
        .filter(
            WorkLog.status.in_([WorkLogStatus.approved, WorkLogStatus.invoiced]),
            WorkLog.work_date >= week_start,
            WorkLog.work_date <= week_end,
        )
        .group_by(VA.id, VA.name, VA.currency)
        .all()
    )

    pending_logs = (
        db.query(WorkLog)
        .options(joinedload(WorkLog.va), joinedload(WorkLog.client), joinedload(WorkLog.sub_client), joinedload(WorkLog.project), joinedload(WorkLog.task), joinedload(WorkLog.attachments))
        .filter(WorkLog.status == WorkLogStatus.submitted)
        .order_by(WorkLog.created_at.desc())
        .limit(10)
        .all()
    )

    return DashboardSummary(
        total_invoiced=Decimal(str(total_invoiced)),
        paid_by_clients=Decimal(str(paid_by_clients)),
        total_va_payout=Decimal(str(total_va_payout)),
        estimated_profit=Decimal(str(total_invoiced)) - Decimal(str(total_va_payout)),
        pending_entries=pending_entries,
        approved_hours=Decimal(str(approved_hours)),
        active_clients=active_clients,
        invoices_issued=invoices_issued,
        unpaid_invoices=unpaid_invoices,
        this_week_va_pay=Decimal(str(this_week_va_pay)),
        active_vas=active_vas,
        hours_by_client=[{"client": r.name, "hours": float(r.hours)} for r in hours_by_client],
        va_pay_this_week=[
            {"va_id": str(r.id), "name": r.name, "currency": r.currency.value, "pay": float(r.pay), "hours": float(r.hours)}
            for r in va_pay_rows
        ],
        pending_logs=[_serialize_log(log) for log in pending_logs],
    )


@router.get("/owner-finance")
def owner_finance(
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    date_from: date | None = None,
    date_to: date | None = None,
    usd_php_rate: Decimal | None = None,
):
    """Admin-only owner earnings and expenses for a custom date range.

    Income is invoices issued in the range plus manual earnings dated in the range.
    USD and PHP stay in separate buckets. A rate combines them into one total in
    dollars and the same total in pesos. Without a rate, nothing is converted.
    """
    today = date.today()
    if not date_from:
        date_from = date(today.year, today.month, 1)
    if not date_to:
        date_to = today
    if date_to < date_from:
        date_from, date_to = date_to, date_from

    rate = Decimal(str(usd_php_rate)) if usd_php_rate and usd_php_rate > 0 else None

    invoices = (
        db.query(Invoice)
        .options(joinedload(Invoice.client))
        .filter(Invoice.issue_date >= date_from, Invoice.issue_date <= date_to)
        .all()
    )
    manual_rows = (
        db.query(ManualEarning)
        .options(joinedload(ManualEarning.client))
        .filter(ManualEarning.earned_date >= date_from, ManualEarning.earned_date <= date_to)
        .order_by(ManualEarning.earned_date.desc(), ManualEarning.created_at.desc())
        .all()
    )
    by_client: dict[str, dict] = {}

    def bucket(name: str, client_id) -> dict:
        row = by_client.get(name)
        if row is None:
            row = {
                "client_id": str(client_id) if client_id else None,
                "client_name": name,
                "usd": Decimal("0"),
                "php": Decimal("0"),
                "invoices": 0,
                "manual": 0,
            }
            by_client[name] = row
        elif client_id and not row["client_id"]:
            row["client_id"] = str(client_id)
        return row

    def add_earned(row: dict, amount: Decimal, currency) -> None:
        if currency_code(currency) == "PHP":
            row["php"] += amount
        else:
            row["usd"] += amount

    earned = MoneySplit()
    for inv in invoices:
        name = inv.client.name if inv.client else "Client"
        row = bucket(name, inv.client_id)
        add_earned(row, inv.amount, inv.currency)
        row["invoices"] += 1
        earned.add(inv.amount, inv.currency)
    for item in manual_rows:
        name = item.client.name if item.client else "Client"
        row = bucket(name, item.client_id)
        add_earned(row, item.amount, item.currency)
        row["manual"] += 1
        earned.add(item.amount, item.currency)

    runs = (
        db.query(PayrollRun)
        .filter(
            func.date(PayrollRun.paid_at) >= date_from,
            func.date(PayrollRun.paid_at) <= date_to,
        )
        .all()
    )
    # paid_at is what left the business in this date range.
    va_pay = MoneySplit()
    for run in runs:
        va_pay.add(run.total_pay, run.currency)

    expenses = (
        db.query(BusinessExpense)
        .filter(BusinessExpense.expense_date >= date_from, BusinessExpense.expense_date <= date_to)
        .order_by(BusinessExpense.expense_date.desc())
        .all()
    )
    expense_money = MoneySplit()
    for expense in expenses:
        expense_money.add(expense.amount, expense.currency)

    net = MoneySplit()
    net.usd = earned.usd - va_pay.usd - expense_money.usd
    net.php = earned.php - va_pay.php - expense_money.php

    client_rows = []
    for row in by_client.values():
        usd = quantize_money(row["usd"])
        php = quantize_money(row["php"])
        combined_usd, combined_php = combine(usd, php, rate)
        client_rows.append({
            "client_id": row["client_id"],
            "client_name": row["client_name"],
            "earned_usd": str(usd),
            "earned_php": str(php),
            "combined_usd": str(combined_usd) if combined_usd is not None else None,
            "combined_php": str(combined_php) if combined_php is not None else None,
            "invoices": row["invoices"],
            "manual": row["manual"],
        })
    client_rows.sort(
        key=lambda row: (
            Decimal(row["combined_usd"]) if row["combined_usd"] is not None else Decimal(row["earned_usd"]),
            Decimal(row["earned_php"]),
        ),
        reverse=True,
    )

    return {
        "period_start": str(date_from),
        "period_end": str(date_to),
        "usd_php_rate": str(rate) if rate else None,
        "earned": pack_money(earned, rate),
        "va_payroll": pack_money(va_pay, rate),
        "expense_totals": pack_money(expense_money, rate),
        "net": pack_money(net, rate),
        "by_client": client_rows,
        "manual_earnings": [
            {
                "id": str(item.id),
                "client_id": str(item.client_id),
                "client_name": item.client.name if item.client else "Client",
                "client_active": bool(item.client.is_active) if item.client else False,
                "earned_date": str(item.earned_date),
                "description": item.description,
                "amount": str(item.amount),
                "currency": item.currency,
            }
            for item in manual_rows
        ],
        "expenses": [
            {
                "id": str(expense.id),
                "expense_date": str(expense.expense_date),
                "description": expense.description,
                "amount": str(expense.amount),
                "currency": expense.currency,
            }
            for expense in expenses
        ],
        "va_runs_count": len(runs),
        "invoices_count": len(invoices),
        "manual_count": len(manual_rows),
    }
