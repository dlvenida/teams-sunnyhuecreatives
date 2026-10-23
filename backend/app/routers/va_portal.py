from calendar import monthrange
from datetime import date, time
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import CurrentUser, require_va
from app.models import Client, SubClient, TimesheetStatus, TimesheetSubmission, VA, WorkLog, WorkLogStatus
from app.schemas import ClientResponse, SubClientResponse, TimesheetSubmissionResponse, TimesheetSubmitRequest, VAWorkLogUpdate
from app.schemas import WorkLogCreate, WorkLogResponse
from app.services.billing import get_week_period
from app.services.calculations import calculate_hours
from app.services.email import send_va_submission_notification
from app.services.notifications import admin_and_auditor_user_ids, push
from app.services.va_rates import get_approved_rate, package_flats_for_period, resolve_log_pay
from app.services.work_log_overlap import assert_no_time_overlap

router = APIRouter(prefix="/va", tags=["va"])

BILLABLE = [WorkLogStatus.approved, WorkLogStatus.invoiced]


def _serialize_log(log: WorkLog) -> WorkLogResponse:
    return WorkLogResponse(
        id=log.id,
        work_date=log.work_date,
        va_id=log.va_id,
        va_name=log.va.name if log.va else None,
        client_id=log.client_id,
        client_name=log.client.name if log.client else None,
        sub_client_id=log.sub_client_id,
        sub_client_name=log.sub_client.name if log.sub_client else None,
        description_lexical=log.description_lexical,
        description_plain=log.description_plain,
        start_time=log.start_time,
        end_time=log.end_time,
        hours=log.hours,
        va_rate=log.va_rate,
        va_pay=log.va_pay,
        notes=log.notes,
        status=log.status,
        invoice_id=log.invoice_id,
        project_id=log.project_id, project_name=log.project.name if getattr(log, "project", None) else None,
        task_id=log.task_id, task_title=log.task.title if getattr(log, "task", None) else None,
        clock_in_at=log.clock_in_at, clock_out_at=log.clock_out_at, source=log.source or "manual",
        created_at=log.created_at,
        attachment_count=len(log.attachments) if getattr(log, "attachments", None) is not None else 0,
    )


@router.get("/clients", response_model=list[ClientResponse])
def list_clients_for_va(
    _: Annotated[CurrentUser, Depends(require_va)],
    db: Annotated[Session, Depends(get_db)],
):
    return db.query(Client).filter(Client.is_active == True).order_by(Client.name).all()


