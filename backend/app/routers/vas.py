from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from app.auth import hash_password
from app.database import get_db
from app.deps import CurrentUser, require_admin
from app.models import Currency, User, VA, WorkLog
from app.schemas import AdminResetPasswordRequest, VAResponse, VAUpdate

router = APIRouter(prefix="/vas", tags=["vas"])


def _serialize_va(va: VA) -> VAResponse:
    return VAResponse(
        id=va.id,
        name=va.name,
        currency=va.currency,
        is_active=va.is_active,
        email=va.user.email if va.user else None,
    )


@router.get("", response_model=list[VAResponse])
def list_vas(
    _: Annotated[CurrentUser, Depends(require_admin)],
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


@router.delete("/{va_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_va(
    va_id: UUID,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    va = db.query(VA).options(joinedload(VA.user)).filter(VA.id == va_id).first()
    if not va:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    has_logs = db.query(WorkLog).filter(WorkLog.va_id == va_id).first()
    if has_logs:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete user with work logs. Archive instead.",
        )
    user = va.user
    db.delete(va)
    if user:
        db.delete(user)
    db.commit()
