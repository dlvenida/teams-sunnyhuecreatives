import csv
import io
import uuid as uuid_mod
from datetime import date
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import Response as FastResponse
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import CurrentUser, require_admin, require_admin_or_auditor, get_current_user
from app.models import UserRole, WorkLog, WorkLogAttachment, WorkLogStatus
from app.schemas import WorkLogAttachmentResponse, WorkLogResponse, WorkLogUpdate
from app.services import storage
from app.services.calculations import calculate_hours, calculate_pay
from app.services.images import ALLOWED_CONTENT_TYPES, optimize_image
from app.services.notifications import push, va_user_id

router = APIRouter(prefix="/work-logs", tags=["work-logs"])

# Work-log proof attachments: any file type, capped so uploads don't hang/fail silently.
MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024


def _serialize_log(log: WorkLog, redact_money: bool = False) -> WorkLogResponse:
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
        va_rate=None if redact_money else log.va_rate,
        va_pay=None if redact_money else log.va_pay,
        notes=log.notes,
        status=log.status,
        invoice_id=log.invoice_id,
        project_id=log.project_id, project_name=log.project.name if getattr(log, "project", None) else None,
        task_id=log.task_id, task_title=log.task.title if getattr(log, "task", None) else None,
        clock_in_at=log.clock_in_at, clock_out_at=log.clock_out_at, source=log.source or "manual",
        created_at=log.created_at,
        attachment_count=len(log.attachments) if getattr(log, "attachments", None) is not None else 0,
    )


@router.get("", response_model=list[WorkLogResponse])
def list_work_logs(
    current: Annotated[CurrentUser, Depends(require_admin_or_auditor)],
    db: Annotated[Session, Depends(get_db)],
    client_id: UUID | None = None,
    va_id: UUID | None = None,
    status_filter: WorkLogStatus | None = Query(None, alias="status"),
    date_from: date | None = None,
    date_to: date | None = None,
):
    redact = current.role == UserRole.auditor
    return [_serialize_log(log, redact) for log in _query_logs(db, client_id, va_id, status_filter, date_from, date_to)]


def _query_logs(
    db: Session,
    client_id: UUID | None = None,
    va_id: UUID | None = None,
    status_filter: WorkLogStatus | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[WorkLog]:
    q = (
        db.query(WorkLog)
        .options(
            joinedload(WorkLog.va), joinedload(WorkLog.client), joinedload(WorkLog.sub_client),
            joinedload(WorkLog.project), joinedload(WorkLog.task), joinedload(WorkLog.attachments),
        )
        .order_by(WorkLog.work_date.desc(), WorkLog.created_at.desc())
    )
    if client_id:
        q = q.filter(WorkLog.client_id == client_id)
    if va_id:
        q = q.filter(WorkLog.va_id == va_id)
    if status_filter:
        q = q.filter(WorkLog.status == status_filter)
    if date_from:
        q = q.filter(WorkLog.work_date >= date_from)
    if date_to:
        q = q.filter(WorkLog.work_date <= date_to)
    return q.all()


@router.get("/export/csv")
@router.get("/export")
def export_csv(
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    client_id: UUID | None = None,
    va_id: UUID | None = None,
    status_filter: WorkLogStatus | None = Query(None, alias="status"),
    date_from: date | None = None,
    date_to: date | None = None,
):
    logs = [_serialize_log(log) for log in _query_logs(db, client_id, va_id, status_filter, date_from, date_to)]
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Date", "VA", "Client", "Sub-client", "Description", "Hours", "VA Rate", "VA Pay", "Status"])
    for log in logs:
        writer.writerow([
            log.work_date, log.va_name, log.client_name, log.sub_client_name or "",
            log.description_plain, log.hours, log.va_rate, log.va_pay, log.status.value,
        ])
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=work-logs.csv"},
    )


def _get_log(db: Session, log_id: UUID) -> WorkLog:
    log = (
        db.query(WorkLog)
        .options(
            joinedload(WorkLog.va), joinedload(WorkLog.client), joinedload(WorkLog.sub_client),
            joinedload(WorkLog.project), joinedload(WorkLog.task), joinedload(WorkLog.attachments),
        )
        .filter(WorkLog.id == log_id)
        .first()
    )
    if not log:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work log not found")
    return log


@router.patch("/{log_id}", response_model=WorkLogResponse)
def update_work_log(
    log_id: UUID,
    body: WorkLogUpdate,
    current: Annotated[CurrentUser, Depends(require_admin_or_auditor)],
    db: Annotated[Session, Depends(get_db)],
):
    log = _get_log(db, log_id)
    data = body.model_dump(exclude_unset=True)
    # Auditors cannot touch money fields
    if current.role == UserRole.auditor:
        data.pop("va_rate", None)
        if "status" in data and data["status"] not in (WorkLogStatus.approved, WorkLogStatus.rejected, WorkLogStatus.submitted):
            raise HTTPException(403, "Auditor cannot set that status")

    for k, v in data.items():
        setattr(log, k, v)

    if body.start_time or body.end_time or body.work_date or (body.va_rate is not None and current.role == UserRole.admin):
        start = body.start_time or log.start_time
        end = body.end_time or log.end_time
        work_date = body.work_date or log.work_date
        from app.services.work_log_overlap import assert_no_time_overlap
        assert_no_time_overlap(
            db,
            va_id=log.va_id,
            work_date=work_date,
            start_time=start,
            end_time=end,
            exclude_id=log.id,
        )
        rate = body.va_rate if (body.va_rate is not None and current.role == UserRole.admin) else log.va_rate
        log.hours = calculate_hours(start, end)
        log.va_pay = calculate_pay(log.hours, rate)

    db.commit()
    log = _get_log(db, log.id)
    return _serialize_log(log, redact_money=current.role == UserRole.auditor)


