import random
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import CurrentUser, get_current_user
from app.models import User, UserRole, VA
from app.auth import hash_password, verify_password
from app.schemas import (
    EmailChangeConfirm,
    EmailChangeRequest,
    ProfileResponse,
    ProfileUpdate,
    RemovePinRequest,
    SetPinRequest,
)
from app.services import storage
from app.services.email import send_email_verification

router = APIRouter(prefix="/profile", tags=["profile"])

PROFILE_PHOTO_SIZE = 512 * 1024  # 512 KB max


def _profile_dir() -> Path:
    path = Path(settings.uploads_dir) / "profiles"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _photo_path(user_id: UUID) -> Path:
    return _profile_dir() / f"{user_id}.avif"


def _photo_key(user_id: UUID) -> str:
    return f"profiles/{user_id}.avif"


def _is_avif(data: bytes) -> bool:
    if len(data) < 12:
        return False
    return data[4:8] == b"ftyp" and (b"avif" in data[8:16] or b"avis" in data[8:16])


def _display_name(user: User, va: VA | None) -> str:
    if va:
        return va.name
    if user.display_name:
        return user.display_name
    return user.email.split("@")[0]


def _serialize_profile(user: User, va: VA | None) -> ProfileResponse:
    return ProfileResponse(
        id=user.id,
        email=user.email,
        username=user.username,
        pending_email=user.pending_email,
        role=user.role,
        display_name=_display_name(user, va),
        has_profile_photo=user.profile_photo_path is not None
        and (storage.bucket_enabled() or _photo_path(user.id).exists()),
        phone=user.phone,
        address=user.address,
        wise_email=user.wise_email,
        ph_bank_account=user.ph_bank_account,
        ph_bank_account_name=user.ph_bank_account_name,
        ph_bank_name=user.ph_bank_name,
        currency=va.currency if va else None,
        must_change_password=user.must_change_password,
        has_pin=user.pin_hash is not None,
        job_title=user.job_title, bio=user.bio, timezone=user.timezone, skills=user.skills or [],
        emergency_contact_name=user.emergency_contact_name, emergency_contact_phone=user.emergency_contact_phone,
        emergency_contact_relationship=user.emergency_contact_relationship, hire_date=user.hire_date,
        date_of_birth=user.date_of_birth, linkedin_url=user.linkedin_url, portfolio_url=user.portfolio_url,
        status_message=user.status_message, created_at=user.created_at,
    )


@router.get("/me", response_model=ProfileResponse)
def get_my_profile(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    va = None
    if current.va_id:
        va = db.query(VA).filter(VA.id == current.va_id).first()
    return _serialize_profile(current.user, va)


@router.patch("/me", response_model=ProfileResponse)
def update_my_profile(
    body: ProfileUpdate,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    user = current.user
    va = None
    if current.va_id:
        va = db.query(VA).filter(VA.id == current.va_id).first()

    data = body.model_dump(exclude_unset=True)
    new_username = data.pop("username", None)
    if new_username is not None:
        from app.auth import unique_username, valid_username
        candidate = new_username.strip().lower()
        if candidate != (user.username or ""):
            if not valid_username(candidate):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                    detail="Username must be 3–30 characters: lowercase letters, numbers, dots, dashes or underscores, starting with a letter or number.")
            taken = db.query(User).filter(User.username == candidate, User.id != user.id).first()
            if taken:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That username is already taken")
            user.username = candidate
    display_name = data.pop("display_name", None)
    if display_name is not None:
        if va:
            va.name = display_name.strip()
        else:
            user.display_name = display_name.strip() or None

    for key, value in data.items():
        setattr(user, key, value)

    db.commit()
    db.refresh(user)
    if va:
        db.refresh(va)
    return _serialize_profile(user, va)


@router.post("/photo")
async def upload_profile_photo(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = File(...),
):
    if file.content_type not in ("image/avif", "application/octet-stream"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Photo must be AVIF format")

    data = await file.read()
    if len(data) > PROFILE_PHOTO_SIZE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Photo must be under 512 KB")
    if not _is_avif(data):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid AVIF file")

    ref = storage.save_bytes(_photo_key(current.user.id), data, "image/avif")
    current.user.profile_photo_path = ref
    db.commit()
    return {"message": "Photo updated", "has_profile_photo": True}


@router.delete("/photo", status_code=status.HTTP_204_NO_CONTENT)
def delete_profile_photo(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    storage.delete(_photo_key(current.user.id))
    current.user.profile_photo_path = None
    db.commit()


@router.get("/photo")
def get_profile_photo(current: Annotated[CurrentUser, Depends(get_current_user)]):
    data = storage.read_bytes(_photo_key(current.user.id))
    if data is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No profile photo")
    return Response(content=data, media_type="image/avif")


@router.post("/set-pin")
def set_pin(
    body: SetPinRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Set or change the 6-digit quick-login PIN (requires the account password)."""
    if not verify_password(body.current_password, current.user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    if len(set(body.pin)) == 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PIN is too weak — avoid repeating the same digit")
    current.user.pin_hash = hash_password(body.pin)
    current.user.pin_failed_attempts = 0
    current.user.pin_locked_until = None
    db.commit()
    return {"message": "PIN saved. You can now quick-login with your PIN.", "has_pin": True}


@router.post("/remove-pin")
def remove_pin(
    body: RemovePinRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    if not verify_password(body.current_password, current.user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    current.user.pin_hash = None
    current.user.pin_failed_attempts = 0
    current.user.pin_locked_until = None
    db.commit()
    return {"message": "PIN removed.", "has_pin": False}


@router.post("/request-email-change")
def request_email_change(
    body: EmailChangeRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    new_email = body.new_email.strip().lower()
    if new_email == current.user.email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That is already your email")

    existing = db.query(User).filter(User.email == new_email).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already in use")

    code = f"{random.randint(0, 999999):06d}"
    current.user.pending_email = new_email
    current.user.email_verification_code = code
    current.user.email_verification_expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
    db.commit()

    va = db.query(VA).filter(VA.user_id == current.user.id).first() if current.role == UserRole.va else None
    name = _display_name(current.user, va)
    sent, dev_code = send_email_verification(new_email, code, name)

    response: dict = {"message": "Verification code sent to your new email address."}
    if not sent and dev_code:
        response["dev_code"] = dev_code
        response["message"] = "Verification code generated (email not configured — use dev_code below)."
    elif not sent:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Could not send verification email")

    return response


@router.post("/confirm-email-change", response_model=ProfileResponse)
def confirm_email_change(
    body: EmailChangeConfirm,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    user = current.user
    if not user.pending_email or not user.email_verification_code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No pending email change")

    expires = user.email_verification_expires_at
    if not expires or expires < datetime.now(timezone.utc):
        user.pending_email = None
        user.email_verification_code = None
        user.email_verification_expires_at = None
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Verification code expired")

    if body.code.strip() != user.email_verification_code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid verification code")

    user.email = user.pending_email
    user.pending_email = None
    user.email_verification_code = None
    user.email_verification_expires_at = None
    db.commit()
    db.refresh(user)

    va = db.query(VA).filter(VA.user_id == user.id).first() if user.role == UserRole.va else None
    return _serialize_profile(user, va)
