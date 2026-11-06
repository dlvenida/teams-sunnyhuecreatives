"""Attach screenshot verification to existing engagement tasks.

Does not create Task Board items, and does not change task status, clock-in,
work logs, payroll, or invoices.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from app.models import Client, SystemSetting, Task, TimeClockEntry, UserRole, VA, WorkLog
from app.models.engagement import (
    EngagementActivity,
    EngagementAudit,
    EngagementScreenshot,
    EngagementTarget,
    EngagementVerification,
)
from app.services import storage
from app.services.engagement_access import engagement_subjects, is_manager
from app.services.engagement_extract import extract_from_image, register_image_plugins
from app.services.engagement_rules import (
    category_targets,
    classify_activities,
    manual_override,
    platform_from_title,
    summarize,
    workday_has_ended,
)
from app.services.images import optimize_image
from app.services.payroll_calendar import manila_today

ALLOWED_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/avif",
    "image/gif",
    "image/heic",
    "image/heif",
}
MAX_FILES = 20


def _tz(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "Asia/Manila")
    except ZoneInfoNotFoundError:
        return ZoneInfo("Asia/Manila")


def company_timezone(db: Session) -> str:
    row = db.query(SystemSetting).filter(SystemSetting.key == "company").first()
    if row and isinstance(row.value, dict) and row.value.get("timezone"):
        return str(row.value["timezone"])
    return "Asia/Manila"


def actor_name(db: Session, current) -> str:
    if current.va_id:
        va = db.query(VA).filter(VA.id == current.va_id).first()
        if va and va.name:
            return va.name
    user = current.user
    return user.display_name or user.legal_name or user.email.split("@")[0]


def _subject_va(db: Session, current) -> VA | None:
    from app.services.engagement_access import sync_engagement_subject

    sync_engagement_subject(db)
    if not current.va_id:
        return None
    return (
        db.query(VA)
        .filter(VA.id == current.va_id, VA.engagement_verification.is_(True), VA.is_active.is_(True))
        .first()
    )


def access_payload(db: Session, current) -> dict:
    subject = _subject_va(db, current)
    subjects = engagement_subjects(db)
    primary = subjects[0] if subjects else None
    if subject is not None:
        return {"enabled": True, "scope": "va", "va_id": str(subject.id), "va_name": subject.name}
    if is_manager(current):
        return {
            "enabled": True,
            "scope": "management",
            "va_id": str(primary.id) if primary else None,
            "va_name": primary.name if primary else None,
        }
    return {"enabled": False, "scope": "none", "va_id": None, "va_name": None}


def _require_subject(db: Session, current) -> VA:
    va = _subject_va(db, current)
    if va is None:
        raise HTTPException(403, "Screenshot check is not available for this account.")
    return va


def _require_manager(current) -> None:
    if not is_manager(current):
        raise HTTPException(403, "Admin or Project Manager access required.")


def _can_view_task(db: Session, current, task: Task) -> VA:
    """Return the engagement VA who owns the task, or reject."""
    if not task.assignee_va_id:
        raise HTTPException(404, "Task not found")
    owner = db.query(VA).filter(VA.id == task.assignee_va_id, VA.engagement_verification.is_(True)).first()
    if owner is None or platform_from_title(task.title) is None:
        raise HTTPException(404, "Task not found")
    subject = _subject_va(db, current)
    if subject is not None and subject.id == owner.id:
        return owner
    if is_manager(current):
        return owner
    raise HTTPException(403, "Screenshot check is not available for this account.")


def task_work_date(task: Task) -> date:
    return task.due_date or task.start_date or manila_today()


def _target_row(db: Session, client_id, platform: str) -> EngagementTarget | None:
    return (
        db.query(EngagementTarget)
        .filter(EngagementTarget.client_id == client_id, EngagementTarget.platform == platform)
        .first()
    )


def _target_values(row: EngagementTarget | None) -> dict:
    if row is None:
        return {}
    return {
        "dm_min": row.dm_min,
        "dm_max": row.dm_max,
        "comment_min": row.comment_min,
        "comment_max": row.comment_max,
        "share_min": row.share_min,
        "share_max": row.share_max,
    }


def _client_names(db: Session, task: Task, target: EngagementTarget | None) -> list[str]:
    names = []
    client = task.client or db.query(Client).filter(Client.id == task.client_id).first()
    if client:
        names.append(client.name)
    if task.sub_client and task.sub_client.name:
        names.append(task.sub_client.name)
    if target and target.account_names:
        names.extend([str(name) for name in target.account_names if name])
    return names


def _reporting_tz(db: Session, target: EngagementTarget | None) -> ZoneInfo:
    name = None
    if target and target.reporting_timezone:
        name = target.reporting_timezone
    else:
        name = company_timezone(db)
    return _tz(name)


def _windows(db: Session, va_id, work_date: date, tz: ZoneInfo, task_id, client_id):
    windows = []
    entries = db.query(TimeClockEntry).filter(TimeClockEntry.va_id == va_id).all()
    for entry in entries:
        start = entry.clock_in
        if start is None:
            continue
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        if start.astimezone(tz).date() != work_date:
            continue
        if entry.task_id and entry.task_id != task_id and entry.client_id and entry.client_id != client_id:
            continue
        end = entry.clock_out
        if end is not None and end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        windows.append((start, end))
    logs = (
        db.query(WorkLog)
        .filter(WorkLog.va_id == va_id, WorkLog.work_date == work_date)
        .all()
    )
    for log in logs:
        if log.task_id and log.task_id != task_id and log.client_id != client_id:
            continue
        if log.clock_in_at and log.clock_out_at:
            windows.append((log.clock_in_at, log.clock_out_at))
            continue
        if log.start_time and log.end_time:
            start = datetime.combine(work_date, log.start_time, tzinfo=tz)
            end_day = work_date + timedelta(days=1) if log.end_time <= log.start_time else work_date
            end = datetime.combine(end_day, log.end_time, tzinfo=tz)
            windows.append((start, end))
    return windows


def _time_logged(db: Session, va_id, task_id, client_id, work_date: date, tz: ZoneInfo) -> str:
    seconds = 0
    now = datetime.now(timezone.utc)
    for entry in db.query(TimeClockEntry).filter(TimeClockEntry.va_id == va_id).all():
        if entry.task_id != task_id and entry.client_id != client_id:
            continue
        start = entry.clock_in
        if start is None:
            continue
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        if start.astimezone(tz).date() != work_date:
            continue
        if entry.duration_seconds:
            seconds += int(entry.duration_seconds)
            continue
        end = entry.clock_out or now
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        paused = int(entry.total_paused_seconds or 0)
        seconds += max(0, int((end - start).total_seconds()) - paused)
    if seconds <= 0:
        hours = 0
        for log in db.query(WorkLog).filter(WorkLog.va_id == va_id, WorkLog.work_date == work_date, WorkLog.task_id == task_id).all():
            hours += float(log.hours or 0)
        if hours <= 0:
            return "No time logged"
        whole = int(hours)
        minutes = int(round((hours - whole) * 60))
        return f"{whole}h {minutes:02d}m"
    hours, rem = divmod(seconds, 3600)
    minutes = rem // 60
    return f"{hours}h {minutes:02d}m"


def _ensure(db: Session, task: Task, owner: VA) -> EngagementVerification:
    platform = platform_from_title(task.title)
    if platform is None:
        raise HTTPException(400, "This task is not an Instagram, Facebook, or LinkedIn engagement task.")
    row = db.query(EngagementVerification).filter(EngagementVerification.task_id == task.id).first()
    if row:
        return row
    row = EngagementVerification(
        task_id=task.id,
        va_id=owner.id,
        client_id=task.client_id,
        platform=platform,
        work_date=task_work_date(task),
    )
    db.add(row)
    db.flush()
    return row


def _states(db: Session, verification: EngagementVerification) -> list[dict]:
    shots = {shot.id: shot for shot in verification.screenshots}
    rows = []
    for activity in verification.activities:
        shot = shots.get(activity.screenshot_id)
        rows.append({
            "id": str(activity.id),
            "screenshot_id": str(activity.screenshot_id),
            "order": activity.sort_order,
            "uploaded_at": shot.created_at.isoformat() if shot and shot.created_at else "",
            "activity_type": activity.activity_type,
            "username": activity.username_raw,
            "activity_date": activity.activity_date,
            "activity_time": activity.activity_time,
            "text": activity.body_text,
            "confidence": activity.confidence,
            "platform_hint": activity.platform_hint,
            "account_hint": activity.account_hint,
            "share_evidence": activity.share_evidence,
            "decision": activity.decision,
            "decision_reason": activity.decision_reason,
        })
    return rows


def refresh(db: Session, verification: EngagementVerification, task: Task) -> dict:
    target = _target_row(db, verification.client_id, verification.platform)
    tz = _reporting_tz(db, target)
    now = datetime.now(timezone.utc)
    classified = classify_activities(
        verification.platform,
        _states(db, verification),
        work_date=verification.work_date,
        client_names=_client_names(db, task, target),
        windows=_windows(db, verification.va_id, verification.work_date, tz, task.id, task.client_id),
        tz=tz,
        now=now,
    )
    by_id = {row["id"]: row for row in classified}
    for activity in verification.activities:
        found = by_id.get(str(activity.id))
        if not found:
            continue
        activity.status = found["status"]
        activity.counted = bool(found["counted"])
        activity.alerts = found.get("alerts") or []
        activity.explanation = found.get("explanation")
        activity.username_key = found.get("username_key")
        activity.activity_type = found["activity_type"]
        if activity.original_result is None:
            activity.original_result = {
                "status": activity.status,
                "counted": activity.counted,
                "alerts": activity.alerts,
                "explanation": activity.explanation,
            }
    unclear = []
    for shot in verification.screenshots:
        if shot.extraction_status != "read":
            unclear.append({"id": str(shot.id), "note": shot.extraction_note})
    summary = summarize(
        verification.platform,
        classified,
        screenshot_count=len(verification.screenshots),
        unclear_screenshots=unclear,
        targets=category_targets(verification.platform, _target_values(target)),
        workday_ended=workday_has_ended(verification.work_date, tz, now),
        approved=verification.approved_at is not None,
        submitted=verification.submitted_at is not None,
    )
    summary["time_logged"] = _time_logged(db, verification.va_id, task.id, task.client_id, verification.work_date, tz)
    summary["reporting_timezone"] = str(tz)
    return summary


def _audit(db: Session, *, verification_id, activity_id, client_id, current, action: str, reason: str, original, new) -> None:
    db.add(EngagementAudit(
        verification_id=verification_id,
        activity_id=activity_id,
        client_id=client_id,
        actor_user_id=current.user.id,
        actor_name=actor_name(db, current),
        actor_role=current.role.value if isinstance(current.role, UserRole) else str(current.role),
        action=action,
        reason=reason,
        original_result=original,
        new_result=new,
    ))


def _store_image(raw: bytes) -> dict:
    register_image_plugins()
    try:
        return optimize_image(raw)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


def add_screenshot_bytes(
    db: Session,
    *,
    task: Task,
    owner: VA,
    current,
    filename: str,
    content_type: str | None,
    raw: bytes,
    extract=extract_from_image,
) -> EngagementVerification:
    if not raw:
        raise HTTPException(400, "Empty file")
    ctype = (content_type or "").split(";")[0].strip().casefold()
    name = filename or "screenshot"
    suffix = name.rsplit(".", 1)[-1].casefold() if "." in name else ""
    if ctype not in ALLOWED_TYPES and suffix not in {"jpg", "jpeg", "png", "webp", "gif", "avif", "heic", "heif"} and not ctype.startswith("image/"):
        raise HTTPException(400, "Use a JPG, PNG, WEBP, GIF, or HEIC screenshot.")
    verification = _ensure(db, task, owner)
    if verification.approved_at is not None:
        _audit(
            db,
            verification_id=verification.id,
            activity_id=None,
            client_id=verification.client_id,
            current=current,
            action="approval_cleared",
            reason="A new screenshot was added after approval, so the task waits for review again.",
            original={"approved_at": verification.approved_at.isoformat(), "approval_note": verification.approval_note},
            new={"approved_at": None},
        )
        verification.approved_at = None
        verification.approved_by = None
        verification.approval_note = None
    stored = _store_image(raw)
    shot_id = uuid.uuid4()
    key = f"engagement/{verification.id}/{shot_id}.{stored['format']}"
    ref = storage.save_bytes(key, stored["data"], stored["content_type"])
    extraction = extract(raw)
    readable = bool(extraction.get("readable")) and bool(extraction.get("activities"))
    shot = EngagementScreenshot(
        id=shot_id,
        verification_id=verification.id,
        storage_key=key,
        storage_backend="bucket" if str(ref).startswith("s3://") else "local",
        original_name=name[:255],
        content_type=stored["content_type"],
        size_bytes=len(stored["data"]),
        width=stored.get("width"),
        height=stored.get("height"),
        extraction_status="read" if readable else "unclear",
        extraction_note=None if readable else (extraction.get("note") or "This screenshot could not be checked automatically. Nothing on it was counted."),
        platform_seen=(extraction.get("platform") or None),
        account_seen=extraction.get("account"),
        alerts=[],
        uploaded_by=current.user.id,
    )
    db.add(shot)
    db.flush()
    for index, activity in enumerate(extraction.get("activities") or []):
        db.add(EngagementActivity(
            verification_id=verification.id,
            screenshot_id=shot.id,
            activity_type=activity.get("activity_type") or "unknown",
            username_raw=activity.get("username"),
            activity_date=activity.get("activity_date"),
            activity_time=activity.get("activity_time"),
            body_text=activity.get("text"),
            confidence=activity.get("confidence") or "low",
            platform_hint=activity.get("platform_hint") or extraction.get("platform"),
            account_hint=activity.get("account_hint") or extraction.get("account"),
            share_evidence=activity.get("share_evidence"),
            sort_order=index,
        ))
    db.flush()
    refresh(db, verification, task)
    db.commit()
    db.refresh(verification)
    return verification


def _load_task(db: Session, task_id) -> Task:
    task = (
        db.query(Task)
        .options(joinedload(Task.client), joinedload(Task.sub_client), joinedload(Task.assignee))
        .filter(Task.id == task_id)
        .first()
    )
    if not task:
        raise HTTPException(404, "Task not found")
    return task


def _load_verification(db: Session, task: Task) -> EngagementVerification | None:
    return (
        db.query(EngagementVerification)
        .options(
            joinedload(EngagementVerification.screenshots),
            joinedload(EngagementVerification.activities),
            joinedload(EngagementVerification.audits),
        )
        .filter(EngagementVerification.task_id == task.id)
        .first()
    )


def serialize_task(db: Session, task: Task, owner: VA, verification: EngagementVerification | None) -> dict:
    platform = platform_from_title(task.title)
    target = _target_row(db, task.client_id, platform) if platform else None
    tz = _reporting_tz(db, target)
    if verification is None:
        targets = category_targets(platform, _target_values(target)) if platform else []
        ended = workday_has_ended(task_work_date(task), tz, datetime.now(timezone.utc))
        summary = summarize(
            platform or "",
            [],
            screenshot_count=0,
            unclear_screenshots=[],
            targets=targets,
            workday_ended=ended,
            approved=False,
            submitted=False,
        )
        summary["time_logged"] = _time_logged(db, owner.id, task.id, task.client_id, task_work_date(task), tz)
        work_date = task_work_date(task)
        screenshots = []
        activities = []
        audits = []
        submitted_at = approved_at = rejected_at = None
        approval = "Not submitted"
    else:
        summary = refresh(db, verification, task)
        work_date = verification.work_date
        screenshots = [
            {
                "id": str(shot.id),
                "original_name": shot.original_name,
                "extraction_status": shot.extraction_status,
                "extraction_note": shot.extraction_note,
                "platform_seen": shot.platform_seen,
                "account_seen": shot.account_seen,
                "width": shot.width,
                "height": shot.height,
                "created_at": shot.created_at.isoformat() if shot.created_at else None,
                "url": f"/engagement/screenshots/{shot.id}/content",
            }
            for shot in sorted(verification.screenshots, key=lambda row: row.created_at or datetime.min.replace(tzinfo=timezone.utc))
        ]
        activities = [
            {
                "id": str(row.id),
                "screenshot_id": str(row.screenshot_id),
                "activity_type": row.activity_type,
                "username": row.username_raw,
                "activity_date": row.activity_date.isoformat() if row.activity_date else None,
                "activity_time": row.activity_time.strftime("%H:%M") if row.activity_time else None,
                "text": row.body_text,
                "status": row.status,
                "counted": bool(row.counted),
                "alerts": row.alerts or [],
                "explanation": row.explanation,
                "decision": row.decision,
                "decision_reason": row.decision_reason,
                "original_result": row.original_result,
            }
            for row in sorted(verification.activities, key=lambda item: (str(item.screenshot_id), item.sort_order))
        ]
        audits = [
            {
                "id": str(row.id),
                "action": row.action,
                "reason": row.reason,
                "actor_name": row.actor_name,
                "actor_role": row.actor_role,
                "original_result": row.original_result,
                "new_result": row.new_result,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "activity_id": str(row.activity_id) if row.activity_id else None,
            }
            for row in sorted(verification.audits, key=lambda item: item.created_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        ]
        submitted_at = verification.submitted_at.isoformat() if verification.submitted_at else None
        approved_at = verification.approved_at.isoformat() if verification.approved_at else None
        rejected_at = verification.rejected_at.isoformat() if verification.rejected_at else None
        if verification.approved_at:
            approval = "Approved"
        elif verification.rejected_at and not verification.submitted_at:
            approval = "Sent back"
        elif verification.submitted_at:
            approval = "Pending management review"
        else:
            approval = "Not submitted"
    return {
        "task_id": str(task.id),
        "title": task.title,
        "client_id": str(task.client_id),
        "client_name": task.client.name if task.client else "",
        "assignee_name": owner.name,
        "va_id": str(owner.id),
        "platform": platform,
        "work_date": work_date.isoformat(),
        "board_status": task.status.value if hasattr(task.status, "value") else str(task.status),
        "submitted_at": submitted_at,
        "approved_at": approved_at,
        "rejected_at": rejected_at,
        "approval": approval,
        "screenshots": screenshots,
        "activities": activities,
        "audits": audits,
        **summary,
    }


def list_tasks(db: Session, current, work_date: date) -> list[dict]:
    subject = _subject_va(db, current)
    if subject is None and not is_manager(current):
        raise HTTPException(403, "Screenshot check is not available for this account.")
    owners = [subject] if subject is not None else engagement_subjects(db)
    tasks = []
    if not owners:
        return []
    owner_ids = [owner.id for owner in owners]
    rows = (
        db.query(Task)
        .options(joinedload(Task.client), joinedload(Task.sub_client), joinedload(Task.assignee))
        .filter(Task.assignee_va_id.in_(owner_ids))
        .all()
    )
    owner_by_id = {owner.id: owner for owner in owners}
    for task in rows:
        if platform_from_title(task.title) is None:
            continue
        verification = _load_verification(db, task)
        day = verification.work_date if verification else task_work_date(task)
        if day != work_date:
            continue
        owner = owner_by_id.get(task.assignee_va_id)
        if owner is None:
            continue
        tasks.append(serialize_task(db, task, owner, verification))
    tasks.sort(key=lambda row: (row["client_name"].casefold(), row["platform"] or ""))
    db.commit()
    return tasks


def detail(db: Session, current, task_id) -> dict:
    task = _load_task(db, task_id)
    owner = _can_view_task(db, current, task)
    verification = _load_verification(db, task)
    payload = serialize_task(db, task, owner, verification)
    db.commit()
    return payload


def submit_task(db: Session, current, task_id) -> dict:
    va = _require_subject(db, current)
    task = _load_task(db, task_id)
    if task.assignee_va_id != va.id:
        raise HTTPException(403, "Screenshot check is not available for this account.")
    verification = _ensure(db, task, va)
    verification.submitted_at = datetime.now(timezone.utc)
    verification.submitted_by = current.user.id
    verification.rejected_at = None
    verification.rejection_note = None
    _audit(
        db,
        verification_id=verification.id,
        activity_id=None,
        client_id=verification.client_id,
        current=current,
        action="submitted",
        reason="Submitted for management review.",
        original=None,
        new={"submitted_at": verification.submitted_at.isoformat()},
    )
    db.commit()
    return detail(db, current, task_id)


def decide_activity(db: Session, current, activity_id, decision: str, reason: str) -> dict:
    _require_manager(current)
    activity = db.query(EngagementActivity).filter(EngagementActivity.id == activity_id).first()
    if not activity:
        raise HTTPException(404, "Activity not found")
    verification = db.query(EngagementVerification).filter(EngagementVerification.id == activity.verification_id).first()
    task = _load_task(db, verification.task_id)
    if activity.activity_type == "connect" and decision == "approved":
        raise HTTPException(400, "Connection requests are not counted toward the LinkedIn comment target.")
    if activity.activity_type in {"draft", "unsent"} and decision == "approved":
        raise HTTPException(400, "Drafts and unsent messages are not counted.")
    original = activity.original_result or {
        "status": activity.status,
        "counted": activity.counted,
        "alerts": activity.alerts or [],
        "explanation": activity.explanation,
    }
    try:
        entry = manual_override(
            original=original,
            decision=decision,
            reason=reason,
            actor_name=actor_name(db, current),
            when=datetime.now(timezone.utc),
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    activity.decision = decision
    activity.decision_reason = entry["reason"]
    activity.decision_by = current.user.id
    activity.decision_at = datetime.now(timezone.utc)
    _audit(
        db,
        verification_id=verification.id,
        activity_id=activity.id,
        client_id=verification.client_id,
        current=current,
        action=decision,
        reason=entry["reason"],
        original=entry["original_result"],
        new={"decision": decision},
    )
    db.commit()
    return detail(db, current, task.id)


def decide_task(db: Session, current, task_id, decision: str, reason: str) -> dict:
    _require_manager(current)
    task = _load_task(db, task_id)
    owner = _can_view_task(db, current, task)
    verification = _load_verification(db, task)
    if verification is None:
        raise HTTPException(400, "Upload screenshot evidence before approval.")
    cleaned = " ".join((reason or "").split())
    if not cleaned:
        raise HTTPException(400, "A reason is required.")
    summary = refresh(db, verification, task)
    if decision == "approved":
        if summary["pending_review"]:
            raise HTTPException(400, "Review the flagged screenshots before completing this task.")
        if not summary["all_minimums_met"]:
            raise HTTPException(400, "Minimum targets are not met, so this task cannot be completed.")
        original = {"status": summary["status"], "approved_at": None}
        verification.approved_at = datetime.now(timezone.utc)
        verification.approved_by = current.user.id
        verification.approval_note = cleaned
        verification.rejected_at = None
        verification.rejection_note = None
        _audit(
            db,
            verification_id=verification.id,
            activity_id=None,
            client_id=verification.client_id,
            current=current,
            action="task_approved",
            reason=cleaned,
            original=original,
            new={"status": "completed", "approved_at": verification.approved_at.isoformat()},
        )
    elif decision == "rejected":
        original = {"status": summary["status"], "approved_at": verification.approved_at.isoformat() if verification.approved_at else None}
        verification.approved_at = None
        verification.approved_by = None
        verification.approval_note = None
        verification.rejected_at = datetime.now(timezone.utc)
        verification.rejected_by = current.user.id
        verification.rejection_note = cleaned
        verification.submitted_at = None
        _audit(
            db,
            verification_id=verification.id,
            activity_id=None,
            client_id=verification.client_id,
            current=current,
            action="task_rejected",
            reason=cleaned,
            original=original,
            new={"approval": "Sent back"},
        )
    else:
        raise HTTPException(400, "Choose approve or reject.")
    db.commit()
    _ = owner
    return detail(db, current, task.id)


def update_targets(db: Session, current, body: dict) -> dict:
    _require_manager(current)
    platform = (body.get("platform") or "").casefold()
    if platform not in {"instagram", "facebook", "linkedin"}:
        raise HTTPException(400, "Platform must be Instagram, Facebook, or LinkedIn.")
    client = db.query(Client).filter(Client.id == body["client_id"]).first()
    if not client:
        raise HTTPException(404, "Client not found")
    cleaned = " ".join((body.get("reason") or "").split())
    if not cleaned:
        raise HTTPException(400, "A reason is required.")
    row = _target_row(db, client.id, platform)
    original = _target_values(row) if row else category_targets(platform, {})
    if row is None:
        row = EngagementTarget(client_id=client.id, platform=platform)
        db.add(row)
    for field in ("dm_min", "dm_max", "comment_min", "comment_max", "share_min", "share_max"):
        if body.get(field) is not None:
            value = int(body[field])
            if value < 0:
                raise HTTPException(400, "Targets cannot be negative.")
            setattr(row, field, value)
    if body.get("reporting_timezone"):
        row.reporting_timezone = str(body["reporting_timezone"])[:100]
    if body.get("account_names") is not None:
        row.account_names = [str(name).strip() for name in body["account_names"] if str(name).strip()]
    row.updated_by = current.user.id
    row.updated_at = datetime.now(timezone.utc)
    _audit(
        db,
        verification_id=None,
        activity_id=None,
        client_id=client.id,
        current=current,
        action="targets_adjusted",
        reason=cleaned,
        original=original if isinstance(original, dict) else {"categories": original},
        new=_target_values(row) | {"reporting_timezone": row.reporting_timezone, "account_names": row.account_names or []},
    )
    db.commit()
    return {
        "client_id": str(client.id),
        "client_name": client.name,
        "platform": platform,
        "targets": category_targets(platform, _target_values(row)),
        "reporting_timezone": row.reporting_timezone or company_timezone(db),
        "account_names": row.account_names or [],
    }


def screenshot_bytes(db: Session, current, screenshot_id):
    shot = db.query(EngagementScreenshot).filter(EngagementScreenshot.id == screenshot_id).first()
    if not shot:
        raise HTTPException(404, "Screenshot not found")
    verification = db.query(EngagementVerification).filter(EngagementVerification.id == shot.verification_id).first()
    task = _load_task(db, verification.task_id)
    _can_view_task(db, current, task)
    data = storage.read_bytes(shot.storage_key)
    if data is None:
        raise HTTPException(404, "Screenshot file is missing")
    return shot, data


def daily_report(db: Session, current, work_date: date) -> dict:
    if _subject_va(db, current) is None and not is_manager(current):
        raise HTTPException(403, "Screenshot check is not available for this account.")
    rows = list_tasks(db, current, work_date)
    return _report(rows, work_date, work_date)


def weekly_report(db: Session, current, start: date) -> dict:
    if not is_manager(current) and _subject_va(db, current) is None:
        raise HTTPException(403, "Screenshot check is not available for this account.")
    days = [start + timedelta(days=offset) for offset in range(7)]
    rows = []
    for day in days:
        rows.extend(list_tasks(db, current, day))
    return _report(rows, start, start + timedelta(days=6))


def _report(rows: list[dict], start: date, end: date) -> dict:
    lines = []
    total = 0
    all_met = bool(rows)
    clients: dict[str, dict] = {}
    for row in rows:
        client = clients.setdefault(row["client_name"], {"client": row["client_name"], "assignee": row["assignee_name"], "platforms": []})
        client["platforms"].append({
            "work_date": row["work_date"],
            "platform": row["platform"],
            "status": row["status"],
            "status_label": row["status_label"],
            "time_logged": row.get("time_logged"),
            "completion_pct": row["completion_pct"],
            "approval": row["approval"],
            "categories": row["categories"],
        })
        for category in row["categories"]:
            total += category["verified"]
            lines.append(f"{row['client_name']} {category['label']}: {category['verified']} verified")
            if category["below_target"]:
                all_met = False
        if row["status"] not in {"target_met", "target_exceeded", "completed"}:
            all_met = False
    approvals = {row["approval"] for row in rows}
    if not rows:
        final = "No engagement tasks for this date"
        all_met = False
    elif approvals == {"Approved"}:
        final = "Approved"
    elif "Pending management review" in approvals or "Not submitted" in approvals:
        final = "Pending management review"
    else:
        final = "Pending management review"
    employee = rows[0]["assignee_name"] if rows else None
    return {
        "title": "Daily performance report" if start == end else "Weekly performance report",
        "employee": employee,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "clients": list(clients.values()),
        "final_summary": {
            "lines": lines,
            "total_verified": total,
            "all_minimum_targets_met": all_met,
            "final_approval": final,
        },
    }


def report_csv(report: dict) -> str:
    header = [
        "date",
        "client",
        "assignee",
        "platform",
        "category",
        "detected",
        "duplicates",
        "invalid",
        "needs_review",
        "verified",
        "target_min",
        "target_max",
        "completion_pct",
        "status",
        "time_logged",
        "approval",
    ]
    lines = [",".join(header)]

    def cell(value) -> str:
        text = "" if value is None else str(value)
        if any(mark in text for mark in [",", '"', "\n"]):
            return '"' + text.replace('"', '""') + '"'
        return text

    for client in report["clients"]:
        for platform in client["platforms"]:
            for category in platform["categories"]:
                lines.append(",".join(cell(value) for value in [
                    platform["work_date"],
                    client["client"],
                    client["assignee"],
                    platform["platform"],
                    category["label"],
                    category["detected"],
                    category["duplicates"],
                    category["invalid"],
                    category["needs_review"],
                    category["verified"],
                    category["min"],
                    category["max"],
                    category["completion_pct"],
                    platform["status_label"],
                    platform["time_logged"],
                    platform["approval"],
                ]))
    return "\n".join(lines) + "\n"
