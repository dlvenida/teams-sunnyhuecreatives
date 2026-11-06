from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import CurrentUser, require_admin, require_admin_or_auditor
from app.models import (
    Currency,
    PayrollRun,
    Project,
    Task,
    TaskStatus,
    TimesheetStatus,
    TimesheetSubmission,
    PackagePeriodOverride,
    PayType,
    RateStatus,
    VA,
    VARate,
    WorkLog,
    WorkLogStatus,
)
from app.schemas import (
    PackageOverrideResponse,
    PackageOverrideUpsert,
    PayrollBreakdown,
    PayrollDay,
    PayrollEntry,
    PayrollRequest,
    PayrollResponse,
    PayrollRunCreate,
    PayrollRunResponse,
    PayrollVAResult,
    TimesheetRejectRequest,
    TimesheetSubmissionResponse,
    WorkLogAttachmentResponse,
)
from app.services.log_display import approval_task_label, log_task_name
from app.services.billing import get_week_period
from app.services.notifications import push, va_user_id
from app.services.payroll_calendar import calendar_half, filter_logs_in_pay_period, period_lookup_keys, snap_payroll_period
from app.services.package_overrides import (
    describe_package_review,
    effective_package_amount,
    include_package_pay,
    load_overrides,
    period_is_paid,
    plan_override,
)
from app.services.pay_access import hide_team_money, may_review_timesheet, pay_notice_path, person_role_label, role_value
from app.services.va_rates import (
    approved_rate_amounts,
    combine_period_pay,
    currency_code,
    get_approved_rate,
    package_amount_for_window,
    package_period_amounts,
    pay_from_approved_rate,
    resolved_frequency,
    MISSING_RATE_NOTE,
)

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
    if body.period in ("first_half", "second_half"):
        # 1st-15th and 16th-end of the current Asia/Manila month. Not snapped:
        # those exact dates are already one bi-weekly half.
        return calendar_half(body.period)
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


