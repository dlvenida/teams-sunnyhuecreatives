from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import CurrentUser, get_current_user, require_admin_or_auditor, require_va
from app.models import (
    ActivityLog,
    ClockStatus,
    CorrectionRequestStatus,
    Project,
    SystemSetting,
    Task,
    TaskComment,
    TaskStatus,
    TimeClockAdjustment,
    TimeClockCorrectionRequest,
    TimeClockEntry,
    WorkLog,
    WorkLogStatus,
)
from app.schemas import (
    ClockAdjustRequest,
    ClockCorrectionRequestCreate,
    ClockCorrectionRequestResponse,
    ClockInRequest,
    ClockOutRequest,
    TimeClockAdjustmentResponse,
    TimeClockResponse,
)
from app.services.calculations import calculate_pay
from app.services.notifications import admin_and_auditor_user_ids, admin_user_ids, push

router = APIRouter(prefix="/time-clock", tags=["time-clock"])
DEFAULT_TZ = "Asia/Manila"


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _worked_seconds(entry: TimeClockEntry, now: datetime | None = None) -> int:
    """Seconds actually worked: wall time since clock-in minus all paused time (incl. current pause)."""
    if entry.status == ClockStatus.completed and entry.duration_seconds is not None:
        return entry.duration_seconds
    if not entry.clock_in:
        return 0
    clock_in = _as_utc(entry.clock_in)
    end = _as_utc(entry.paused_at) if entry.status == ClockStatus.paused and entry.paused_at else (now or datetime.now(timezone.utc))
    secs = int((end - clock_in).total_seconds()) - int(entry.total_paused_seconds or 0)
    return max(secs, 0)


def _pending_correction_id(db: Session, entry_id) -> UUID | None:
    row = (
        db.query(TimeClockCorrectionRequest.id)
        .filter(
            TimeClockCorrectionRequest.entry_id == entry_id,
            TimeClockCorrectionRequest.status == CorrectionRequestStatus.pending.value,
        )
        .first()
    )
    return row[0] if row else None


def _serialize(entry: TimeClockEntry, db: Session | None = None) -> TimeClockResponse:
    pending_id = _pending_correction_id(db, entry.id) if db is not None else None
    return TimeClockResponse(
        id=entry.id, va_id=entry.va_id, va_name=entry.va.name if entry.va else None,
        task_id=entry.task_id, task_title=entry.task.title if entry.task else None,
        client_id=entry.client_id, client_name=entry.client.name if entry.client else None,
        project_id=entry.project_id, project_name=entry.project.name if entry.project else None,
        work_log_id=entry.work_log_id, clock_in=_as_utc(entry.clock_in), clock_out=_as_utc(entry.clock_out),
        duration_seconds=entry.duration_seconds, elapsed_seconds=_worked_seconds(entry),
        status=entry.status, notes=entry.notes,
        is_adjusted=bool(getattr(entry, "is_adjusted", False)), adjustment_count=int(getattr(entry, "adjustment_count", 0) or 0),
        last_adjusted_at=_as_utc(entry.last_adjusted_at) if getattr(entry, "last_adjusted_at", None) else None,
        last_adjustment_reason=getattr(entry, "last_adjustment_reason", None),
        original_clock_in=_as_utc(getattr(entry, "original_clock_in", None)),
        original_clock_out=_as_utc(getattr(entry, "original_clock_out", None)),
        last_adjusted_by_name=getattr(entry, "last_adjusted_by_name", None),
        last_adjusted_by_role=getattr(entry, "last_adjusted_by_role", None),
        pending_correction_request_id=pending_id,
        created_at=entry.created_at,
    )