@router.get("/my-clients")
def my_assigned_clients(
    current: Annotated[CurrentUser, Depends(require_va)],
    db: Annotated[Session, Depends(get_db)],
):
    """Clients ASSIGNED to this VA (from their tasks and time logs) — the VA Clients tab."""
    from decimal import Decimal
    from app.models import Project, Task, TaskStatus, WorkLogStatus

    tasks = db.query(Task).filter(Task.assignee_va_id == current.va_id).all()
    logs = db.query(WorkLog).filter(WorkLog.va_id == current.va_id).all()
    billable = [l for l in logs if l.status in (WorkLogStatus.approved, WorkLogStatus.invoiced)]
    client_ids: list = []
    for src in ([t.client_id for t in tasks] + [l.client_id for l in logs]):
        if src and src not in client_ids:
            client_ids.append(src)
    rows = []
    for cid in client_ids:
        c_tasks = [t for t in tasks if t.client_id == cid]
        c_logs = [l for l in logs if l.client_id == cid]
        b_logs = [l for l in billable if l.client_id == cid]
        client_obj = (c_tasks[0].client if c_tasks else None) or (c_logs[0].client if c_logs else None)
        if not client_obj:
            continue
        project_ids = {t.project_id for t in c_tasks if t.project_id} | {l.project_id for l in c_logs if l.project_id}
        projects = []
        for pid in project_ids:
            p = db.query(Project).filter(Project.id == pid).first()
            if p:
                p_tasks = [t for t in c_tasks if t.project_id == pid]
                projects.append({"id": str(p.id), "name": p.name, "color": p.color, "status": p.status.value if hasattr(p.status, "value") else str(p.status), "task_total": len(p_tasks), "task_done": len([t for t in p_tasks if t.status == TaskStatus.done])})
        sub_names = sorted({l.sub_client.name for l in c_logs if l.sub_client})
        rows.append({
            "client_id": str(cid), "name": client_obj.name,
            "billing_type": client_obj.billing_type.value if hasattr(client_obj.billing_type, "value") else str(client_obj.billing_type),
            "is_active": bool(client_obj.is_active),
            "total_tasks": len(c_tasks),
            "open_tasks": len([t for t in c_tasks if t.status != TaskStatus.done]),
            "done_tasks": len([t for t in c_tasks if t.status == TaskStatus.done]),
            "overdue_tasks": len([t for t in c_tasks if t.status != TaskStatus.done and t.due_date and str(t.due_date) < str(__import__("datetime").date.today())]),
            "hours": str(sum((l.hours for l in b_logs), Decimal("0"))),
            "pending_hours": str(sum((l.hours for l in c_logs if l.status == WorkLogStatus.submitted), Decimal("0"))),
            "logs": len(c_logs),
            "last_log_date": str(max((l.work_date for l in c_logs), default=None)) if c_logs else None,
            "next_due": str(min((t.due_date for t in c_tasks if t.status != TaskStatus.done and t.due_date), default=None)) if any(t.due_date for t in c_tasks if t.status != TaskStatus.done) else None,
            "sub_clients": sub_names,
            "projects": projects,
            "tasks": [{"id": str(t.id), "title": t.title, "status": t.status.value if hasattr(t.status, "value") else str(t.status), "priority": t.priority.value if hasattr(t.priority, "value") else str(t.priority), "due_date": str(t.due_date) if t.due_date else None, "project_name": t.project.name if t.project else None} for t in sorted(c_tasks, key=lambda x: (x.due_date or __import__("datetime").date.max))[:10]],
        })
    rows.sort(key=lambda r: r["name"].lower())
    return rows


@router.get("/sub-clients", response_model=list[SubClientResponse])
def list_sub_clients_for_va(
    _: Annotated[CurrentUser, Depends(require_va)],
    db: Annotated[Session, Depends(get_db)],
    client_id: str | None = None,
):
    q = db.query(SubClient).filter(SubClient.is_active == True)
    if client_id:
        q = q.filter(SubClient.client_id == client_id)
    return q.order_by(SubClient.name).all()


@router.get("/me")
def get_va_profile(
    current: Annotated[CurrentUser, Depends(require_va)],
    db: Annotated[Session, Depends(get_db)],
):
    va = db.query(VA).filter(VA.id == current.va_id).first()
    if not va:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VA not found")
    return {"id": va.id, "name": va.name, "currency": va.currency, "email": current.user.email}


@router.get("/work-logs", response_model=list[WorkLogResponse])
def list_my_work_logs(
    current: Annotated[CurrentUser, Depends(require_va)],
    db: Annotated[Session, Depends(get_db)],
):
    logs = (
        db.query(WorkLog)
        .options(joinedload(WorkLog.client), joinedload(WorkLog.sub_client), joinedload(WorkLog.va), joinedload(WorkLog.project), joinedload(WorkLog.task), joinedload(WorkLog.attachments))
        .filter(WorkLog.va_id == current.va_id)
        .order_by(WorkLog.work_date.desc(), WorkLog.created_at.desc())
        .all()
    )
    return [_serialize_log(log) for log in logs]


def _my_log_or_404(db: Session, log_id: UUID, va_id):
    log = (
        db.query(WorkLog)
        .options(joinedload(WorkLog.client), joinedload(WorkLog.sub_client), joinedload(WorkLog.va), joinedload(WorkLog.project), joinedload(WorkLog.task))
        .filter(WorkLog.id == log_id, WorkLog.va_id == va_id)
        .first()
    )
    if not log:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work log not found")
    return log


