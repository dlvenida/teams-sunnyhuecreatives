from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from app.auth import hash_password
from app.database import get_db
from app.deps import CurrentUser, require_admin, require_admin_or_auditor
from app.models import Currency, Project, Task, TaskComment, TaskStatus, TimeClockEntry, ClockStatus, User, VA, WorkLog
from app.schemas import AdminResetPasswordRequest, VADelegateRequest, VAReviewerUpdate, VAResponse, VAUpdate
from app.services.notifications import notify_delegation

router = APIRouter(prefix="/vas", tags=["vas"])


def _serialize_va(va: VA) -> VAResponse:
    return VAResponse(
        id=va.id,
        name=va.name,
        currency=va.currency,
        is_active=va.is_active,
        email=va.user.email if va.user else None,
        user_id=va.user_id,
        reviewer_user_id=va.reviewer_user_id,
        reviewer_name=(va.reviewer.display_name or va.reviewer.email) if getattr(va, "reviewer", None) else None,
    )


@router.get("", response_model=list[VAResponse])
def list_vas(
    _: Annotated[CurrentUser, Depends(require_admin_or_auditor)],
    db: Annotated[Session, Depends(get_db)],
    active_only: bool = False,
):
    q = db.query(VA).options(joinedload(VA.user))
    if active_only:
        q = q.filter(VA.is_active == True)
    return [_serialize_va(v) for v in q.order_by(VA.name).all()]


