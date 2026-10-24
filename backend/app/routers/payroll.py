from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import CurrentUser, require_admin, require_admin_or_auditor
from app.models import (
    Currency,
    PayrollRun,
    Task,
    TaskStatus,
    TimesheetStatus,
    TimesheetSubmission,
    UserRole,
    VA,
    WorkLog,
    WorkLogStatus,
)
from app.schemas import (
    PayrollBreakdown,
    PayrollDay,
    PayrollEntry,
    PayrollRequest,
    PayrollResponse,
    PayrollRunCreate,
    PayrollRunResponse,
    PayrollVAResult,
    TimesheetSubmissionResponse,
    WorkLogAttachmentResponse,
)
from app.services.billing import get_week_period
from app.services.notifications import push, va_user_id
from app.services.va_rates import package_flats_for_period

router = APIRouter(prefix="/payroll", tags=["payroll"])

PAYABLE = [WorkLogStatus.approved, WorkLogStatus.invoiced]


def _period(body: PayrollRequest) -> tuple[date, date]:
    if body.period == "custom" and body.date_from and body.date_to:
        return body.date_from, body.date_to
    if body.period == "last_week":
        return get_week_period("last_week")
    if body.period in ("this_month", "last_month"):
        t = date.today()
        y, m = (t.year, t.month) if body.period == "this_month" else ((t.year - 1, 12) if t.month == 1 else (t.year, t.month - 1))
        return date(y, m, 1), date(y, m, monthrange(y, m)[1])
    return get_week_period("this_week")


def _payment_label(va: VA) -> str | None:
    u = getattr(va, "user", None)
    if not u:
        return None
    if u.wise_email:
        return f"Wise · {u.wise_email}"
    if u.ph_bank_name or u.ph_bank_account:
        return f"{u.ph_bank_name or 'PH bank'} · {u.ph_bank_account_name or ''} {u.ph_bank_account or ''}".strip()
    return None