@router.patch("/work-logs/{log_id}", response_model=WorkLogResponse)
def update_my_work_log(log_id: UUID, body: VAWorkLogUpdate, current: Annotated[CurrentUser, Depends(require_va)], db: Annotated[Session, Depends(get_db)]):
    """VA can edit their own log while it is still submitted/rejected (not approved/invoiced)."""
    log = _my_log_or_404(db, log_id, current.va_id)
    if log.status in (WorkLogStatus.approved, WorkLogStatus.invoiced):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Approved/invoiced logs can only be edited by an admin")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(log, k, v)
    if body.start_time or body.end_time or body.work_date:
        start = body.start_time or log.start_time
        end = body.end_time or log.end_time
        work_date = body.work_date or log.work_date
        assert_no_time_overlap(
            db,
            va_id=current.va_id,
            work_date=work_date,
            start_time=start,
            end_time=end,
            exclude_id=log.id,
        )
        log.hours = calculate_hours(start, end)
        rate, pay, _ = resolve_log_pay(db, current.va_id, log.client_id, log.hours)
        log.va_rate = rate
        log.va_pay = pay
        if log.status == WorkLogStatus.rejected:
            log.status = WorkLogStatus.submitted  # editing a rejected log resubmits it
    db.commit()
    db.refresh(log)
    return _serialize_log(_my_log_or_404(db, log.id, current.va_id))