def _serialize_correction(req: TimeClockCorrectionRequest) -> ClockCorrectionRequestResponse:
    entry = req.entry
    return ClockCorrectionRequestResponse(
        id=req.id,
        entry_id=req.entry_id,
        va_id=req.va_id,
        va_name=req.va.name if req.va else None,
        task_title=entry.task.title if entry and entry.task else None,
        client_name=entry.client.name if entry and entry.client else None,
        current_clock_in=_as_utc(entry.clock_in) if entry else None,
        current_clock_out=_as_utc(entry.clock_out) if entry else None,
        proposed_clock_in=_as_utc(req.proposed_clock_in),
        proposed_clock_out=_as_utc(req.proposed_clock_out),
        proposed_notes=req.proposed_notes,
        reason=req.reason,
        status=req.status,
        resolved_by_name=req.resolved_by_name,
        resolved_at=_as_utc(req.resolved_at) if req.resolved_at else None,
        resolution_note=req.resolution_note,
        created_at=req.created_at,
    )


def _load(db: Session, entry_id: UUID):
    return (
        db.query(TimeClockEntry)
        .options(joinedload(TimeClockEntry.va), joinedload(TimeClockEntry.task), joinedload(TimeClockEntry.client), joinedload(TimeClockEntry.project))
        .filter(TimeClockEntry.id == entry_id)
        .first()
    )


def _active_entry(db: Session, va_id: UUID):
    return (
        db.query(TimeClockEntry)
        .options(joinedload(TimeClockEntry.va), joinedload(TimeClockEntry.task), joinedload(TimeClockEntry.client), joinedload(TimeClockEntry.project))
        .filter(TimeClockEntry.va_id == va_id, TimeClockEntry.status.in_([ClockStatus.running, ClockStatus.paused]))
        .order_by(TimeClockEntry.clock_in.desc())
        .first()
    )


def _default_rate(db: Session) -> Decimal:
    row = db.query(SystemSetting).filter(SystemSetting.key == "company").first()
    if row and row.value and row.value.get("default_va_hourly_rate"):
        try:
            return Decimal(str(row.value["default_va_hourly_rate"]))
        except Exception:
            pass
    return Decimal("75.00")


def _va_timezone(db: Session, va_id: UUID) -> ZoneInfo:
    from app.models import VA

    va = db.query(VA).filter(VA.id == va_id).first()
    tz_name = (va.user.timezone if va and va.user and va.user.timezone else None) or DEFAULT_TZ
    try:
        return ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        return ZoneInfo(DEFAULT_TZ)


@router.get("/current", response_model=TimeClockResponse | None)
def current_clock(current: Annotated[CurrentUser, Depends(require_va)], db: Annotated[Session, Depends(get_db)]):
    entry = _active_entry(db, current.va_id)
    return _serialize(entry) if entry else None


@router.post("/clock-in", response_model=TimeClockResponse, status_code=status.HTTP_201_CREATED)
def clock_in(body: ClockInRequest, current: Annotated[CurrentUser, Depends(require_va)], db: Annotated[Session, Depends(get_db)]):
    if _active_entry(db, current.va_id):
        raise HTTPException(400, "You are already clocked in. Clock out first.")
    task = None
    client_id, project_id = body.client_id, body.project_id
    if body.task_id:
        task = db.query(Task).filter(Task.id == body.task_id).first()
        if not task:
            raise HTTPException(404, "Task not found")
        if task.assignee_va_id and task.assignee_va_id != current.va_id:
            raise HTTPException(403, "Task is assigned to another VA")
        client_id = client_id or task.client_id
        project_id = project_id or task.project_id
    if project_id:
        proj = db.query(Project).filter(Project.id == project_id).first()
        if not proj:
            raise HTTPException(404, "Project not found")
        if client_id and proj.client_id != client_id:
            raise HTTPException(400, "Project does not belong to this client")
    entry = TimeClockEntry(va_id=current.va_id, task_id=body.task_id, client_id=client_id, project_id=project_id, clock_in=datetime.now(timezone.utc), status=ClockStatus.running, notes=body.notes)
    db.add(entry)
    if task and task.status == TaskStatus.todo:
        task.status = TaskStatus.in_progress
    db.commit()
    db.refresh(entry)
    loaded = _load(db, entry.id)
    push(db, admin_user_ids(db), "clock", f"⏱️ {loaded.va.name if loaded.va else 'A VA'} clocked in",
         f"{(loaded.task.title if loaded.task else None) or (loaded.client.name if loaded.client else 'General work')}", "/admin/time-clock")
    return _serialize(loaded)


