"""Engagement screenshot verification. Community Engagement VAs upload. Management reviews. No pay fields."""
from datetime import date, timedelta
from typing import Annotated
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser, get_current_user
from app.models import UserRole
from app.services import engagement_service as svc
from app.services.engagement_access import engagement_roster, set_engagement_access
from app.services.payroll_calendar import manila_today

router = APIRouter(prefix="/engagement", tags=["engagement"])


class DecisionBody(BaseModel):
    reason: str = Field(min_length=1)


class TargetBody(BaseModel):
    client_id: UUID
    platform: str
    reason: str = Field(min_length=1)
    dm_min: int | None = None
    dm_max: int | None = None
    comment_min: int | None = None
    comment_max: int | None = None
    share_min: int | None = None
    share_max: int | None = None
    reporting_timezone: str | None = None
    account_names: list[str] | None = None


class AccessBody(BaseModel):
    enabled: bool


def _day(value: date | None) -> date:
    return value or manila_today()


@router.get("/access")
def access(current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    from app.services.engagement_access import sync_engagement_subject

    sync_engagement_subject(db)
    return svc.access_payload(db, current)


@router.get("/vas")
def list_vas(current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    if current.role != UserRole.admin:
        raise HTTPException(403, "Only an administrator can change who uses screenshot check.")
    return {"vas": engagement_roster(db)}


@router.patch("/vas/{va_id}")
def update_va_access(
    va_id: UUID,
    body: AccessBody,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    if current.role != UserRole.admin:
        raise HTTPException(403, "Only an administrator can change who uses screenshot check.")
    va = set_engagement_access(db, va_id, body.enabled)
    return {"va_id": str(va.id), "name": va.name, "enabled": bool(va.engagement_verification), "manual": True}


@router.get("/tasks")
def tasks(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    work_date: date | None = None,
):
    return {"work_date": _day(work_date).isoformat(), "tasks": svc.list_tasks(db, current, _day(work_date))}


@router.get("/tasks/{task_id}")
def task_detail(
    task_id: UUID,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    return svc.detail(db, current, task_id)


@router.post("/tasks/{task_id}/screenshots")
async def upload_screenshots(
    task_id: UUID,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    files: list[UploadFile] = File(...),
):
    va = svc._require_subject(db, current)
    task = svc._load_task(db, task_id)
    if task.assignee_va_id != va.id or svc.platform_from_title(task.title) is None:
        raise HTTPException(404, "Task not found")
    if not files:
        raise HTTPException(400, "Choose at least one screenshot.")
    if len(files) > svc.MAX_FILES:
        raise HTTPException(400, f"Upload up to {svc.MAX_FILES} screenshots at a time.")
    for upload in files:
        raw = await upload.read()
        svc.add_screenshot_bytes(
            db,
            task=task,
            owner=va,
            current=current,
            filename=upload.filename or "screenshot",
            content_type=upload.content_type,
            raw=raw,
        )
    return svc.detail(db, current, task_id)


@router.post("/tasks/{task_id}/submit")
def submit_task(
    task_id: UUID,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    return svc.submit_task(db, current, task_id)


@router.post("/activities/{activity_id}/approve")
def approve_activity(
    activity_id: UUID,
    body: DecisionBody,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    return svc.decide_activity(db, current, activity_id, "approved", body.reason)


@router.post("/activities/{activity_id}/reject")
def reject_activity(
    activity_id: UUID,
    body: DecisionBody,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    return svc.decide_activity(db, current, activity_id, "rejected", body.reason)


@router.post("/tasks/{task_id}/approve")
def approve_task(
    task_id: UUID,
    body: DecisionBody,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    return svc.decide_task(db, current, task_id, "approved", body.reason)


@router.post("/tasks/{task_id}/reject")
def reject_task(
    task_id: UUID,
    body: DecisionBody,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    return svc.decide_task(db, current, task_id, "rejected", body.reason)


@router.put("/targets")
def update_targets(
    body: TargetBody,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    return svc.update_targets(db, current, body.model_dump())


@router.get("/screenshots/{screenshot_id}/content")
def screenshot_content(
    screenshot_id: UUID,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    shot, data = svc.screenshot_bytes(db, current, screenshot_id)
    raw_name = shot.original_name or "screenshot"
    ascii_name = raw_name.encode("ascii", "ignore").decode().replace('"', "'").strip() or "screenshot"
    disposition = f'inline; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(raw_name)}'
    return Response(
        content=data,
        media_type=shot.content_type or "image/avif",
        headers={"Cache-Control": "private, max-age=3600", "Content-Disposition": disposition},
    )


@router.get("/reports/daily")
def daily_report(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    work_date: date | None = None,
):
    return svc.daily_report(db, current, _day(work_date))


@router.get("/reports/weekly")
def weekly_report(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    start: date | None = None,
):
    day = _day(start)
    monday = day - timedelta(days=day.weekday())
    return svc.weekly_report(db, current, monday)


@router.get("/reports/export")
def export_report(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    work_date: date | None = None,
    span: str = Query("day"),
):
    day = _day(work_date)
    if span == "week":
        monday = day - timedelta(days=day.weekday())
        report = svc.weekly_report(db, current, monday)
        filename = f"engagement-week-{monday.isoformat()}.csv"
    else:
        report = svc.daily_report(db, current, day)
        filename = f"engagement-day-{day.isoformat()}.csv"
    return Response(
        content=svc.report_csv(report),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
