from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import (
    create_access_token,
    create_refresh_token,
    create_token_payload,
    decode_token,
    hash_password,
    verify_password,
)
from app.database import get_db
from app.deps import CurrentUser, get_current_user, require_admin
from app.models import User, UserRole, VA
from app.schemas import (
    AppUserResponse,
    ChangePasswordRequest,
    CreateAppUserRequest,
    CreateVAUserRequest,
    LoginRequest,
    RefreshRequest,
    TokenResponse,
    VAResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Annotated[Session, Depends(get_db)]):
    user = db.query(User).filter(User.email == body.email).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    va_id = None
    name = user.display_name or None
    if user.role == UserRole.va:
        va = db.query(VA).filter(VA.user_id == user.id).first()
        if not va:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="VA profile not found")
        va_id = va.id
        name = va.name
    if not name:
        name = user.email.split("@")[0]

    payload = create_token_payload(user.id, user.role.value, va_id)
    return TokenResponse(
        access_token=create_access_token(payload),
        refresh_token=create_refresh_token(payload),
        role=user.role,
        must_change_password=user.must_change_password,
        va_id=va_id,
        name=name,
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh(body: RefreshRequest, db: Annotated[Session, Depends(get_db)]):
    try:
        payload = decode_token(body.refresh_token)
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        user_id = UUID(payload["sub"])
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    va_id = UUID(payload["va_id"]) if payload.get("va_id") else None
    name = user.display_name or user.email.split("@")[0]
    if va_id:
        va = db.query(VA).filter(VA.id == va_id).first()
        name = va.name if va else name

    token_payload = create_token_payload(user.id, user.role.value, va_id)
    return TokenResponse(
        access_token=create_access_token(token_payload),
        refresh_token=create_refresh_token(token_payload),
        role=user.role,
        must_change_password=user.must_change_password,
        va_id=va_id,
        name=name,
    )


@router.post("/change-password")
def change_password(
    body: ChangePasswordRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    if not verify_password(body.current_password, current.user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    current.user.password_hash = hash_password(body.new_password)
    current.user.must_change_password = False
    db.commit()
    return {"message": "Password updated"}


def _app_user(db: Session, u: User) -> AppUserResponse:
    va = db.query(VA).filter(VA.user_id == u.id).first()
    name = u.display_name or (va.name if va else None) or u.email.split("@")[0]
    auditing = db.query(VA).filter(VA.reviewer_user_id == u.id).count() if u.role in (UserRole.auditor, UserRole.admin) else 0
    return AppUserResponse(id=u.id, email=u.email, name=name, role=u.role.value, is_active=bool(u.is_active), va_id=va.id if va else None, auditing_count=auditing)


@router.get("/users", response_model=list[AppUserResponse])
def list_app_users(
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """All app users across roles: Administrator, Auditor, Virtual Assistant."""
    users = db.query(User).order_by(User.role, User.email).all()
    return [_app_user(db, u) for u in users]


@router.post("/users", response_model=AppUserResponse, status_code=status.HTTP_201_CREATED)
def create_app_user(
    body: CreateAppUserRequest,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    if body.role not in ("admin", "auditor", "va"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Role must be admin, auditor, or va")
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
    user = User(
        email=body.email, password_hash=hash_password(body.password),
        role=UserRole(body.role), must_change_password=True, display_name=body.name,
    )
    db.add(user)
    db.flush()
    if body.role == "va":
        db.add(VA(user_id=user.id, name=body.name, currency=body.currency))
    db.commit()
    db.refresh(user)
    return _app_user(db, user)


@router.patch("/users/{user_id}", response_model=AppUserResponse)
def update_app_user(
    user_id: UUID,
    body: dict,
    current: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if "is_active" in body:
        if u.id == current.user.id and not body["is_active"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot deactivate yourself")
        u.is_active = bool(body["is_active"])
        va = db.query(VA).filter(VA.user_id == u.id).first()
        if va:
            va.is_active = bool(body["is_active"])
    if body.get("name"):
        u.display_name = str(body["name"])
        va = db.query(VA).filter(VA.user_id == u.id).first()
        if va:
            va.name = str(body["name"])
    db.commit()
    db.refresh(u)
    return _app_user(db, u)


@router.post("/va-users", response_model=VAResponse)
def create_va_user(
    body: CreateVAUserRequest,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        role=UserRole.va,
        must_change_password=True,
    )
    db.add(user)
    db.flush()

    va = VA(user_id=user.id, name=body.name, currency=body.currency)
    db.add(va)
    db.commit()
    db.refresh(va)

    return VAResponse(id=va.id, name=va.name, currency=va.currency, is_active=va.is_active, email=user.email)