@router.patch("/{va_id}", response_model=VAResponse)
def update_va(
    va_id: UUID,
    body: VAUpdate,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    va = db.query(VA).options(joinedload(VA.user)).filter(VA.id == va_id).first()
    if not va or not va.user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if body.email and body.email != va.user.email:
        if db.query(User).filter(User.email == body.email, User.id != va.user_id).first():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    if body.name is not None:
        va.name = body.name
    if body.currency is not None:
        va.currency = body.currency
    if body.email is not None:
        va.user.email = body.email
    if body.is_active is not None:
        va.is_active = body.is_active
        va.user.is_active = body.is_active

    db.commit()
    db.refresh(va)
    return _serialize_va(va)


@router.patch("/{va_id}/currency", response_model=VAResponse)
def update_va_currency(
    va_id: UUID,
    currency: Annotated[Currency, Query()],
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    va = db.query(VA).options(joinedload(VA.user)).filter(VA.id == va_id).first()
    if not va:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    va.currency = currency
    db.commit()
    db.refresh(va)
    return _serialize_va(va)


@router.patch("/{va_id}/reviewer", response_model=VAResponse)
def set_reviewer(
    va_id: UUID,
    body: VAReviewerUpdate,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """Assign a specific user (admin or another VA) to review this VA's activity."""
    va = db.query(VA).options(joinedload(VA.user)).filter(VA.id == va_id).first()
    if not va:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if body.reviewer_user_id:
        reviewer = db.query(User).filter(User.id == body.reviewer_user_id, User.is_active.is_(True)).first()
        if not reviewer:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reviewer user not found")
        if reviewer.id == va.user_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A VA cannot review themselves")
    va.reviewer_user_id = body.reviewer_user_id
    db.commit()
    db.refresh(va)
    return _serialize_va(va)


@router.post("/{va_id}/reset-password")
def reset_va_password(
    va_id: UUID,
    body: AdminResetPasswordRequest,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    va = db.query(VA).options(joinedload(VA.user)).filter(VA.id == va_id).first()
    if not va or not va.user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    va.user.password_hash = hash_password(body.password)
    va.user.must_change_password = True
    db.commit()
    return {"message": "Password reset"}


def _delegation_counts(db: Session, va_id: UUID) -> dict:
    tasks = db.query(Task).filter(Task.assignee_va_id == va_id).all()
    per_client: dict[str, int] = {}
    for t in tasks:
        name = t.client.name if t.client else "?"
        per_client[name] = per_client.get(name, 0) + 1
    return {
        "tasks_total": len(tasks),
        "tasks_open": len([t for t in tasks if t.status != TaskStatus.done]),
        "tasks_done": len([t for t in tasks if t.status == TaskStatus.done]),
        "work_logs": db.query(WorkLog).filter(WorkLog.va_id == va_id).count(),
        "clock_entries": db.query(TimeClockEntry).filter(TimeClockEntry.va_id == va_id).count(),
        "active_clock": db.query(TimeClockEntry).filter(TimeClockEntry.va_id == va_id, TimeClockEntry.status.in_([ClockStatus.running, ClockStatus.paused])).count(),
        "tasks_by_client": per_client,
        "clients": sorted(per_client.keys()),
    }


@router.get("/{va_id}/delegation-preview")
def delegation_preview(va_id: UUID, _: Annotated[CurrentUser, Depends(require_admin)], db: Annotated[Session, Depends(get_db)]):
    va = db.query(VA).filter(VA.id == va_id).first()
    if not va:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return {"va_id": str(va.id), "va_name": va.name, **_delegation_counts(db, va_id)}


@router.post("/{va_id}/delegate-and-delete")
def delegate_and_delete(va_id: UUID, body: VADelegateRequest, _: Annotated[CurrentUser, Depends(require_admin)], db: Annotated[Session, Depends(get_db)]):
    """Transfer everything to another VA, then delete this user. All in one transaction."""
    from datetime import datetime, timezone

    va = db.query(VA).options(joinedload(VA.user)).filter(VA.id == va_id).first()
    if not va or not va.user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if body.delegate_to_va_id == va_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose a different user to delegate to")
    target = db.query(VA).options(joinedload(VA.user)).filter(VA.id == body.delegate_to_va_id, VA.is_active == True).first()
    if not target or not target.user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delegate target not found or archived")

    counts_before = _delegation_counts(db, va_id)
    if counts_before["work_logs"] and not body.transfer_logs:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This user has work logs. Enable 'transfer logs' or archive the user instead.")

    # End any live clock session so nothing is left running under a deleted user
    now = datetime.now(timezone.utc)
    for entry in db.query(TimeClockEntry).filter(TimeClockEntry.va_id == va_id, TimeClockEntry.status.in_([ClockStatus.running, ClockStatus.paused])).all():
        entry.status = ClockStatus.completed
        entry.clock_out = now
        entry.duration_seconds = entry.duration_seconds or 0

    # Tasks (all, or open only — done tasks can stay attributed by keeping assignee, but user asked to sync everything;
    # when include_done_tasks is False we still must detach done tasks before deletion, so they become unassigned is NOT allowed: transfer them too but flag in summary)
    task_q = db.query(Task).filter(Task.assignee_va_id == va_id)
    if not body.include_done_tasks:
        task_q = task_q.filter(Task.status != TaskStatus.done)
    tasks_moved = task_q.update({Task.assignee_va_id: target.id}, synchronize_session=False)
    done_detached = 0
    if not body.include_done_tasks:
        done_detached = db.query(Task).filter(Task.assignee_va_id == va_id).update({Task.assignee_va_id: target.id}, synchronize_session=False)

    logs_moved = db.query(WorkLog).filter(WorkLog.va_id == va_id).update({WorkLog.va_id: target.id}, synchronize_session=False) if body.transfer_logs else 0
    clock_moved = db.query(TimeClockEntry).filter(TimeClockEntry.va_id == va_id).update({TimeClockEntry.va_id: target.id}, synchronize_session=False)
    # Authorship / creation references must follow so deletes don't cascade history away
    db.query(TaskComment).filter(TaskComment.author_user_id == va.user_id).update({TaskComment.author_user_id: target.user_id}, synchronize_session=False)
    db.query(Task).filter(Task.created_by == va.user_id).update({Task.created_by: target.user_id}, synchronize_session=False)
    db.query(Project).filter(Project.created_by == va.user_id).update({Project.created_by: target.user_id}, synchronize_session=False)

    summary = {"tasks": int(tasks_moved + done_detached), "work_logs": int(logs_moved), "clock_entries": int(clock_moved), "clients": counts_before["clients"], "tasks_by_client": counts_before["tasks_by_client"]}
    from_name = va.name
    user = va.user
    db.delete(va)
    db.delete(user)
    db.commit()

    db.refresh(target)
    notify_delegation(db, target, from_name, summary)
    return {"deleted": from_name, "delegated_to": target.name, **summary}


@router.delete("/{va_id}")
def delete_va(
    va_id: UUID,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    delegate_to: UUID | None = Query(None),
):
    """Delete a user. If they own tasks/logs, a delegate_to VA is required and everything transfers first."""
    va = db.query(VA).options(joinedload(VA.user)).filter(VA.id == va_id).first()
    if not va:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    counts = _delegation_counts(db, va_id)
    has_data = counts["tasks_total"] > 0 or counts["work_logs"] > 0 or counts["clock_entries"] > 0
    if has_data:
        if not delegate_to:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"This user has {counts['tasks_total']} task(s) and {counts['work_logs']} work log(s). Choose a user to delegate everything to (delegate_to) or use delegate-and-delete.",
            )
        return delegate_and_delete(va_id, VADelegateRequest(delegate_to_va_id=delegate_to), _, db)
    user = va.user
    db.delete(va)
    if user:
        db.delete(user)
    db.commit()
    return {"deleted": va.name}