@router.post("/calculate", response_model=PayrollResponse)
def calculate_payroll(
    body: PayrollRequest,
    current: Annotated[CurrentUser, Depends(require_admin_or_auditor)],
    db: Annotated[Session, Depends(get_db)],
):
    period_start, period_end = _period(body)
    span = (period_end - period_start).days + 1
    prev_end = period_start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=span - 1)

    def logs_for(statuses, start, end, va_id=None):
        q = (
            db.query(WorkLog)
            .options(joinedload(WorkLog.va).joinedload(VA.user), joinedload(WorkLog.client), joinedload(WorkLog.project), joinedload(WorkLog.task))
            .filter(WorkLog.status.in_(statuses), WorkLog.work_date >= start, WorkLog.work_date <= end)
        )
        if va_id:
            q = q.filter(WorkLog.va_id == va_id)
        return q.order_by(WorkLog.va_id, WorkLog.work_date).all()

    logs = logs_for(PAYABLE, period_start, period_end, body.va_id)
    pending = logs_for([WorkLogStatus.submitted], period_start, period_end, body.va_id)
    prev_logs = logs_for(PAYABLE, prev_start, prev_end, body.va_id)

    va_map: dict = {}
    for log in logs:
        d = va_map.setdefault(log.va_id, {"va": log.va, "entries": [], "total_hours": Decimal("0"), "total_pay": Decimal("0")})
        d["entries"].append(log)
        d["total_hours"] += log.hours
        d["total_pay"] += log.va_pay
    # VAs with only pending work still show up so admin sees what's blocked
    for log in pending:
        va_map.setdefault(log.va_id, {"va": log.va, "entries": [], "total_hours": Decimal("0"), "total_pay": Decimal("0")})

    runs = {
        r.va_id: r for r in db.query(PayrollRun).filter(PayrollRun.period_start == period_start, PayrollRun.period_end == period_end).all()
    }
    # Match timesheets that overlap the selected payroll window (not only exact dates),
    # so a VA submit for Oct 1–15 still appears when admin views a nearby custom range.
    overlapping_sheets = (
        db.query(TimesheetSubmission)
        .options(joinedload(TimesheetSubmission.va).joinedload(VA.user))
        .filter(
            TimesheetSubmission.period_start <= period_end,
            TimesheetSubmission.period_end >= period_start,
        )
        .all()
    )
    if body.va_id:
        overlapping_sheets = [t for t in overlapping_sheets if t.va_id == body.va_id]
    sheets: dict = {}
    for t in overlapping_sheets:
        prev = sheets.get(t.va_id)
        # Prefer exact period match, then newest submission
        if not prev:
            sheets[t.va_id] = t
        elif t.period_start == period_start and t.period_end == period_end:
            sheets[t.va_id] = t
        elif prev.period_start != period_start or prev.period_end != period_end:
            if (t.submitted_at or t.period_start) >= (prev.submitted_at or prev.period_start):
                sheets[t.va_id] = t
    # Ensure VAs who submitted a timesheet appear even with zero payable logs yet
    for t in sheets.values():
        if t.va_id not in va_map and t.va:
            va_map[t.va_id] = {"va": t.va, "entries": [], "total_hours": Decimal("0"), "total_pay": Decimal("0")}

    results = []
    total_php = Decimal("0")
    total_usd = Decimal("0")
    for va_id, data in va_map.items():
        va = data["va"]
        # Add package flat amounts once per client that has approved package rate + hours in period
        client_ids = {e.client_id for e in data["entries"]}
        flats = package_flats_for_period(db, va_id, client_ids)
        package_total = sum(flats.values(), Decimal("0"))
        data["total_pay"] = data["total_pay"] + package_total

        redact = current.role == UserRole.auditor
        entries = [
            PayrollEntry(
                id=e.id, work_date=e.work_date, client_name=e.client.name, description=e.description_plain,
                hours=e.hours,
                rate=Decimal("0") if redact else e.va_rate,
                pay=Decimal("0") if redact else e.va_pay,
                project_name=e.project.name if e.project else None,
                task_title=e.task.title if e.task else None,
                source=e.source or "manual", status=str(e.status.value if hasattr(e.status, "value") else e.status),
                start_time=e.start_time.strftime("%H:%M") if e.start_time else None,
                end_time=e.end_time.strftime("%H:%M") if e.end_time else None,
            ) for e in data["entries"]
        ]
        va_pending = [l for l in pending if l.va_id == va_id]
        va_prev = [l for l in prev_logs if l.va_id == va_id]
        prev_hours = sum((l.hours for l in va_prev), Decimal("0"))
        days = {l.work_date for l in data["entries"]}
        by_client: dict[str, dict] = {}
        daily_map: dict[date, Decimal] = {}
        for l in data["entries"]:
            b = by_client.setdefault(l.client.name, {"hours": Decimal("0"), "pay": Decimal("0"), "client_id": l.client_id})
            b["hours"] += l.hours
            b["pay"] += l.va_pay
            daily_map[l.work_date] = daily_map.get(l.work_date, Decimal("0")) + l.hours
        for cid, flat in flats.items():
            for b in by_client.values():
                if b.get("client_id") == cid:
                    b["pay"] = flat
        daily = []
        d = period_start
        while d <= period_end:
            daily.append(PayrollDay(work_date=d, hours=daily_map.get(d, Decimal("0"))))
            d += timedelta(days=1)
        tasks_done = (
            db.query(Task).filter(
                Task.assignee_va_id == va_id, Task.status == TaskStatus.done,
                Task.completed_at >= period_start, Task.completed_at < period_end + timedelta(days=1),
            ).count()
        )
        run = runs.get(va_id)
        sheet = sheets.get(va_id)
        change = float((data["total_hours"] - prev_hours) / prev_hours * 100) if prev_hours > 0 else None
        prev_client_ids = {l.client_id for l in va_prev}
        prev_flats = package_flats_for_period(db, va_id, prev_client_ids)
        prev_pay = sum((l.va_pay for l in va_prev), Decimal("0")) + sum(prev_flats.values(), Decimal("0"))
        full_name = (
            (va.user.display_name.strip() if va.user and va.user.display_name else "")
            or va.name
        )
        client_rows = sorted(
            (
                PayrollBreakdown(
                    label=k,
                    hours=v["hours"],
                    pay=Decimal("0") if redact else v["pay"],
                )
                for k, v in by_client.items()
            ),
            key=lambda b: b.hours,
            reverse=True,
        )
        results.append(PayrollVAResult(
            va_id=va.id, va_name=full_name, currency=va.currency,
            total_hours=data["total_hours"],
            total_pay=Decimal("0") if redact else data["total_pay"],
            entry_count=len(entries), entries=entries,
            pending_hours=sum((l.hours for l in va_pending), Decimal("0")), pending_count=len(va_pending),
            days_worked=len(days),
            avg_hours_per_day=(data["total_hours"] / len(days)).quantize(Decimal("0.01")) if days else Decimal("0"),
            clock_hours=sum((l.hours for l in data["entries"] if (l.source or "manual") == "clock"), Decimal("0")),
            manual_hours=sum((l.hours for l in data["entries"] if (l.source or "manual") != "clock"), Decimal("0")),
            tasks_done=tasks_done,
            by_client=client_rows,
            daily=daily, prev_hours=prev_hours,
            prev_pay=Decimal("0") if redact else prev_pay,
            change_pct=change,
            payment_label=None if redact else _payment_label(va),
            is_paid=run is not None, run_id=run.id if run else None,
            timesheet_submitted=sheet is not None,
            timesheet_status=(sheet.status.value if sheet and hasattr(sheet.status, "value") else (str(sheet.status) if sheet else None)),
            timesheet_id=sheet.id if sheet else None,
        ))
        if not redact:
            if va.currency == Currency.PHP:
                total_php += data["total_pay"]
            else:
                total_usd += data["total_pay"]

    results.sort(key=lambda r: r.total_hours, reverse=True)
    return PayrollResponse(
        period_start=period_start, period_end=period_end, vas=results,
        total_php=total_php, total_usd=total_usd,
        total_hours=sum((r.total_hours for r in results), Decimal("0")),
        total_pending_hours=sum((r.pending_hours for r in results), Decimal("0")),
    )