@router.post("/calculate", response_model=PayrollResponse, response_model_exclude_none=True)
def calculate_payroll(
    body: PayrollRequest,
    current: Annotated[CurrentUser, Depends(require_admin_or_auditor)],
    db: Annotated[Session, Depends(get_db)],
):
    period_start, period_end = snap_payroll_period(*_period(body))
    span = (period_end - period_start).days + 1
    prev_end = period_start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=span - 1)

    def logs_for(statuses, start, end, va_id=None):
        q = (
            db.query(WorkLog)
            .options(joinedload(WorkLog.va).joinedload(VA.user), joinedload(WorkLog.client), joinedload(WorkLog.project), joinedload(WorkLog.task))
            .filter(WorkLog.status.in_(statuses))
        )
        q = filter_logs_in_pay_period(q, start, end)
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

    window_runs = db.query(PayrollRun).filter(
        PayrollRun.period_start <= period_end,
        PayrollRun.period_end >= period_start,
    ).all()
    runs = {}
    for r in window_runs:
        prev = runs.get(r.va_id)
        if not prev or (r.period_start == period_start and r.period_end == period_end):
            runs[r.va_id] = r
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
    # A Fixed Package is due for the period even when the VA logged nothing.
    package_va_ids = {
        row[0]
        for row in db.query(VARate.va_id)
        .filter(VARate.status == RateStatus.approved, VARate.pay_type == PayType.package)
        .distinct()
        .all()
    }
    if body.va_id:
        package_va_ids = {vid for vid in package_va_ids if vid == body.va_id}
    package_rows_by_va: dict = {}
    for vid in package_va_ids:
        rows = package_period_amounts(db, vid, period_start, period_end)
        if not rows:
            continue
        package_rows_by_va[vid] = rows
        if vid not in va_map:
            va = db.query(VA).options(joinedload(VA.user)).filter(VA.id == vid, VA.is_active.is_(True)).first()
            if va:
                va_map[va.id] = {"va": va, "entries": [], "total_hours": Decimal("0"), "total_pay": Decimal("0")}

    results = []
    total_php = Decimal("0")
    total_usd = Decimal("0")
    redact = hide_team_money(current.role)
    rate_amounts = approved_rate_amounts(db, set(va_map) | {log.va_id for log in prev_logs})
    period_overrides = load_overrides(db, set(va_map), period_start, period_end)
    prev_overrides = load_overrides(db, set(va_map), prev_start, prev_end)
    for va_id, data in va_map.items():
        va = data["va"]
        # Package pay comes from the approved rate for this period, never from logged hours.
        # A saved override can skip a client or replace the amount for this period only.
        package_rows = package_rows_by_va.get(va_id)
        if package_rows is None:
            package_rows = package_period_amounts(db, va_id, period_start, period_end)
        package_lines: list[dict] = []
        package_dues: dict = {}
        for cid, name, calculated, rate_currency in package_rows:
            saved = period_overrides.get((va_id, cid))
            effective, skipped, adjusted = effective_package_amount(
                calculated,
                skipped=bool(saved.skipped) if saved else False,
                amount=saved.amount if saved else None,
                deduction=saved.deduction if saved else None,
            )
            package_dues[cid] = effective
            package_lines.append({
                "client_id": cid,
                "name": name,
                "calculated": calculated,
                "effective": effective,
                "override_amount": saved.amount if saved else None,
                "deduction": saved.deduction if saved else None,
                "skipped": skipped,
                "adjusted": adjusted,
                "note": (saved.note or "").strip() or None if saved else None,
                "currency": rate_currency,
            })
        resolved = {entry.id: pay_from_approved_rate(entry, rate_amounts) for entry in data["entries"]}
        log_pay_by_client: dict = {}
        for entry in data["entries"]:
            _rate, pay = resolved[entry.id]
            log_pay_by_client[entry.client_id] = log_pay_by_client.get(entry.client_id, Decimal("0")) + pay
        data["total_pay"] = combine_period_pay(package_dues, log_pay_by_client)

        entries = [
            PayrollEntry(
                id=e.id, work_date=e.work_date, client_name=e.client.name, description=e.description_plain,
                hours=e.hours,
                rate=None if redact or resolved[e.id][0] is None else resolved[e.id][0],
                pay=None if redact or resolved[e.id][0] is None else resolved[e.id][1],
                rate_missing=True if (not redact and resolved[e.id][0] is None) else None,
                rate_note=MISSING_RATE_NOTE if (not redact and resolved[e.id][0] is None) else None,
                project_name=e.project.name if e.project else None,
                task_title=e.task.title if e.task else None,
                task_name=log_task_name(e),
                source=e.source or "manual", status=str(e.status.value if hasattr(e.status, "value") else e.status),
                entry_mode=getattr(e, "entry_mode", None) or ("duration" if not e.start_time or not e.end_time else "range"),
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
            rate, pay = resolved[l.id]
            b = by_client.setdefault(l.client.name, {
                "hours": Decimal("0"), "pay": Decimal("0"), "client_id": l.client_id,
                "rate": rate, "pay_type": "hourly", "currency": currency_code(va.currency),
                "calculated_pay": None, "skipped": False, "adjusted": False, "note": None,
                "rate_missing": False,
            })
            b["hours"] += l.hours
            if rate is None:
                b["rate_missing"] = True
                b["rate"] = None
            else:
                b["pay"] += pay
                b["rate"] = rate
            daily_map[l.work_date] = daily_map.get(l.work_date, Decimal("0")) + l.hours
        for line in package_lines:
            b = by_client.setdefault(line["name"], {
                "hours": Decimal("0"), "pay": Decimal("0"), "client_id": line["client_id"],
                "rate": line["calculated"], "pay_type": "package", "currency": line["currency"],
                "calculated_pay": line["calculated"], "override_amount": None, "deduction": None, "skipped": False, "adjusted": False, "note": None,
            })
            b["pay"] = line["effective"]
            b["rate"] = line["effective"] if not line["skipped"] else line["calculated"]
            b["pay_type"] = "package"
            b["client_id"] = line["client_id"]
            b["calculated_pay"] = line["calculated"]
            b["override_amount"] = line["override_amount"]
            b["deduction"] = line["deduction"]
            b["skipped"] = line["skipped"]
            b["adjusted"] = line["adjusted"]
            b["note"] = line["note"]
            b["currency"] = line["currency"]
            b["rate_missing"] = False
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
        prev_rows = package_period_amounts(db, va_id, prev_start, prev_end)
        prev_dues = {}
        for cid, _name, calculated, _rate_currency in prev_rows:
            saved = prev_overrides.get((va_id, cid))
            effective, _skipped, _adjusted = effective_package_amount(
                calculated,
                skipped=bool(saved.skipped) if saved else False,
                amount=saved.amount if saved else None,
                deduction=saved.deduction if saved else None,
            )
            prev_dues[cid] = effective
        prev_log_pay: dict = {}
        for entry in va_prev:
            _rate, pay = pay_from_approved_rate(entry, rate_amounts)
            prev_log_pay[entry.client_id] = prev_log_pay.get(entry.client_id, Decimal("0")) + pay
        prev_pay = combine_period_pay(prev_dues, prev_log_pay)
        full_name = (
            (va.user.display_name.strip() if va.user and va.user.display_name else "")
            or va.name
        )
        client_rows = sorted(
            (
                PayrollBreakdown(
                    label=k,
                    hours=v["hours"],
                    pay=None if redact or v.get("rate_missing") else v["pay"],
                    rate=None if redact or v.get("rate_missing") else v.get("rate"),
                    pay_type=None if redact else v.get("pay_type"),
                    client_id=None if redact else v.get("client_id"),
                    calculated_pay=None if redact else v.get("calculated_pay"),
                    override_amount=None if redact else v.get("override_amount"),
                    deduction=None if redact else v.get("deduction"),
                    skipped=None if redact else (v.get("skipped") if v.get("pay_type") == "package" else None),
                    adjusted=None if redact else (v.get("adjusted") if v.get("pay_type") == "package" else None),
                    note=None if redact else v.get("note"),
                    rate_missing=True if (not redact and v.get("rate_missing")) else None,
                    rate_note=MISSING_RATE_NOTE if (not redact and v.get("rate_missing")) else None,
                    currency=None if redact else v.get("currency"),
                )
                for k, v in by_client.items()
            ),
            key=lambda b: b.hours,
            reverse=True,
        )
        owner = getattr(va, "user", None)
        results.append(PayrollVAResult(
            va_id=va.id, va_name=full_name,
            role_label=person_role_label(owner.role) if owner else None,
            currency=va.currency,
            total_hours=data["total_hours"],
            total_pay=None if redact else data["total_pay"],
            entry_count=len(entries), entries=entries,
            pending_hours=sum((l.hours for l in va_pending), Decimal("0")), pending_count=len(va_pending),
            days_worked=len(days),
            avg_hours_per_day=(data["total_hours"] / len(days)).quantize(Decimal("0.01")) if days else Decimal("0"),
            clock_hours=sum((l.hours for l in data["entries"] if (l.source or "manual") == "clock"), Decimal("0")),
            manual_hours=sum((l.hours for l in data["entries"] if (l.source or "manual") != "clock"), Decimal("0")),
            tasks_done=tasks_done,
            by_client=client_rows,
            daily=daily, prev_hours=prev_hours,
            prev_pay=None if redact else prev_pay,
            change_pct=change,
            payment_label=None if redact else _payment_label(va),
            is_paid=run is not None, run_id=run.id if run else None,
            timesheet_submitted=sheet is not None,
            timesheet_status=(sheet.status.value if sheet and hasattr(sheet.status, "value") else (str(sheet.status) if sheet else None)),
            timesheet_id=sheet.id if sheet else None,
            timesheet_period_start=sheet.period_start if sheet else None,
            timesheet_period_end=sheet.period_end if sheet else None,
        ))
        if not redact:
            if va.currency == Currency.PHP:
                total_php += data["total_pay"]
            else:
                total_usd += data["total_pay"]

    results.sort(key=lambda r: r.total_hours, reverse=True)
    return PayrollResponse(
        period_start=period_start, period_end=period_end, vas=results,
        total_php=None if redact else total_php,
        total_usd=None if redact else total_usd,
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
        shown_start, shown_end = snap_payroll_period(row.period_start, row.period_end)
        logs = filter_logs_in_pay_period(
            db.query(WorkLog).filter(
                WorkLog.va_id == row.va_id,
                WorkLog.status.in_(PAYABLE + [WorkLogStatus.submitted]),
            ),
            shown_start,
            shown_end,
        ).all()
        full_name = (
            (row.va.user.display_name.strip() if row.va and row.va.user and row.va.user.display_name else "")
            or (row.va.name if row.va else None)
        )
        out.append(
            TimesheetSubmissionResponse(
                id=row.id,
                va_id=row.va_id,
                va_name=full_name,
                period_start=shown_start,
                period_end=shown_end,
                status=row.status.value if hasattr(row.status, "value") else str(row.status),
                notes=row.notes,
                review_note=row.review_note,
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
            total_pay=r.total_pay, currency=r.currency, method=r.method, notes=r.notes,
            usd_php_rate=r.usd_php_rate, paid_at=r.paid_at,
        ) for r in runs
    ]


def _review_entry(log: WorkLog, include_money: bool = False, amounts=None) -> dict:
    """One log, fully spelled out for the approval screen. Money keys are omitted for Project Managers."""
    project = log.project
    project_client = project.client.name if project is not None and getattr(project, "client", None) is not None else None
    entry = {
        "id": str(log.id),
        "work_date": str(log.work_date),
        "client_name": project_client or (log.client.name if log.client else None),
        "project_name": project.name if project is not None else None,
        "task_title": log.task.title if log.task else None,
        "task_name": approval_task_label(log),
        "description": log.description_plain or "",
        "notes": log.notes or "",
        "entry_mode": getattr(log, "entry_mode", None) or ("duration" if not log.start_time or not log.end_time else "range"),
        "start_time": log.start_time.strftime("%H:%M") if log.start_time else None,
        "end_time": log.end_time.strftime("%H:%M") if log.end_time else None,
        "hours": str(log.hours),
        "source": log.source or "manual",
        "status": log.status.value if hasattr(log.status, "value") else str(log.status),
        "review_reason": getattr(log, "review_reason", None),
        "attachments": [
            WorkLogAttachmentResponse.model_validate(a).model_dump(mode="json")
            for a in (log.attachments or [])
        ],
    }
    if include_money:
        if amounts is None:
            rate, pay = log.va_rate, log.va_pay
        else:
            rate, pay = pay_from_approved_rate(log, amounts)
        entry["va_rate"] = str(rate)
        entry["va_pay"] = str(pay)
    return entry


@router.get("/timesheets/{timesheet_id}/entries")
def timesheet_entries(
    timesheet_id: UUID,
    current: Annotated[CurrentUser, Depends(require_admin_or_auditor)],
    db: Annotated[Session, Depends(get_db)],
    period_start: date | None = None,
    period_end: date | None = None,
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
    shown_start, shown_end = snap_payroll_period(row.period_start, row.period_end)
    pay_start, pay_end = shown_start, shown_end
    if period_start is not None and period_end is not None:
        if period_end < period_start:
            raise HTTPException(400, "period_end must be on or after period_start")
        pay_start, pay_end = snap_payroll_period(period_start, period_end)
    logs = filter_logs_in_pay_period(
        db.query(WorkLog)
        .options(
            joinedload(WorkLog.client),
            joinedload(WorkLog.project).joinedload(Project.client),
            joinedload(WorkLog.task),
            joinedload(WorkLog.attachments),
        )
        .filter(
            WorkLog.va_id == row.va_id,
            WorkLog.status.in_(PAYABLE + [WorkLogStatus.submitted, WorkLogStatus.rejected]),
        ),
        shown_start,
        shown_end,
    ).order_by(WorkLog.work_date, WorkLog.start_time).all()
    redact = hide_team_money(current.role)
    package_pay = None
    if include_package_pay(current.role.value):
        saved = load_overrides(db, {row.va_id}, pay_start, pay_end)
        # A Manila midnight can be stored one day early. Use that row only for the same half.
        if (pay_start, pay_end) == (shown_start, shown_end) and (pay_start, pay_end) != (row.period_start, row.period_end):
            for key, value in load_overrides(db, {row.va_id}, row.period_start, row.period_end).items():
                saved.setdefault(key, value)
        clients = []
        for cid, name, calculated, _rate_currency in package_period_amounts(db, row.va_id, pay_start, pay_end):
            override = saved.get((row.va_id, cid))
            described = describe_package_review(
                calculated,
                skipped=bool(override.skipped) if override else False,
                amount=override.amount if override else None,
                note=override.note if override else None,
                deduction=override.deduction if override else None,
            )
            clients.append({
                "client_id": str(cid),
                "client_name": name,
                "calculated_amount": str(described["calculated_amount"]),
                "amount": str(described["amount"]),
                "deduction": str(described["deduction"]) if described["deduction"] is not None else None,
                "pay_this_period": described["pay_this_period"],
                "reason": described["reason"],
                "adjusted": described["adjusted"],
            })
        if clients:
            currency = row.va.currency.value if row.va and hasattr(row.va.currency, "value") else "PHP"
            package_pay = {
                "locked": period_is_paid(db, row.va_id, pay_start, pay_end) or period_is_paid(db, row.va_id, row.period_start, row.period_end),
                "currency": currency,
                "period_start": pay_start.isoformat(),
                "period_end": pay_end.isoformat(),
                "clients": clients,
            }
    full_name = (
        (row.va.user.display_name.strip() if row.va and row.va.user and row.va.user.display_name else "")
        or (row.va.name if row.va else None)
    )
    amounts = None if redact else approved_rate_amounts(db, [row.va_id])
    return {
        "timesheet": TimesheetSubmissionResponse(
            id=row.id,
            va_id=row.va_id,
            va_name=full_name,
            period_start=shown_start,
            period_end=shown_end,
            status=row.status.value if hasattr(row.status, "value") else str(row.status),
            notes=row.notes,
            review_note=row.review_note,
            submitted_at=row.submitted_at,
            reviewed_at=row.reviewed_at,
            entry_count=len(logs),
            total_hours=sum((l.hours for l in logs), Decimal("0")),
        ),
        "entries": [
            _review_entry(l, include_money=not redact, amounts=amounts)
            for l in logs
        ],
        **({"package_pay": package_pay} if package_pay else {}),
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
    owner_id = row.va.user_id if row.va else None
    if not may_review_timesheet(current.role, current.user.id, owner_id):
        raise HTTPException(403, "A Project Manager cannot approve her own timesheet. An Admin has to do that.")
    row.status = TimesheetStatus.reviewed
    row.review_note = None
    row.reviewed_at = datetime.now(timezone.utc)
    row.reviewed_by = current.user.id
    db.commit()
    db.refresh(row)
    _notify_timesheet_va(db, row, current, approved=True, note=None)
    return _sheet_response(db, row)


def _sheet_response(db: Session, row: TimesheetSubmission) -> TimesheetSubmissionResponse:
    shown_start, shown_end = snap_payroll_period(row.period_start, row.period_end)
    logs = filter_logs_in_pay_period(
        db.query(WorkLog).filter(
            WorkLog.va_id == row.va_id,
            WorkLog.status.in_(PAYABLE + [WorkLogStatus.submitted]),
        ),
        shown_start,
        shown_end,
    ).all()
    full_name = (
        (row.va.user.display_name.strip() if row.va and row.va.user and row.va.user.display_name else "")
        or (row.va.name if row.va else None)
    )
    status_val = row.status.value if hasattr(row.status, "value") else str(row.status)
    return TimesheetSubmissionResponse(
        id=row.id,
        va_id=row.va_id,
        va_name=full_name,
        period_start=shown_start,
        period_end=shown_end,
        status=status_val,
        notes=row.notes,
        review_note=row.review_note,
        submitted_at=row.submitted_at,
        reviewed_at=row.reviewed_at,
        entry_count=len(logs),
        total_hours=sum((l.hours for l in logs), Decimal("0")),
    )


@router.post("/timesheets/{timesheet_id}/reject", response_model=TimesheetSubmissionResponse)
def reject_timesheet(
    timesheet_id: UUID,
    body: TimesheetRejectRequest,
    current: Annotated[CurrentUser, Depends(require_admin_or_auditor)],
    db: Annotated[Session, Depends(get_db)],
):
    """Send a submitted (or approved-but-unpaid) timesheet back to the VA. No pay fields involved."""
    row = (
        db.query(TimesheetSubmission)
        .options(joinedload(TimesheetSubmission.va).joinedload(VA.user))
        .filter(TimesheetSubmission.id == timesheet_id)
        .first()
    )
    if not row:
        raise HTTPException(404, "Timesheet not found")
    owner_id = row.va.user_id if row.va else None
    if not may_review_timesheet(current.role, current.user.id, owner_id):
        raise HTTPException(403, "A Project Manager cannot reject her own timesheet. An Admin has to do that.")
    paid = db.query(PayrollRun).filter(
        PayrollRun.va_id == row.va_id,
        PayrollRun.period_start == row.period_start,
        PayrollRun.period_end == row.period_end,
    ).first()
    if paid:
        raise HTTPException(400, "This period is already marked paid — the timesheet can no longer be rejected")
    reason = (body.reason or "").strip() or None
    row.status = TimesheetStatus.rejected
    row.review_note = reason
    row.reviewed_at = datetime.now(timezone.utc)
    row.reviewed_by = current.user.id
    db.commit()
    db.refresh(row)
    _notify_timesheet_va(db, row, current, approved=False, note=reason)
    return _sheet_response(db, row)


def _notify_timesheet_va(db: Session, row: TimesheetSubmission, current: CurrentUser, *, approved: bool, note: str | None) -> None:
    """Tell the VA in the app and by email. No pay amounts."""
    from app.config import settings as app_settings
    from app.services.notification_mail import send_notification_email
    from app.services.notifications import first_name_of

    reviewer = first_name_of(current.user)
    title = f"{reviewer} approved your timesheet" if approved else f"{reviewer} rejected your timesheet"
    shown_start, shown_end = snap_payroll_period(row.period_start, row.period_end)
    lines = [f"{shown_start} to {shown_end}."]
    if note:
        lines.append(note)
    elif not approved:
        lines.append("Update the entries and resubmit.")
    user = row.va.user if row.va and getattr(row.va, "user", None) else None
    uid = user.id if user else va_user_id(db, row.va_id)
    if uid and uid == current.user.id:
        return
    event = "timesheet_approved" if approved else "timesheet_rejected"
    link = pay_notice_path(user.role if user else "va")
    push(db, [uid], "log", title, " ".join(lines), link, event_key=event)
    if user and user.email:
        try:
            from app.services.notification_prefs import va_channel_enabled
            if va_channel_enabled(user, event, "email"):
                send_notification_email(
                    user.email,
                    title,
                    title,
                    lines,
                    f"{app_settings.app_url.rstrip('/')}{link}",
                    "Open your timesheets",
                    event,
                )
        except Exception:
            pass


@router.put("/package-overrides", response_model=PackageOverrideResponse)
def upsert_package_override(
    body: PackageOverrideUpsert,
    current: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """Skip or replace one Fixed Package for this payroll period. The VA Rate is not changed."""
    if body.period_end < body.period_start:
        raise HTTPException(status_code=400, detail="period_end must be on or after period_start")
    raw_start, raw_end = body.period_start, body.period_end
    body.period_start, body.period_end = snap_payroll_period(raw_start, raw_end)
    if period_is_paid(db, body.va_id, body.period_start, body.period_end) or period_is_paid(db, body.va_id, raw_start, raw_end):
        raise HTTPException(
            status_code=400,
            detail="This period is already marked paid. Undo Paid before changing the package.",
        )
    rate = get_approved_rate(db, body.va_id, body.client_id)
    if not rate or rate.pay_type != PayType.package:
        raise HTTPException(status_code=400, detail="This client does not have an approved Fixed Package for this VA")
    calculated = package_amount_for_window(rate.amount, resolved_frequency(rate), body.period_start, body.period_end)
    try:
        plan = plan_override(
            calculated, skipped=body.skipped, amount=body.amount, note=body.note, deduction=body.deduction,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    existing = (
        db.query(PackagePeriodOverride)
        .filter(
            PackagePeriodOverride.va_id == body.va_id,
            PackagePeriodOverride.client_id == body.client_id,
            PackagePeriodOverride.period_start == body.period_start,
            PackagePeriodOverride.period_end == body.period_end,
        )
        .first()
    )
    if existing is None and (raw_start, raw_end) != (body.period_start, body.period_end):
        existing = (
            db.query(PackagePeriodOverride)
            .filter(
                PackagePeriodOverride.va_id == body.va_id,
                PackagePeriodOverride.client_id == body.client_id,
                PackagePeriodOverride.period_start == raw_start,
                PackagePeriodOverride.period_end == raw_end,
            )
            .first()
        )
        if existing:
            existing.period_start = body.period_start
            existing.period_end = body.period_end
    if plan.action == "delete":
        if existing:
            db.delete(existing)
            db.commit()
        effective, skipped, adjusted = effective_package_amount(calculated)
        return PackageOverrideResponse(
            va_id=body.va_id,
            client_id=body.client_id,
            period_start=body.period_start,
            period_end=body.period_end,
            skipped=skipped,
            amount=None,
            deduction=None,
            calculated_amount=calculated,
            effective_amount=effective,
            adjusted=adjusted,
            note=None,
            locked=False,
        )
    if existing:
        existing.skipped = plan.skipped
        existing.amount = plan.amount
        existing.deduction = plan.deduction
        existing.note = plan.note
        row = existing
    else:
        row = PackagePeriodOverride(
            va_id=body.va_id,
            client_id=body.client_id,
            period_start=body.period_start,
            period_end=body.period_end,
            skipped=plan.skipped,
            amount=plan.amount,
            deduction=plan.deduction,
            note=plan.note,
            created_by=current.user.id,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    effective, skipped, adjusted = effective_package_amount(
        calculated, skipped=row.skipped, amount=row.amount, deduction=row.deduction,
    )
    return PackageOverrideResponse(
        va_id=row.va_id,
        client_id=row.client_id,
        period_start=row.period_start,
        period_end=row.period_end,
        skipped=skipped,
        amount=row.amount,
        deduction=row.deduction,
        calculated_amount=calculated,
        effective_amount=effective,
        adjusted=adjusted,
        note=row.note,
        locked=False,
    )


@router.post("/runs", response_model=PayrollRunResponse, status_code=status.HTTP_201_CREATED)
def mark_paid(
    body: PayrollRunCreate,
    current: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    body.period_start, body.period_end = snap_payroll_period(body.period_start, body.period_end)
    keys = period_lookup_keys(body.period_start, body.period_end)
    sheet = (
        db.query(TimesheetSubmission)
        .filter(
            TimesheetSubmission.va_id == body.va_id,
            or_(*[
                and_(TimesheetSubmission.period_start == start, TimesheetSubmission.period_end == end)
                for start, end in keys
            ]),
        )
        .first()
    )
    if not sheet:
        sheet = (
            db.query(TimesheetSubmission)
            .filter(
                TimesheetSubmission.va_id == body.va_id,
                TimesheetSubmission.period_start <= body.period_end,
                TimesheetSubmission.period_end >= body.period_start,
                TimesheetSubmission.status == TimesheetStatus.reviewed,
            )
            .order_by(TimesheetSubmission.reviewed_at.desc())
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
        method=body.method, notes=body.notes, usd_php_rate=body.usd_php_rate,
        created_by=current.user.id,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    va = db.query(VA).options(joinedload(VA.user)).filter(VA.id == body.va_id).first()
    owner = va.user if va and getattr(va, "user", None) else None
    paid_link = pay_notice_path(owner.role) if owner and role_value(owner.role) == "auditor" else "/va/time-log"
    push(db, [va_user_id(db, body.va_id)], "log", "💸 Payroll sent for your work",
         f"{body.period_start} – {body.period_end} · {body.total_hours} hrs{(' via ' + body.method) if body.method else ''}. Thank you!", paid_link)
    return PayrollRunResponse(
        id=run.id, va_id=run.va_id, va_name=va.name if va else None,
        period_start=run.period_start, period_end=run.period_end, total_hours=run.total_hours,
        total_pay=run.total_pay, currency=run.currency, method=run.method, notes=run.notes,
        usd_php_rate=run.usd_php_rate, paid_at=run.paid_at,
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
