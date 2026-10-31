from calendar import monthrange
from datetime import date, time
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import CurrentUser, require_va
from app.models import (
    Client,
    PayrollRun,
    SubClient,
    TimesheetStatus,
    TimesheetSubmission,
    VA,
    WorkLog,
    WorkLogStatus,
)
from app.schemas import ClientResponse, SubClientResponse, TimesheetSubmissionResponse, TimesheetSubmitRequest, VAWorkLogUpdate
from app.schemas import WorkLogCreate, WorkLogResponse
from app.services.billing import get_week_period
from app.services.calculations import resolve_manual_time
from app.services.email import send_timesheet_submitted_notification, send_va_submission_notification
from app.services.notifications import admin_and_auditor_user_ids, push
from app.services.va_rates import get_approved_rate, package_flats_for_period, resolve_log_pay, whole_va_package_amount
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
        entry_mode=getattr(log, "entry_mode", None) or "range",
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
        payable_on=getattr(log, "payable_on", None),
        rolled_to_next_payroll=bool(getattr(log, "payable_on", None)),
        created_at=log.created_at,
        attachment_count=len(log.attachments) if getattr(log, "attachments", None) is not None else 0,
    )


@router.get("/clients", response_model=list[ClientResponse])
def list_clients_for_va(
    _: Annotated[CurrentUser, Depends(require_va)],
    db: Annotated[Session, Depends(get_db)],
):
    from app.models import ClientApprovalStatus
    return (
        db.query(Client)
        .filter(Client.is_active == True, Client.approval_status == ClientApprovalStatus.approved)
        .order_by(Client.name)
        .all()
    )