@router.get("/timesheets", response_model=list[TimesheetSubmissionResponse])
def list_timesheets(
    current: Annotated[CurrentUser, Depends(require_admin_or_auditor)],
    db: Annotated[Session, Depends(get_db)],
    status_filter: str | None = None,
    limit: int = 50,
):
    """Pending (and recent) timesheet submissions for the VA Payroll inbox."""
    q = (
        db.query(TimesheetSubmission)
        .options(joinedload(TimesheetSubmission.va).joinedload(VA.user))
        .order_by(TimesheetSubmission.submitted_at.desc())
    )
    if status_filter:
        try:
            q = q.filter(TimesheetSubmission.status == TimesheetStatus(status_filter))
        except ValueError:
            raise HTTPException(400, "Invalid timesheet status")
    rows = q.limit(min(limit, 100)).all()
    out: list[TimesheetSubmissionResponse] = []
    for row in rows:
        logs = (
            db.query(WorkLog)
            .filter(
                WorkLog.va_id == row.va_id,
                WorkLog.work_date >= row.period_start,
                WorkLog.work_date <= row.period_end,
                WorkLog.status.in_(PAYABLE + [WorkLogStatus.submitted]),
            )
            .all()
        )
        full_name = (
            (row.va.user.display_name.strip() if row.va and row.va.user and row.va.user.display_name else "")
            or (row.va.name if row.va else None)
        )
        out.append(
            TimesheetSubmissionResponse(
                id=row.id,
                va_id=row.va_id,
                va_name=full_name,
                period_start=row.period_start,
                period_end=row.period_end,
                status=row.status.value if hasattr(row.status, "value") else str(row.status),
                notes=row.notes,
                submitted_at=row.submitted_at,
                reviewed_at=row.reviewed_at,
                entry_count=len(logs),
                total_hours=sum((l.hours for l in logs), Decimal("0")),
            )
        )
    return out


