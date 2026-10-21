from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


import re as _re


def username_base(email: str) -> str:
    """Default username from an email: local part, lowercase, [a-z0-9._-], min 3 chars."""
    base = _re.sub(r"[^a-z0-9._-]", "", (email or "").split("@")[0].lower()).strip("._-")
    return base or "user"


def unique_username(db, email: str, exclude_user_id=None) -> str:
    """A username for `email` that no other user has (appends 2, 3, … on collision)."""
    from app.models import User
    base = username_base(email)
    candidate, n = base, 2
    while True:
        q = db.query(User).filter(User.username == candidate)
        if exclude_user_id:
            q = q.filter(User.id != exclude_user_id)
        if not q.first():
            return candidate
        candidate = f"{base}{n}"; n += 1


def valid_username(value: str) -> bool:
    return bool(_re.fullmatch(r"[a-z0-9][a-z0-9._-]{2,29}", value or ""))


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict[str, Any]) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_access_expire_minutes)
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=ALGORITHM)


def create_refresh_token(data: dict[str, Any]) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=settings.jwt_refresh_expire_days)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])


def create_token_payload(user_id: UUID, role: str, va_id: UUID | None = None, impersonated_by: UUID | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"sub": str(user_id), "role": role}
    if va_id:
        payload["va_id"] = str(va_id)
    if impersonated_by:
        payload["impersonated_by"] = str(impersonated_by)
    return payload