@router.post("/clock-out", response_model=TimeClockResponse)
def clock_out(body: ClockOutRequest, current: Annotated[CurrentUser, Depends(require_va)], db: Annotated[Session, Depends(get_db)]):
    entry = _active_entry(db, current.va_id)
    if not entry:
        raise HTTPException(400, "No active clock session")
    now = datetime.now(timezone.utc)
    duration = _worked_seconds(entry, now)  # correctly excludes paused time, incl. a pause still in progress
    entry.clock_out = now
    entry.duration_seconds = duration
    entry.status = ClockStatus.completed
    entry.paused_at = None
    if body.notes:
        entry.notes = body.notes

    # Optional task comment left at clock-out
    if body.comment and body.comment.strip() and entry.task_id:
        from app.models import VA

        va = db.query(VA).filter(VA.id == current.va_id).first()
        db.add(TaskComment(task_id=entry.task_id, author_user_id=current.user.id, author_name=va.name if va else current.user.email, body=body.comment.strip()))

    # Record as a WorkLog (times converted to the VA's local timezone)
    if body.create_work_log:
        if not entry.client_id:
            db.commit()
            raise HTTPException(400, "This session has no client, so no work log could be created. Clock entry was saved; add a manual log instead.")
        if duration <= 0:
            db.commit()
            raise HTTPException(400, "Session was too short to log. Clock entry was saved.")
        hours = (Decimal(duration) / Decimal(3600)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if hours == 0:
            hours = Decimal("0.01")
        from app.services.va_rates import resolve_log_pay
        from app.services.work_log_overlap import assert_no_time_overlap
        rate, pay, _ = resolve_log_pay(db, current.va_id, entry.client_id, hours)
        tz = _va_timezone(db, current.va_id)
        clock_in_utc = _as_utc(entry.clock_in)
        local_in = clock_in_utc.astimezone(tz)
        local_out = now.astimezone(tz)
        start_t = local_in.time().replace(microsecond=0)
        end_t = local_out.time().replace(microsecond=0)
        assert_no_time_overlap(
            db,
            va_id=current.va_id,
            work_date=local_in.date(),
            start_time=start_t,
            end_time=end_t,
        )
        desc = (body.description or "").strip() or (entry.task.title if entry.task else None) or (body.notes or "").strip() or "Clocked work"
        log = WorkLog(
            work_date=local_in.date(), va_id=current.va_id, client_id=entry.client_id,
            sub_client_id=entry.task.sub_client_id if entry.task else None,
            project_id=entry.project_id, task_id=entry.task_id,
            description_plain=desc, start_time=start_t, end_time=end_t,
            hours=hours, va_rate=rate, va_pay=pay,
            notes=entry.notes, status=WorkLogStatus.submitted, clock_in_at=entry.clock_in, clock_out_at=now, source="clock",
        )
        db.add(log)
        db.flush()
        entry.work_log_id = log.id
    db.commit()
    db.refresh(entry)
    return _serialize(_load(db, entry.id))


@router.post("/pause", response_model=TimeClockResponse)
def pause_clock(current: Annotated[CurrentUser, Depends(require_va)], db: Annotated[Session, Depends(get_db)]):
    entry = db.query(TimeClockEntry).filter(TimeClockEntry.va_id == current.va_id, TimeClockEntry.status == ClockStatus.running).first()
    if not entry:
        raise HTTPException(400, "No running clock to pause")
    entry.status = ClockStatus.paused
    entry.paused_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(entry)
    return _serialize(_load(db, entry.id))


@router.post("/resume", response_model=TimeClockResponse)
def resume_clock(current: Annotated[CurrentUser, Depends(require_va)], db: Annotated[Session, Depends(get_db)]):
    entry = db.query(TimeClockEntry).filter(TimeClockEntry.va_id == current.va_id, TimeClockEntry.status == ClockStatus.paused).first()
    if not entry:
        raise HTTPException(400, "No paused clock to resume")
    now = datetime.now(timezone.utc)
    if entry.paused_at:
        entry.total_paused_seconds = int(entry.total_paused_seconds or 0) + max(int((now - _as_utc(entry.paused_at)).total_seconds()), 0)
    entry.status = ClockStatus.running
    entry.paused_at = None
    db.commit()
    db.refresh(entry)
    return _serialize(_load(db, entry.id))


@router.patch("/{entry_id}", response_model=TimeClockResponse)
def update_entry(entry_id: UUID, body: ClockOutRequest, current: Annotated[CurrentUser, Depends(require_va)], db: Annotated[Session, Depends(get_db)]):
    """VA can annotate a completed clock entry with notes."""
    entry = db.query(TimeClockEntry).filter(TimeClockEntry.id == entry_id, TimeClockEntry.va_id == current.va_id).first()
    if not entry:
        raise HTTPException(404, "Clock entry not found")
    if body.notes is not None:
        entry.notes = body.notes
    db.commit()
    db.refresh(entry)
    return _serialize(_load(db, entry.id))


@router.get("/my-history", response_model=list[TimeClockResponse])
def my_history(current: Annotated[CurrentUser, Depends(require_va)], db: Annotated[Session, Depends(get_db)], limit: int = 50):
    entries = (
        db.query(TimeClockEntry)
        .options(joinedload(TimeClockEntry.va), joinedload(TimeClockEntry.task), joinedload(TimeClockEntry.client), joinedload(TimeClockEntry.project))
        .filter(TimeClockEntry.va_id == current.va_id)
        .order_by(TimeClockEntry.clock_in.desc())
        .limit(min(limit, 200))
        .all()
    )
    return [_serialize(e, db) for e in entries]


def _snapshot(entry: TimeClockEntry) -> dict:
    return {
        "clock_in": _as_utc(entry.clock_in).isoformat() if entry.clock_in else None,
        "clock_out": _as_utc(entry.clock_out).isoformat() if entry.clock_out else None,
        "duration_seconds": entry.duration_seconds, "status": entry.status.value if hasattr(entry.status, "value") else str(entry.status),
        "client_id": str(entry.client_id) if entry.client_id else None, "project_id": str(entry.project_id) if entry.project_id else None,
        "task_id": str(entry.task_id) if entry.task_id else None, "notes": entry.notes,
    }


@router.post("/{entry_id}/correction-request", response_model=ClockCorrectionRequestResponse, status_code=status.HTTP_201_CREATED)
def request_correction(
    entry_id: UUID,
    body: ClockCorrectionRequestCreate,
    current: Annotated[CurrentUser, Depends(require_va)],
    db: Annotated[Session, Depends(get_db)],
):
    """VA requests that admin/auditor revise a mistaken clock-in, clock-out, or date."""
    entry = _load(db, entry_id)
    if not entry or entry.va_id != current.va_id:
        raise HTTPException(404, "Clock entry not found")
    if entry.status != ClockStatus.completed:
        raise HTTPException(400, "Only completed sessions can be revised — clock out first")
    existing = (
        db.query(TimeClockCorrectionRequest)
        .filter(
            TimeClockCorrectionRequest.entry_id == entry_id,
            TimeClockCorrectionRequest.status == CorrectionRequestStatus.pending.value,
        )
        .first()
    )
    if existing:
        raise HTTPException(400, "You already have a pending revision request for this entry")

    proposed_in = _as_utc(body.proposed_clock_in) if body.proposed_clock_in else None
    proposed_out = _as_utc(body.proposed_clock_out) if body.proposed_clock_out else None
    if proposed_in and proposed_out and proposed_out <= proposed_in:
        raise HTTPException(400, "Proposed clock-out must be after clock-in")

    req = TimeClockCorrectionRequest(
        entry_id=entry.id,
        va_id=entry.va_id,
        requested_by_user_id=current.user.id,
        proposed_clock_in=proposed_in,
        proposed_clock_out=proposed_out,
        proposed_notes=body.proposed_notes,
        reason=body.reason.strip(),
        status=CorrectionRequestStatus.pending.value,
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    req = (
        db.query(TimeClockCorrectionRequest)
        .options(
            joinedload(TimeClockCorrectionRequest.va),
            joinedload(TimeClockCorrectionRequest.entry).joinedload(TimeClockEntry.task),
            joinedload(TimeClockCorrectionRequest.entry).joinedload(TimeClockEntry.client),
        )
        .filter(TimeClockCorrectionRequest.id == req.id)
        .first()
    )
    va_name = req.va.name if req.va else "VA"
    push(
        db,
        admin_and_auditor_user_ids(db),
        "clock",
        f"🕒 {va_name} requested a time clock revision",
        f"{body.reason.strip()[:140]} · {req.entry.client.name if req.entry and req.entry.client else 'General'}",
        "/admin/time-clock",
    )
    return _serialize_correction(req)


@router.get("/correction-requests", response_model=list[ClockCorrectionRequestResponse])
def list_correction_requests(
    _: Annotated[CurrentUser, Depends(require_admin_or_auditor)],
    db: Annotated[Session, Depends(get_db)],
    status_filter: str | None = None,
    limit: int = 100,
):
    q = (
        db.query(TimeClockCorrectionRequest)
        .options(
            joinedload(TimeClockCorrectionRequest.va),
            joinedload(TimeClockCorrectionRequest.entry).joinedload(TimeClockEntry.task),
            joinedload(TimeClockCorrectionRequest.entry).joinedload(TimeClockEntry.client),
        )
    )
    if status_filter:
        q = q.filter(TimeClockCorrectionRequest.status == status_filter)
    rows = q.order_by(TimeClockCorrectionRequest.created_at.desc()).limit(min(limit, 300)).all()
    return [_serialize_correction(r) for r in rows]


@router.get("/my-correction-requests", response_model=list[ClockCorrectionRequestResponse])
def my_correction_requests(
    current: Annotated[CurrentUser, Depends(require_va)],
    db: Annotated[Session, Depends(get_db)],
    limit: int = 50,
):
    rows = (
        db.query(TimeClockCorrectionRequest)
        .options(
            joinedload(TimeClockCorrectionRequest.va),
            joinedload(TimeClockCorrectionRequest.entry).joinedload(TimeClockEntry.task),
            joinedload(TimeClockCorrectionRequest.entry).joinedload(TimeClockEntry.client),
        )
        .filter(TimeClockCorrectionRequest.va_id == current.va_id)
        .order_by(TimeClockCorrectionRequest.created_at.desc())
        .limit(min(limit, 100))
        .all()
    )
    return [_serialize_correction(r) for r in rows]


@router.post("/correction-requests/{request_id}/cancel", response_model=ClockCorrectionRequestResponse)
def cancel_correction_request(
    request_id: UUID,
    current: Annotated[CurrentUser, Depends(require_va)],
    db: Annotated[Session, Depends(get_db)],
):
    req = db.query(TimeClockCorrectionRequest).filter(TimeClockCorrectionRequest.id == request_id).first()
    if not req or req.va_id != current.va_id:
        raise HTTPException(404, "Revision request not found")
    if req.status != CorrectionRequestStatus.pending.value:
        raise HTTPException(400, "Only pending requests can be cancelled")
    req.status = CorrectionRequestStatus.cancelled.value
    req.resolved_at = datetime.now(timezone.utc)
    req.resolved_by_name = "Cancelled by VA"
    req.resolution_note = "Cancelled by the VA"
    db.commit()
    req = (
        db.query(TimeClockCorrectionRequest)
        .options(
            joinedload(TimeClockCorrectionRequest.va),
            joinedload(TimeClockCorrectionRequest.entry).joinedload(TimeClockEntry.task),
            joinedload(TimeClockCorrectionRequest.entry).joinedload(TimeClockEntry.client),
        )
        .filter(TimeClockCorrectionRequest.id == request_id)
        .first()
    )
    return _serialize_correction(req)


@router.patch("/{entry_id}/adjust", response_model=TimeClockResponse)
def adjust_entry(
    entry_id: UUID,
    body: ClockAdjustRequest,
    current: Annotated[CurrentUser, Depends(require_admin_or_auditor)],
    db: Annotated[Session, Depends(get_db)],
):
    """Admin or auditor edits a clock entry on behalf of a VA after a revision request (or anytime).

    Freezes the original times on first edit, recalculates duration, syncs the linked work log,
    writes a TimeClockAdjustment audit row, and notifies the VA.
    """
    entry = db.query(TimeClockEntry).filter(TimeClockEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(404, "Clock entry not found")

    linked_log = db.query(WorkLog).filter(WorkLog.id == entry.work_log_id).first() if entry.work_log_id else None
    if linked_log and linked_log.status == WorkLogStatus.invoiced:
        raise HTTPException(400, "This session is already invoiced — it cannot be adjusted")

    before = _snapshot(entry)
    # Freeze original times on first edit so the VA/admin can still see what was recorded
    if not entry.original_clock_in:
        entry.original_clock_in = entry.clock_in
        entry.original_clock_out = entry.clock_out

    new_in = _as_utc(body.clock_in) if body.clock_in else _as_utc(entry.clock_in)
    new_out = _as_utc(body.clock_out) if body.clock_out is not None else _as_utc(entry.clock_out)
    if new_out and new_in and new_out <= new_in:
        raise HTTPException(400, "Clock-out must be after clock-in")
    if entry.status in (ClockStatus.running, ClockStatus.paused) and body.clock_out is not None:
        raise HTTPException(400, "Clock out first, then adjust a completed session — or only adjust the clock-in time")

    now = datetime.now(timezone.utc)
    entry.clock_in = new_in
    if entry.status == ClockStatus.completed:
        entry.clock_out = new_out
        secs = int((new_out - new_in).total_seconds()) - int(entry.total_paused_seconds or 0) if new_out and new_in else 0
        entry.duration_seconds = max(secs, 0)
    if body.notes is not None:
        entry.notes = body.notes
    if body.client_id is not None:
        entry.client_id = body.client_id
    if body.project_id is not None:
        entry.project_id = body.project_id
    if body.task_id is not None:
        entry.task_id = body.task_id

    actor_name = current.user.display_name or current.user.email.split("@")[0]
    entry.is_adjusted = True
    entry.adjustment_count = int(entry.adjustment_count or 0) + 1
    entry.last_adjusted_at = now
    entry.last_adjustment_reason = body.reason.strip()
    entry.last_adjusted_by_name = actor_name
    entry.last_adjusted_by_role = current.user.role.value

    # Sync the linked work log so payroll/reports stay correct
    work_log_synced = False
    log_note = ""
    if linked_log and entry.status == ClockStatus.completed and entry.duration_seconds is not None:
        tz = _va_timezone(db, entry.va_id)
        local_in = _as_utc(entry.clock_in).astimezone(tz)
        local_out = _as_utc(entry.clock_out).astimezone(tz) if entry.clock_out else local_in
        hours = (Decimal(entry.duration_seconds) / Decimal(3600)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if hours == 0:
            hours = Decimal("0.01")
        was_approved = linked_log.status == WorkLogStatus.approved
        linked_log.work_date = local_in.date()
        linked_log.start_time = local_in.time().replace(microsecond=0)
        linked_log.end_time = local_out.time().replace(microsecond=0)
        linked_log.clock_in_at = entry.clock_in
        linked_log.clock_out_at = entry.clock_out
        linked_log.hours = hours
        linked_log.va_pay = calculate_pay(hours, linked_log.va_rate)
        if body.client_id is not None:
            linked_log.client_id = body.client_id
        if was_approved:
            linked_log.status = WorkLogStatus.submitted
            log_note = " Approved log was returned to submitted for re-approval."
        work_log_synced = True

    after = _snapshot(entry)
    adjustment = TimeClockAdjustment(
        entry_id=entry.id, va_id=entry.va_id, adjusted_by_user_id=current.user.id,
        adjusted_by_name=actor_name, adjusted_by_role=current.user.role.value,
        reason=body.reason.strip(), before=before, after=after, work_log_synced=work_log_synced,
    )
    db.add(adjustment)

    # Resolve matching / pending revision request(s) for this entry
    pending_q = db.query(TimeClockCorrectionRequest).filter(
        TimeClockCorrectionRequest.entry_id == entry.id,
        TimeClockCorrectionRequest.status == CorrectionRequestStatus.pending.value,
    )
    if body.correction_request_id:
        pending_q = pending_q.filter(TimeClockCorrectionRequest.id == body.correction_request_id)
    for req in pending_q.all():
        req.status = CorrectionRequestStatus.resolved.value
        req.resolved_by_user_id = current.user.id
        req.resolved_by_name = actor_name
        req.resolved_at = now
        req.resolution_note = body.reason.strip()

    def _fmt(v):
        return v[11:16] + " " + v[:10] if v else "—"
    desc = (
        f"Adjusted time clock ({_fmt(before.get('clock_in'))} → {_fmt(after.get('clock_in'))}"
        f" in, {_fmt(before.get('clock_out'))} → {_fmt(after.get('clock_out'))} out"
        f"{', duration ' + str(before.get('duration_seconds')) + 's → ' + str(after.get('duration_seconds')) + 's' if before.get('duration_seconds') != after.get('duration_seconds') else ''})"
        f" — Reason: {body.reason.strip()}.{log_note}"
    )
    db.add(ActivityLog(user_id=current.user.id, user_name=actor_name, user_role=current.user.role.value,
                       action="adjust", description=desc, path=f"/time-clock/{entry.id}/adjust", method="PATCH"))
    db.commit()
    loaded = _load(db, entry.id)
    # Notify the VA that staff edited their entry
    from app.models import VA as _VA
    va_obj = db.query(_VA).filter(_VA.id == entry.va_id).first()
    if va_obj and va_obj.user_id:
        push(
            db, [va_obj.user_id], "clock",
            f"Your time clock entry was updated by {actor_name}",
            f"{desc}",
            "/va/time-clock",
        )
    return _serialize(loaded, db)


@router.get("/adjustments", response_model=list[TimeClockAdjustmentResponse])
def list_adjustments(_: Annotated[CurrentUser, Depends(require_admin_or_auditor)], db: Annotated[Session, Depends(get_db)], va_id: UUID | None = None, limit: int = 100):
    """Admin/Auditor: every time-clock adjustment, newest first (who, what changed, why)."""
    q = db.query(TimeClockAdjustment).options(joinedload(TimeClockAdjustment.va))
    if va_id:
        q = q.filter(TimeClockAdjustment.va_id == va_id)
    rows = q.order_by(TimeClockAdjustment.created_at.desc()).limit(min(limit, 300)).all()
    out = []
    for r in rows:
        item = TimeClockAdjustmentResponse.model_validate(r)
        item.va_name = r.va.name if r.va else None
        out.append(item)
    return out


@router.get("", response_model=list[TimeClockResponse])
def list_all(_: Annotated[CurrentUser, Depends(require_admin_or_auditor)], db: Annotated[Session, Depends(get_db)], va_id: UUID | None = None, limit: int = 100):
    q = db.query(TimeClockEntry).options(joinedload(TimeClockEntry.va), joinedload(TimeClockEntry.task), joinedload(TimeClockEntry.client), joinedload(TimeClockEntry.project))
    if va_id:
        q = q.filter(TimeClockEntry.va_id == va_id)
    return [_serialize(e, db) for e in q.order_by(TimeClockEntry.clock_in.desc()).limit(min(limit, 300)).all()]


@router.get("/live", response_model=list[TimeClockResponse])
def live_team(_: Annotated[CurrentUser, Depends(require_admin_or_auditor)], db: Annotated[Session, Depends(get_db)]):
    entries = (
        db.query(TimeClockEntry)
        .options(joinedload(TimeClockEntry.va), joinedload(TimeClockEntry.task), joinedload(TimeClockEntry.client), joinedload(TimeClockEntry.project))
        .filter(TimeClockEntry.status.in_([ClockStatus.running, ClockStatus.paused]))
        .order_by(TimeClockEntry.clock_in.asc())
        .all()
    )
    return [_serialize(e, db) for e in entries]