@router.get("/runs", response_model=list[PayrollRunResponse])
def list_runs(
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    limit: int = 50,
):
    runs = db.query(PayrollRun).options(joinedload(PayrollRun.va)).order_by(PayrollRun.paid_at.desc()).limit(min(limit, 200)).all()
    return [
        PayrollRunResponse(
            id=r.id, va_id=r.va_id, va_name=r.va.name if r.va else None,
            period_start=r.period_start, period_end=r.period_end, total_hours=r.total_hours,
            total_pay=r.total_pay, currency=r.currency, method=r.method, notes=r.notes, paid_at=r.paid_at,
        ) for r in runs
    ]


@router.get("/timesheets/{timesheet_id}/entries")
def timesheet_entries(
    timesheet_id: UUID,
    current: Annotated[CurrentUser, Depends(require_admin_or_auditor)],
    db: Annotated[Session, Depends(get_db)],
):
    """Full time-log detail + attachment metadata for Timesheet Review."""
    row = (
        db.query(TimesheetSubmission)
        .options(joinedload(TimesheetSubmission.va).joinedload(VA.user))
        .filter(TimesheetSubmission.id == timesheet_id)
        .first()
    )
    if not row:
        raise HTTPException(404, "Timesheet not found")
    logs = (
        db.query(WorkLog)
        .options(
            joinedload(WorkLog.client),
            joinedload(WorkLog.project),
            joinedload(WorkLog.task),
            joinedload(WorkLog.attachments),
        )
        .filter(
            WorkLog.va_id == row.va_id,
            WorkLog.work_date >= row.period_start,
            WorkLog.work_date <= row.period_end,
            WorkLog.status.in_(PAYABLE + [WorkLogStatus.submitted]),
        )
        .order_by(WorkLog.work_date, WorkLog.start_time)
        .all()
    )
    redact = current.role == UserRole.auditor
    full_name = (
        (row.va.user.display_name.strip() if row.va and row.va.user and row.va.user.display_name else "")
        or (row.va.name if row.va else None)
    )
    return {
        "timesheet": TimesheetSubmissionResponse(
            id=row.id,
            va_id=row.va_id,
            va_name=full_name,
            period_start=row.period_start,
            period_end=row.period_end,
            status=row.status.value if hasattr(row.status, "value") else str(row.status),
            notes=row.notes,
            submitted_at=row.submitted_at,
            reviewed_at=row.reviewed_at,
            entry_count=len(logs),
            total_hours=sum((l.hours for l in logs), Decimal("0")),
        ),
        "entries": [
            {
                "id": str(l.id),
                "work_date": str(l.work_date),
                "client_name": l.client.name if l.client else None,
                "project_name": l.project.name if l.project else None,
                "task_title": l.task.title if l.task else None,
                "description": l.description_plain,
                "notes": l.notes,
                "start_time": l.start_time.strftime("%H:%M") if l.start_time else None,
                "end_time": l.end_time.strftime("%H:%M") if l.end_time else None,
                "hours": str(l.hours),
                "source": l.source or "manual",
                "status": l.status.value if hasattr(l.status, "value") else str(l.status),
                "va_rate": None if redact else str(l.va_rate),
                "va_pay": None if redact else str(l.va_pay),
                "attachments": [
                    WorkLogAttachmentResponse.model_validate(a).model_dump(mode="json")
                    for a in (l.attachments or [])
                ],
            }
            for l in logs
        ],
    }


