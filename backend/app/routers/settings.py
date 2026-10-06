from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser, get_current_user, require_admin
from app.models import SystemSetting
from app.schemas import DisplaySettingsResponse, SettingsResponse, SettingsUpdate

router = APIRouter(prefix="/settings", tags=["settings"])

DEFAULTS = {
    "company_name": "Sunny Hue Creatives",
    "principal_name": "Jane Laurine Venida",
    "location": "Dumaguete City, Philippines",
    "wise_email": "janelaurine@gmail.com",
    "paypal_email": "janelaurine@gmail.com",
    "hide_pricing": True,
    "booking_url": "",
    "booking_hide_pricing": True,
    "default_va_hourly_rate": "75.00",
}


def _get_settings(db: Session) -> dict:
    row = db.query(SystemSetting).filter(SystemSetting.key == "company").first()
    if row:
        return {**DEFAULTS, **row.value}
    return DEFAULTS.copy()


def pricing_hidden(db: Session) -> bool:
    return bool(_get_settings(db).get("hide_pricing", True))


@router.get("/display", response_model=DisplaySettingsResponse)
def get_display_settings(
    _: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    s = _get_settings(db)
    return DisplaySettingsResponse(
        hide_pricing=bool(s.get("hide_pricing", True)),
        booking_url=s.get("booking_url") or "",
        booking_hide_pricing=bool(s.get("booking_hide_pricing", True)),
        default_va_hourly_rate=s.get("default_va_hourly_rate", "75.00"),
    )


@router.get("", response_model=SettingsResponse)
def get_settings(
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    return SettingsResponse(**_get_settings(db))


@router.put("", response_model=SettingsResponse)
def update_settings(
    body: SettingsUpdate,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    current = _get_settings(db)
    updates = body.model_dump(exclude_unset=True)
    if "default_va_hourly_rate" in updates and updates["default_va_hourly_rate"] is not None:
        updates["default_va_hourly_rate"] = str(updates["default_va_hourly_rate"])
    current.update(updates)

    row = db.query(SystemSetting).filter(SystemSetting.key == "company").first()
    if row:
        row.value = current
    else:
        db.add(SystemSetting(key="company", value=current))
    db.commit()
    return SettingsResponse(**current)
