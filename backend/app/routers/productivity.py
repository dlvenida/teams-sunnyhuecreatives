"""Productivity percentage and dues. A VA only receives their own record."""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser, get_current_user
from app.models import UserRole, VA
from app.services.productivity import build_va_productivity, team_productivity
from app.services.va_rates import own_month_pay

router = APIRouter(prefix="/dashboard", tags=["productivity"])


def _own_va(db: Session, current: CurrentUser) -> VA:
    if not current.va_id:
        raise HTTPException(403, "You can only see your own productivity.")
    va = db.query(VA).filter(VA.id == current.va_id, VA.is_active.is_(True)).first()
    if va is None:
        raise HTTPException(403, "You can only see your own productivity.")
    return va


@router.get("/productivity")
def my_productivity(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """The signed-in person's own week. A va_id query is ignored so it cannot switch VAs."""
    va = _own_va(db, current)
    link = "/va/tasks" if current.role == UserRole.va else "/admin/tasks"
    return build_va_productivity(db, va, link_base=link)


@router.get("/productivity/team")
def team(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    if current.role == UserRole.auditor:
        return team_productivity(db, include_pay=False)
    if current.role == UserRole.admin:
        return team_productivity(db, include_pay=True)
    raise HTTPException(403, "You can only see your own productivity.")


@router.get("/productivity/{va_id}")
def one_va(
    va_id: UUID,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    if current.role == UserRole.va:
        if current.va_id != va_id:
            raise HTTPException(403, "You can only see your own productivity.")
        va = _own_va(db, current)
        return build_va_productivity(db, va, link_base="/va/tasks")
    if current.role not in (UserRole.admin, UserRole.auditor):
        raise HTTPException(403, "You can only see your own productivity.")
    va = db.query(VA).filter(VA.id == va_id, VA.is_active.is_(True)).first()
    if va is None:
        raise HTTPException(404, "VA not found")
    payload = build_va_productivity(db, va, link_base="/admin/tasks")
    if current.role == UserRole.admin:
        payload["pay"] = own_month_pay(db, va.id)
    return payload