@router.post("/timesheets/{timesheet_id}/review", response_model=TimesheetSubmissionResponse)
def review_timesheet(
    timesheet_id: UUID,
    current: Annotated[CurrentUser, Depends(require_admin_or_auditor)],
    db: Annotated[Session, Depends(get_db)],
):
    row = (
        db.query(TimesheetSubmission)
        .options(joinedload(TimesheetSubmission.va).joinedload(VA.user))
        .filter(TimesheetSubmission.id == timesheet_id)
        .first()
    )
    if not row:
        raise HTTPException(404, "Timesheet not found")
    row.status = TimesheetStatus.reviewed
    row.reviewed_at = datetime.now(timezone.utc)
    row.reviewed_by = current.user.id
    db.commit()
    db.refresh(row)
    logs = (
        db.query(WorkLog)
        .filter(
            WorkLog.va_id == row.va_id,
            WorkLog.work_date >= row.period_start,
            WorkLog.work_date <= row.period_end,
            WorkLog.status.in_(PAYABLE + [WorkLogStatus.submitted]),
        )
        .all()
    )
    full_name = (
        (row.va.user.display_name.strip() if row.va and row.va.user and row.va.user.display_name else "")
        or (row.va.name if row.va else None)
    )
    return TimesheetSubmissionResponse(
        id=row.id,
        va_id=row.va_id,
        va_name=full_name,
        period_start=row.period_start,
        period_end=row.period_end,
        status=row.status.value,
        notes=row.notes,
        submitted_at=row.submitted_at,
        reviewed_at=row.reviewed_at,
        entry_count=len(logs),
        total_hours=sum((l.hours for l in logs), Decimal("0")),
    )


@router.post("/runs", response_model=PayrollRunResponse, status_code=status.HTTP_201_CREATED)
def mark_paid(
    body: PayrollRunCreate,
    current: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    sheet = (
        db.query(TimesheetSubmission)
        .filter(
            TimesheetSubmission.va_id == body.va_id,
            TimesheetSubmission.period_start == body.period_start,
            TimesheetSubmission.period_end == body.period_end,
        )
        .first()
    )
    if not sheet:
        raise HTTPException(
            400,
            "VA must submit their timesheet for this period before payroll can be marked paid",
        )
    if sheet.status != TimesheetStatus.reviewed:
        raise HTTPException(
            400,
            "Approve the submitted timesheet in Timesheet Review before marking payroll paid",
        )
    existing = db.query(PayrollRun).filter(
        PayrollRun.va_id == body.va_id, PayrollRun.period_start == body.period_start, PayrollRun.period_end == body.period_end,
    ).first()
    if existing:
        raise HTTPException(400, "This VA is already marked paid for this exact period")
    run = PayrollRun(
        va_id=body.va_id, period_start=body.period_start, period_end=body.period_end,
        total_hours=body.total_hours, total_pay=body.total_pay, currency=body.currency,
        method=body.method, notes=body.notes, created_by=current.user.id,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    va = db.query(VA).options(joinedload(VA.user)).filter(VA.id == body.va_id).first()
    push(db, [va_user_id(db, body.va_id)], "log", "💸 Payroll sent for your work",
         f"{body.period_start} – {body.period_end} · {body.total_hours} hrs{(' via ' + body.method) if body.method else ''}. Thank you!", "/va/time-log")
    return PayrollRunResponse(
        id=run.id, va_id=run.va_id, va_name=va.name if va else None,
        period_start=run.period_start, period_end=run.period_end, total_hours=run.total_hours,
        total_pay=run.total_pay, currency=run.currency, method=run.method, notes=run.notes, paid_at=run.paid_at,
    )


@router.delete("/runs/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
def void_run(
    run_id: UUID,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    run = db.query(PayrollRun).filter(PayrollRun.id == run_id).first()
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll run not found")
    db.delete(run)
    db.commit()