@router.delete("/work-logs/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_work_log(log_id: UUID, current: Annotated[CurrentUser, Depends(require_va)], db: Annotated[Session, Depends(get_db)]):
    log = _my_log_or_404(db, log_id, current.va_id)
    if log.status in (WorkLogStatus.approved, WorkLogStatus.invoiced):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Approved/invoiced logs cannot be deleted")
    db.delete(log)
    db.commit()


@router.get("/earnings")
def my_earnings(
    current: Annotated[CurrentUser, Depends(require_va)],
    db: Annotated[Session, Depends(get_db)],
    date_from: date | None = None,
    date_to: date | None = None,
):
    """VA earnings: This Week / Month / All Time + optional custom range. Approved (+invoiced) only."""
    today = date.today()
    week_start, week_end = get_week_period("this_week")
    month_start = date(today.year, today.month, 1)
    month_end = date(today.year, today.month, monthrange(today.year, today.month)[1])

    logs = (
        db.query(WorkLog)
        .options(
            joinedload(WorkLog.client),
            joinedload(WorkLog.va),
            joinedload(WorkLog.project),
            joinedload(WorkLog.task),
        )
        .filter(WorkLog.va_id == current.va_id, WorkLog.status.in_(BILLABLE))
        .order_by(WorkLog.work_date.desc())
        .all()
    )
    va = db.query(VA).filter(VA.id == current.va_id).first()
    currency = va.currency.value if va else "USD"

    def period_stats(start: date | None, end: date | None):
        subset = [l for l in logs if (start is None or l.work_date >= start) and (end is None or l.work_date <= end)]
        hours = sum((l.hours for l in subset), Decimal("0"))
        # Hourly pay from logs + package flats once per client in range
        hourly_pay = sum((l.va_pay for l in subset), Decimal("0"))
        client_ids = {l.client_id for l in subset}
        flats = package_flats_for_period(db, current.va_id, client_ids)
        package_pay = sum(flats.values(), Decimal("0"))
        return {
            "hours": str(hours),
            "earned": str(hourly_pay + package_pay),
            "entries": len(subset),
            "currency": currency,
        }

    # Breakdown by client for custom range (or all time)
    range_start, range_end = date_from, date_to
    range_logs = [l for l in logs if (range_start is None or l.work_date >= range_start) and (range_end is None or l.work_date <= range_end)]
    by_client_map: dict = {}
    for l in range_logs:
        key = str(l.client_id)
        row = by_client_map.setdefault(
            key,
            {"client_id": key, "client_name": l.client.name if l.client else "Client", "hours": Decimal("0"), "earned": Decimal("0"), "pay_type": "hourly", "currency": currency, "status": "Approved"},
        )
        row["hours"] += l.hours
        row["earned"] += l.va_pay
    for cid, flat in package_flats_for_period(db, current.va_id, {UUID(k) for k in by_client_map}).items():
        key = str(cid)
        if key in by_client_map:
            by_client_map[key]["earned"] = flat
            by_client_map[key]["pay_type"] = "package"
            rate = get_approved_rate(db, current.va_id, cid)
            if rate:
                by_client_map[key]["currency"] = rate.currency.value

    by_client = [
        {**r, "hours": str(r["hours"]), "earned": str(r["earned"])}
        for r in sorted(by_client_map.values(), key=lambda x: x["client_name"].lower())
    ]

    entries = [
        {
            "id": str(l.id),
            "work_date": str(l.work_date),
            "client_name": l.client.name if l.client else "Client",
            "description": l.description_plain or "",
            "hours": str(l.hours),
            "rate": str(l.va_rate),
            "pay": str(l.va_pay),
            "project_name": l.project.name if getattr(l, "project", None) else None,
            "task_title": l.task.title if getattr(l, "task", None) else None,
            "source": l.source or "manual",
        }
        for l in sorted(range_logs, key=lambda x: (x.work_date, x.start_time or time.min))
    ]

    from app.routers.settings import _get_settings
    company_name = _get_settings(db).get("company_name") or "Sunny Hue Creatives"

    return {
        "currency": currency,
        "va_name": va.name if va else None,
        "company_name": company_name,
        "this_week": period_stats(week_start, week_end),
        "this_month": period_stats(month_start, month_end),
        "all_time": period_stats(None, None),
        "range": period_stats(range_start, range_end) if (date_from or date_to) else None,
        "by_client": by_client,
        "entries": entries,
        "date_from": str(date_from) if date_from else None,
        "date_to": str(date_to) if date_to else None,
    }


@router.post("/work-logs", response_model=WorkLogResponse, status_code=status.HTTP_201_CREATED)
def submit_work_log(
    body: WorkLogCreate,
    current: Annotated[CurrentUser, Depends(require_va)],
    db: Annotated[Session, Depends(get_db)],
):
    hours = calculate_hours(body.start_time, body.end_time)
    assert_no_time_overlap(
        db,
        va_id=current.va_id,
        work_date=body.work_date,
        start_time=body.start_time,
        end_time=body.end_time,
    )
    rate, pay, _ = resolve_log_pay(db, current.va_id, body.client_id, hours)

    log = WorkLog(
        work_date=body.work_date,
        va_id=current.va_id,
        client_id=body.client_id,
        sub_client_id=body.sub_client_id,
        project_id=body.project_id,
        task_id=body.task_id,
        description_lexical=body.description_lexical,
        description_plain=body.description_plain,
        start_time=body.start_time,
        end_time=body.end_time,
        hours=hours,
        va_rate=rate,
        va_pay=pay,
        notes=body.notes,
        status=WorkLogStatus.submitted,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    log = (
        db.query(WorkLog)
        .options(joinedload(WorkLog.client), joinedload(WorkLog.sub_client), joinedload(WorkLog.va), joinedload(WorkLog.project), joinedload(WorkLog.task))
        .filter(WorkLog.id == log.id)
        .first()
    )

    send_va_submission_notification(
        va_name=log.va.name,
        client_name=log.client.name,
        hours=str(log.hours),
        work_date=str(log.work_date),
        description=log.description_plain[:200],
    )
    push(db, admin_and_auditor_user_ids(db), "log", f"🕒 New time log from {log.va.name}",
         f"{log.client.name} · {log.work_date} · {log.hours} hrs waiting for approval.", "/admin/logs")

    return _serialize_log(log)


@router.get("/timesheets", response_model=list[TimesheetSubmissionResponse])
def list_my_timesheets(
    current: Annotated[CurrentUser, Depends(require_va)],
    db: Annotated[Session, Depends(get_db)],
    date_from: date | None = None,
    date_to: date | None = None,
):
    q = db.query(TimesheetSubmission).filter(TimesheetSubmission.va_id == current.va_id)
    if date_from and date_to:
        q = q.filter(
            TimesheetSubmission.period_start == date_from,
            TimesheetSubmission.period_end == date_to,
        )
    rows = q.order_by(TimesheetSubmission.submitted_at.desc()).limit(50).all()
    va = db.query(VA).filter(VA.id == current.va_id).first()
    out = []
    for r in rows:
        logs = (
            db.query(WorkLog)
            .filter(
                WorkLog.va_id == r.va_id,
                WorkLog.work_date >= r.period_start,
                WorkLog.work_date <= r.period_end,
                WorkLog.status.in_(BILLABLE + [WorkLogStatus.submitted]),
            )
            .all()
        )
        out.append(
            TimesheetSubmissionResponse(
                id=r.id,
                va_id=r.va_id,
                va_name=va.name if va else None,
                period_start=r.period_start,
                period_end=r.period_end,
                status=r.status.value if hasattr(r.status, "value") else str(r.status),
                notes=r.notes,
                submitted_at=r.submitted_at,
                reviewed_at=r.reviewed_at,
                entry_count=len(logs),
                total_hours=sum((l.hours for l in logs), Decimal("0")),
            )
        )
    return out


@router.post("/timesheets/submit", response_model=TimesheetSubmissionResponse, status_code=status.HTTP_201_CREATED)
def submit_timesheet(
    body: TimesheetSubmitRequest,
    current: Annotated[CurrentUser, Depends(require_va)],
    db: Annotated[Session, Depends(get_db)],
):
    if body.date_to < body.date_from:
        raise HTTPException(status_code=400, detail="date_to must be on or after date_from")

    existing = (
        db.query(TimesheetSubmission)
        .filter(
            TimesheetSubmission.va_id == current.va_id,
            TimesheetSubmission.period_start == body.date_from,
            TimesheetSubmission.period_end == body.date_to,
        )
        .first()
    )
    if existing:
        existing.notes = body.notes
        existing.status = TimesheetStatus.submitted
        existing.reviewed_at = None
        existing.reviewed_by = None
        db.commit()
        db.refresh(existing)
        row = existing
    else:
        row = TimesheetSubmission(
            va_id=current.va_id,
            period_start=body.date_from,
            period_end=body.date_to,
            notes=body.notes,
            status=TimesheetStatus.submitted,
        )
        db.add(row)
        db.commit()
        db.refresh(row)

    va = db.query(VA).filter(VA.id == current.va_id).first()
    logs = (
        db.query(WorkLog)
        .filter(
            WorkLog.va_id == current.va_id,
            WorkLog.work_date >= body.date_from,
            WorkLog.work_date <= body.date_to,
            WorkLog.status.in_(BILLABLE + [WorkLogStatus.submitted]),
        )
        .all()
    )
    hours = sum((l.hours for l in logs), Decimal("0"))
    push(
        db,
        admin_and_auditor_user_ids(db),
        "log",
        f"📋 Timesheet submitted by {va.name if va else 'VA'}",
        f"{body.date_from} – {body.date_to} · {hours} hrs · {len(logs)} entries ready for review.",
        "/admin/payroll",
    )
    return TimesheetSubmissionResponse(
        id=row.id,
        va_id=row.va_id,
        va_name=va.name if va else None,
        period_start=row.period_start,
        period_end=row.period_end,
        status=row.status.value if hasattr(row.status, "value") else str(row.status),
        notes=row.notes,
        submitted_at=row.submitted_at,
        reviewed_at=row.reviewed_at,
        entry_count=len(logs),
        total_hours=hours,
    )