@router.post("/{log_id}/approve", response_model=WorkLogResponse)
def approve_log(
    log_id: UUID,
    current: Annotated[CurrentUser, Depends(require_admin_or_auditor)],
    db: Annotated[Session, Depends(get_db)],
):
    result = update_work_log(log_id, WorkLogUpdate(status=WorkLogStatus.approved), current, db)
    push(db, [va_user_id(db, result.va_id)], "log", "✅ Your time log was approved",
         f"{result.client_name} · {result.work_date} · {result.hours} hrs is now approved.", "/va/time-log")
    return result


@router.post("/{log_id}/reject", response_model=WorkLogResponse)
def reject_log(
    log_id: UUID,
    current: Annotated[CurrentUser, Depends(require_admin_or_auditor)],
    db: Annotated[Session, Depends(get_db)],
):
    result = update_work_log(log_id, WorkLogUpdate(status=WorkLogStatus.rejected), current, db)
    push(db, [va_user_id(db, result.va_id)], "log", "⚠️ Your time log needs changes",
         f"{result.client_name} · {result.work_date} · {result.hours} hrs was rejected — please review and resubmit.", "/va/time-log")
    return result


@router.delete("/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_log(
    log_id: UUID,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    log = db.query(WorkLog).filter(WorkLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work log not found")
    if log.status == WorkLogStatus.invoiced:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete invoiced entry")
    db.delete(log)
    db.commit()


@router.get("/{log_id}/attachments", response_model=list[WorkLogAttachmentResponse])
def list_attachments(
    log_id: UUID,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    log = db.query(WorkLog).filter(WorkLog.id == log_id).first()
    if not log:
        raise HTTPException(404, "Work log not found")
    if current.role == UserRole.va and log.va_id != current.va_id:
        raise HTTPException(403, "Not your log")
    rows = db.query(WorkLogAttachment).filter(WorkLogAttachment.work_log_id == log_id).order_by(WorkLogAttachment.created_at).all()
    return rows


@router.post("/{log_id}/attachments", response_model=WorkLogAttachmentResponse, status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    log_id: UUID,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = File(...),
):
    log = db.query(WorkLog).filter(WorkLog.id == log_id).first()
    if not log:
        raise HTTPException(404, "Work log not found")
    if current.role == UserRole.va:
        if log.va_id != current.va_id:
            raise HTTPException(403, "Not your log")
        if log.status in (WorkLogStatus.approved, WorkLogStatus.invoiced):
            raise HTTPException(400, "Cannot attach to approved/invoiced logs")
    elif current.role not in (UserRole.admin, UserRole.auditor):
        raise HTTPException(403, "Forbidden")

    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file")
    if len(raw) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(400, f"File is too large — keep attachments under {MAX_ATTACHMENT_BYTES // (1024 * 1024)} MB")

    filename = (file.filename or "attachment")[:255]
    ctype = (file.content_type or "application/octet-stream").lower()
    att_id = uuid_mod.uuid4()
    width = height = None
    data = raw
    stored_ctype = ctype

    # Optimize known images; store every other file as-is (PDF, docs, screenshots, etc.)
    is_image = ctype in ALLOWED_CONTENT_TYPES or ctype.startswith("image/")
    if is_image:
        try:
            opt = optimize_image(raw)
            data = opt["data"]
            stored_ctype = opt["content_type"]
            width = opt["width"]
            height = opt["height"]
            ext = opt["format"]
        except ValueError:
            # Unreadable "image/*" — keep original bytes so the upload still succeeds
            ext = (filename.rsplit(".", 1)[-1] if "." in filename else "bin")[:12]
    else:
        ext = (filename.rsplit(".", 1)[-1] if "." in filename else "bin")[:12]

    key = f"work-logs/{log_id}/{att_id}.{ext}"
    storage.save_bytes(key, data, stored_ctype)
    att = WorkLogAttachment(
        id=att_id,
        work_log_id=log_id,
        storage_key=key,
        filename=filename,
        content_type=stored_ctype,
        size_bytes=len(data),
        width=width,
        height=height,
        uploaded_by=current.user.id,
    )
    db.add(att)
    db.commit()
    db.refresh(att)
    return att


@router.get("/attachments/{attachment_id}/content")
def attachment_content(
    attachment_id: UUID,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    att = db.query(WorkLogAttachment).options(joinedload(WorkLogAttachment.work_log)).filter(WorkLogAttachment.id == attachment_id).first()
    if not att:
        raise HTTPException(404, "Attachment not found")
    if current.role == UserRole.va and att.work_log.va_id != current.va_id:
        raise HTTPException(403, "Forbidden")
    data = storage.read_bytes(att.storage_key)
    if data is None:
        raise HTTPException(404, "File missing")
    return FastResponse(content=data, media_type=att.content_type)


@router.delete("/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_attachment(
    attachment_id: UUID,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    att = db.query(WorkLogAttachment).options(joinedload(WorkLogAttachment.work_log)).filter(WorkLogAttachment.id == attachment_id).first()
    if not att:
        raise HTTPException(404, "Attachment not found")
    if current.role == UserRole.va:
        if att.work_log.va_id != current.va_id or att.uploaded_by != current.user.id:
            raise HTTPException(403, "Forbidden")
        if att.work_log.status in (WorkLogStatus.approved, WorkLogStatus.invoiced):
            raise HTTPException(400, "Cannot delete from approved logs")
    elif current.role != UserRole.admin:
        raise HTTPException(403, "Forbidden")
    storage.delete(att.storage_key)
    db.delete(att)
    db.commit()