@router.get("/my-clients")
def my_assigned_clients(
    current: Annotated[CurrentUser, Depends(require_va)],
    db: Annotated[Session, Depends(get_db)],
):
    """Clients ASSIGNED to this VA (from their tasks and time logs) — the VA Clients tab."""
    from decimal import Decimal
    from app.models import ClientVARole, Project, Task, TaskStatus, WorkLogStatus

    tasks = db.query(Task).filter(Task.assignee_va_id == current.va_id).all()
    logs = db.query(WorkLog).filter(WorkLog.va_id == current.va_id).all()
    billable = [l for l in logs if l.status in (WorkLogStatus.approved, WorkLogStatus.invoiced)]
    role_rows = db.query(ClientVARole).filter(ClientVARole.va_id == current.va_id).all()
    role_by_client = {str(r.client_id): r.role for r in role_rows}
    client_ids: list = []
    for src in ([t.client_id for t in tasks] + [l.client_id for l in logs] + [r.client_id for r in role_rows]):
        if src and src not in client_ids:
            client_ids.append(src)
    rows = []
    for cid in client_ids:
        c_tasks = [t for t in tasks if t.client_id == cid]
        c_logs = [l for l in logs if l.client_id == cid]
        b_logs = [l for l in billable if l.client_id == cid]
        client_obj = (c_tasks[0].client if c_tasks else None) or (c_logs[0].client if c_logs else None)
        if not client_obj:
            from app.models import Client
            client_obj = db.query(Client).filter(Client.id == cid).first()
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
        role = role_by_client.get(str(cid))
        rows.append({
            "client_id": str(cid), "name": client_obj.name,
            "billing_type": client_obj.billing_type.value if hasattr(client_obj.billing_type, "value") else str(client_obj.billing_type),
            "is_active": bool(client_obj.is_active),
            "role": role,
            "has_explicit_role": role is not None,
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


@router.put("/my-clients/{client_id}/role")
def set_my_client_role(
    client_id: UUID,
    body: dict,
    current: Annotated[CurrentUser, Depends(require_va)],
    db: Annotated[Session, Depends(get_db)],
):
    """VAs can view their role per client. Only admin and Project Manager can change it."""
    _ = (client_id, body, current, db)
    raise HTTPException(status_code=403, detail="Only an admin or Project Manager can set a role for a client")


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
    from app.services.payroll_calendar import resolve_payable_on, va_cannot_edit_log

    log = _my_log_or_404(db, log_id, current.va_id)
    if log.status in (WorkLogStatus.approved, WorkLogStatus.invoiced):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Approved/invoiced logs can only be edited by an admin")
    if va_cannot_edit_log(db, current.va_id, log.work_date, getattr(log, "payable_on", None)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This entry is in an approved timesheet and is locked. Add a new late entry instead — it will roll to the next payroll.",
        )
    data = body.model_dump(exclude_unset=True)
    time_keys = {"entry_mode", "start_time", "end_time", "duration_hours", "duration_minutes"}
    time_changed = bool(time_keys & body.model_fields_set) or body.work_date is not None
    for key in time_keys:
        data.pop(key, None)
    for k, v in data.items():
        setattr(log, k, v)
    if time_changed:
        mode = body.entry_mode or getattr(log, "entry_mode", None) or "range"
        try:
            if mode == "duration" and "duration_hours" not in body.model_fields_set and "duration_minutes" not in body.model_fields_set:
                total = int((log.hours or 0) * 60)
                mode, start, end, hours = resolve_manual_time(
                    entry_mode="duration",
                    start=None,
                    end=None,
                    duration_hours=total // 60,
                    duration_minutes=total % 60,
                )
            else:
                mode, start, end, hours = resolve_manual_time(
                    entry_mode=mode,
                    start=body.start_time if "start_time" in body.model_fields_set else log.start_time,
                    end=body.end_time if "end_time" in body.model_fields_set else log.end_time,
                    duration_hours=body.duration_hours,
                    duration_minutes=body.duration_minutes,
                )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        work_date = body.work_date or log.work_date
        if mode == "range":
            assert_no_time_overlap(
                db,
                va_id=current.va_id,
                work_date=work_date,
                start_time=start,
                end_time=end,
                exclude_id=log.id,
            )
        log.entry_mode = mode
        log.start_time = start
        log.end_time = end
        log.hours = hours
        rate, pay, _ = resolve_log_pay(db, current.va_id, log.client_id, log.hours)
        log.va_rate = rate
        log.va_pay = pay
        log.payable_on = resolve_payable_on(db, current.va_id, work_date)
        if log.status == WorkLogStatus.rejected:
            log.status = WorkLogStatus.submitted  # editing a rejected log resubmits it
    db.commit()
    db.refresh(log)
    return _serialize_log(_my_log_or_404(db, log.id, current.va_id))


@router.delete("/work-logs/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_work_log(log_id: UUID, current: Annotated[CurrentUser, Depends(require_va)], db: Annotated[Session, Depends(get_db)]):
    from app.services.payroll_calendar import va_cannot_edit_log

    log = _my_log_or_404(db, log_id, current.va_id)
    if log.status in (WorkLogStatus.approved, WorkLogStatus.invoiced):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Approved/invoiced logs cannot be deleted")
    if va_cannot_edit_log(db, current.va_id, log.work_date, getattr(log, "payable_on", None)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This entry is in an approved timesheet and cannot be deleted")
    db.delete(log)
    db.commit()


def _latest_usd_php_rate(db: Session, va_id) -> str | None:
    """Latest PayrollRun rate for this VA, otherwise any recent positive rate."""

    def _pick(only_va: bool):
        q = db.query(PayrollRun).filter(PayrollRun.usd_php_rate.isnot(None), PayrollRun.usd_php_rate > 0)
        if only_va:
            q = q.filter(PayrollRun.va_id == va_id)
        return q.order_by(PayrollRun.paid_at.desc()).first()

    run = _pick(True) or _pick(False)
    if not run or not run.usd_php_rate:
        return None
    return str(run.usd_php_rate)


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
    va = (
        db.query(VA)
        .options(joinedload(VA.user))
        .filter(VA.id == current.va_id)
        .first()
    )
    raw_currency = getattr(va, "currency", None) if va else None
    currency = getattr(raw_currency, "value", None) or (str(raw_currency) if raw_currency else "USD")
    user = va.user if va else None
    legal = (user.legal_name or "").strip() if user and user.legal_name else ""
    full_name = (
        (user.display_name.strip() if user and user.display_name else "")
        or (va.name if va else None)
    )
    whole = whole_va_package_amount(va) if va else None
    if whole:
        currency = whole[1]

    def period_stats(start: date | None, end: date | None, *, package: bool = False):
        subset = [l for l in logs if (start is None or l.work_date >= start) and (end is None or l.work_date <= end)]
        hours = sum((l.hours for l in subset), Decimal("0"))
        if whole and package:
            # The flat amount is owed once for the selected pay period or the current month,
            # not again for this week and not stacked across all time.
            return {
                "hours": str(hours),
                "earned": str(whole[0]),
                "entries": len(subset),
                "currency": whole[1],
            }
        if whole:
            return {
                "hours": str(hours),
                "earned": "0",
                "entries": len(subset),
                "currency": whole[1],
            }
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
    if whole:
        # The package is one amount on the selected range / current month, not per client.
        for row in by_client_map.values():
            row["earned"] = Decimal("0")
            row["pay_type"] = "va_package"
            row["currency"] = whole[1]
    else:
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
        "va_name": full_name,
        "legal_name": legal or None,
        "compensation_mode": (va.compensation_mode if va else None) or "hourly",
        "va_package_amount": str(whole[0]) if whole else None,
        "va_package_currency": whole[1] if whole else None,
        "usd_php_rate": _latest_usd_php_rate(db, current.va_id),
        "company_name": company_name,
        "this_week": period_stats(week_start, week_end),
        "this_month": period_stats(month_start, month_end, package=True),
        "all_time": period_stats(None, None),
        "range": period_stats(range_start, range_end, package=True) if (date_from or date_to) else None,
        "by_client": by_client,
        "entries": entries,
        "date_from": str(date_from) if date_from else None,
        "date_to": str(date_to) if date_to else None,
    }


@router.get("/payroll-history")
def my_payroll_history(
    current: Annotated[CurrentUser, Depends(require_va)],
    db: Annotated[Session, Depends(get_db)],
    year: int | None = None,
):
    """Full-year payroll history for the logged-in VA, grouped by month for the UI.

    Paid rows come from payroll runs. Unpaid rows are timesheets that have been
    submitted/reviewed but not yet marked paid for that period.
    """
    y = year or date.today().year
    year_start = date(y, 1, 1)
    year_end = date(y, 12, 31)

    runs = (
        db.query(PayrollRun)
        .filter(
            PayrollRun.va_id == current.va_id,
            PayrollRun.period_end >= year_start,
            PayrollRun.period_start <= year_end,
        )
        .order_by(PayrollRun.period_end.desc(), PayrollRun.paid_at.desc())
        .all()
    )
    paid_keys = {(r.period_start, r.period_end) for r in runs}

    sheets = (
        db.query(TimesheetSubmission)
        .filter(
            TimesheetSubmission.va_id == current.va_id,
            TimesheetSubmission.period_end >= year_start,
            TimesheetSubmission.period_start <= year_end,
        )
        .order_by(TimesheetSubmission.period_end.desc())
        .all()
    )

    entries: list[dict] = []
    for r in runs:
        pay = Decimal(str(r.total_pay))
        currency = (r.currency or "USD").upper()
        rate = Decimal(str(r.usd_php_rate)) if r.usd_php_rate and r.usd_php_rate > 0 else None
        if currency == "PHP":
            php_amount = pay
            usd_amount = None
        elif rate:
            php_amount = (pay * rate).quantize(Decimal("0.01"))
            usd_amount = pay
        else:
            php_amount = None
            usd_amount = pay if currency == "USD" else None
        entries.append({
            "id": str(r.id),
            "kind": "paid",
            "status": "paid",
            "period_start": str(r.period_start),
            "period_end": str(r.period_end),
            "paid_at": r.paid_at.isoformat() if r.paid_at else None,
            "total_hours": str(r.total_hours),
            "total_pay": str(r.total_pay),
            "currency": currency,
            "usd_php_rate": str(rate) if rate else None,
            "php_amount": str(php_amount) if php_amount is not None else None,
            "usd_amount": str(usd_amount) if usd_amount is not None else None,
            "method": r.method,
            "month_key": f"{r.period_end.year}-{r.period_end.month:02d}",
            "month_label": r.period_end.strftime("%B %Y"),
        })

    for s in sheets:
        if (s.period_start, s.period_end) in paid_keys:
            continue
        status_val = s.status.value if hasattr(s.status, "value") else str(s.status)
        sheet_hours = (
            db.query(WorkLog)
            .filter(
                WorkLog.va_id == current.va_id,
                WorkLog.work_date >= s.period_start,
                WorkLog.work_date <= s.period_end,
                WorkLog.status.in_(BILLABLE + [WorkLogStatus.submitted]),
            )
            .all()
        )
        hours_sum = sum((l.hours for l in sheet_hours), Decimal("0"))
        entries.append({
            "id": str(s.id),
            "kind": "timesheet",
            "status": "unpaid",
            "timesheet_status": status_val,
            "period_start": str(s.period_start),
            "period_end": str(s.period_end),
            "paid_at": None,
            "total_hours": str(hours_sum),
            "total_pay": None,
            "currency": None,
            "usd_php_rate": None,
            "php_amount": None,
            "usd_amount": None,
            "method": None,
            "month_key": f"{s.period_end.year}-{s.period_end.month:02d}",
            "month_label": s.period_end.strftime("%B %Y"),
        })

    # Sort newest period first
    entries.sort(key=lambda e: (e["period_end"], e["period_start"]), reverse=True)

    months: dict[str, dict] = {}
    for e in entries:
        bucket = months.setdefault(
            e["month_key"],
            {"month_key": e["month_key"], "month_label": e["month_label"], "entries": []},
        )
        bucket["entries"].append(e)

    month_list = sorted(months.values(), key=lambda m: m["month_key"], reverse=True)

    return {
        "year": y,
        "months": month_list,
        "total_paid_php": str(
            sum(
                (Decimal(e["php_amount"]) for e in entries if e["status"] == "paid" and e.get("php_amount")),
                Decimal("0"),
            )
        ),
        "paid_count": len([e for e in entries if e["status"] == "paid"]),
        "unpaid_count": len([e for e in entries if e["status"] == "unpaid"]),
    }


@router.post("/work-logs", response_model=WorkLogResponse, status_code=status.HTTP_201_CREATED)
def submit_work_log(
    body: WorkLogCreate,
    current: Annotated[CurrentUser, Depends(require_va)],
    db: Annotated[Session, Depends(get_db)],
):
    from app.services.payroll_calendar import resolve_payable_on

    try:
        mode, start, end, hours = resolve_manual_time(
            entry_mode=body.entry_mode,
            start=body.start_time,
            end=body.end_time,
            duration_hours=body.duration_hours,
            duration_minutes=body.duration_minutes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if mode == "range":
        assert_no_time_overlap(
            db,
            va_id=current.va_id,
            work_date=body.work_date,
            start_time=start,
            end_time=end,
        )
    rate, pay, _ = resolve_log_pay(db, current.va_id, body.client_id, hours)
    payable_on = resolve_payable_on(db, current.va_id, body.work_date)

    log = WorkLog(
        work_date=body.work_date,
        va_id=current.va_id,
        client_id=body.client_id,
        sub_client_id=body.sub_client_id,
        project_id=body.project_id,
        task_id=body.task_id,
        description_lexical=body.description_lexical,
        description_plain=body.description_plain,
        entry_mode=mode,
        start_time=start,
        end_time=end,
        hours=hours,
        va_rate=rate,
        va_pay=pay,
        notes=body.notes,
        status=WorkLogStatus.submitted,
        payable_on=payable_on,
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
    from app.services.payroll_calendar import filter_logs_in_pay_period

    rows = q.order_by(TimesheetSubmission.submitted_at.desc()).limit(50).all()
    va = db.query(VA).filter(VA.id == current.va_id).first()
    out = []
    for r in rows:
        logs = filter_logs_in_pay_period(
            db.query(WorkLog).filter(
                WorkLog.va_id == r.va_id,
                WorkLog.status.in_(BILLABLE + [WorkLogStatus.submitted]),
            ),
            r.period_start,
            r.period_end,
        ).all()
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
    from app.services.payroll_calendar import filter_logs_in_pay_period

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
    if existing and existing.status == TimesheetStatus.reviewed:
        raise HTTPException(
            status_code=400,
            detail="This timesheet was already approved and is locked. You cannot resubmit it. "
            "Late entries for dates in this period will roll over to the next payroll.",
        )
    # Also lock if payroll was already marked paid for this exact period
    from app.models import PayrollRun
    if db.query(PayrollRun).filter(
        PayrollRun.va_id == current.va_id,
        PayrollRun.period_start == body.date_from,
        PayrollRun.period_end == body.date_to,
    ).first():
        raise HTTPException(status_code=400, detail="Payroll for this period was already paid — timesheet is locked.")

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

    va = (
        db.query(VA)
        .options(joinedload(VA.user))
        .filter(VA.id == current.va_id)
        .first()
    )
    logs = filter_logs_in_pay_period(
        db.query(WorkLog).filter(
            WorkLog.va_id == current.va_id,
            WorkLog.status.in_(BILLABLE + [WorkLogStatus.submitted]),
        ),
        body.date_from,
        body.date_to,
    ).all()
    hours = sum((l.hours for l in logs), Decimal("0"))
    va_label = (
        (va.user.display_name.strip() if va and va.user and va.user.display_name else "")
        or (va.name if va else "VA")
    )
    # In-app for admin + auditor; email for admins
    push(
        db,
        admin_and_auditor_user_ids(db),
        "log",
        f"📋 Timesheet submitted by {va_label}",
        f"{body.date_from} – {body.date_to} · {hours} hrs · {len(logs)} entries — Pending Approval.",
        "/admin/payroll",
    )
    try:
        send_timesheet_submitted_notification(
            va_label,
            str(body.date_from),
            str(body.date_to),
            str(hours),
            len(logs),
        )
    except Exception:
        pass
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
