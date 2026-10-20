from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import CurrentUser, require_admin, require_admin_or_auditor, require_va
from app.models import ClockStatus, Project, SystemSetting, Task, TaskComment, TaskStatus, TimeClockEntry, WorkLog, WorkLogStatus
from app.schemas import ClockInRequest, ClockOutRequest, TimeClockResponse
from app.services.calculations import calculate_pay
from app.services.notifications import admin_user_ids, push

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


def _serialize(entry: TimeClockEntry) -> TimeClockResponse:
    return TimeClockResponse(
        id=entry.id, va_id=entry.va_id, va_name=entry.va.name if entry.va else None,
        task_id=entry.task_id, task_title=entry.task.title if entry.task else None,
        client_id=entry.client_id, client_name=entry.client.name if entry.client else None,
        project_id=entry.project_id, project_name=entry.project.name if entry.project else None,
        work_log_id=entry.work_log_id, clock_in=_as_utc(entry.clock_in), clock_out=_as_utc(entry.clock_out),
        duration_seconds=entry.duration_seconds, elapsed_seconds=_worked_seconds(entry),
        status=entry.status, notes=entry.notes, created_at=entry.created_at,
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
        rate = _default_rate(db)
        tz = _va_timezone(db, current.va_id)
        clock_in_utc = _as_utc(entry.clock_in)
        local_in = clock_in_utc.astimezone(tz)
        local_out = now.astimezone(tz)
        desc = (body.description or "").strip() or (entry.task.title if entry.task else None) or (body.notes or "").strip() or "Clocked work"
        log = WorkLog(
            work_date=local_in.date(), va_id=current.va_id, client_id=entry.client_id,
            sub_client_id=entry.task.sub_client_id if entry.task else None,
            project_id=entry.project_id, task_id=entry.task_id,
            description_plain=desc, start_time=local_in.time().replace(microsecond=0), end_time=local_out.time().replace(microsecond=0),
            hours=hours, va_rate=rate, va_pay=calculate_pay(hours, rate),
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
    return [_serialize(e) for e in entries]


@router.get("", response_model=list[TimeClockResponse])
def list_all(_: Annotated[CurrentUser, Depends(require_admin_or_auditor)], db: Annotated[Session, Depends(get_db)], va_id: UUID | None = None, limit: int = 100):
    q = db.query(TimeClockEntry).options(joinedload(TimeClockEntry.va), joinedload(TimeClockEntry.task), joinedload(TimeClockEntry.client), joinedload(TimeClockEntry.project))
    if va_id:
        q = q.filter(TimeClockEntry.va_id == va_id)
    return [_serialize(e) for e in q.order_by(TimeClockEntry.clock_in.desc()).limit(min(limit, 300)).all()]


@router.get("/live", response_model=list[TimeClockResponse])
def live_team(_: Annotated[CurrentUser, Depends(require_admin_or_auditor)], db: Annotated[Session, Depends(get_db)]):
    entries = (
        db.query(TimeClockEntry)
        .options(joinedload(TimeClockEntry.va), joinedload(TimeClockEntry.task), joinedload(TimeClockEntry.client), joinedload(TimeClockEntry.project))
        .filter(TimeClockEntry.status.in_([ClockStatus.running, ClockStatus.paused]))
        .order_by(TimeClockEntry.clock_in.asc())
        .all()
    )
    return [_serialize(e) for e in entries]
