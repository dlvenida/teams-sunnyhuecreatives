from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.orm import Session

from app.auth import decode_token
from app.database import get_db
from app.models import User, UserRole, VA

security = HTTPBearer()


class CurrentUser:
    def __init__(self, user: User, va_id: UUID | None = None, impersonated_by: UUID | None = None):
        self.user = user
        self.va_id = va_id
        self.impersonated_by = impersonated_by

    @property
    def is_impersonating(self) -> bool:
        return self.impersonated_by is not None

    @property
    def id(self) -> UUID:
        return self.user.id

    @property
    def role(self) -> UserRole:
        return self.user.role


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)],
    db: Annotated[Session, Depends(get_db)],
) -> CurrentUser:
    try:
        payload = decode_token(credentials.credentials)
        if payload.get("type") != "access":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
        user_id = UUID(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    va_id = UUID(payload["va_id"]) if payload.get("va_id") else None
    impersonated_by = UUID(payload["impersonated_by"]) if payload.get("impersonated_by") else None
    return CurrentUser(user=user, va_id=va_id, impersonated_by=impersonated_by)


def require_admin(current: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
    if current.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current


def require_admin_or_auditor(current: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
    """Read-only monitoring access: admins and auditors (auditors watch, admins act)."""
    if current.role not in (UserRole.admin, UserRole.auditor):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin or Auditor access required")
    return current


def require_va(current: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
    """Personal worker access: Virtual Assistants, or admin/auditor tracking their own hours."""
    if not current.va_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Worker profile not found — sign out and back in")
    if current.role == UserRole.va:
        return current
    if current.role in (UserRole.admin, UserRole.auditor):
        return current
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="VA access required")


def require_ops(current: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
    """Admin or auditor managing tasks/projects (full ops, no money implied)."""
    if current.role not in (UserRole.admin, UserRole.auditor):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin or Auditor access required")
    return current
