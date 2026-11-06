"""Who may use engagement verification.

The feature is turned on for Arby Mae Malumay by matching her saved name once.
Later checks use the flag on her VA record.
"""
from __future__ import annotations

from sqlalchemy.orm import Session, joinedload

from app.models import UserRole, VA
from app.services.engagement_rules import is_arby_name


def sync_engagement_subject(db: Session) -> None:
    """Enable the flag when a VA record is Arby Mae Malumay. Never turns it off."""
    rows = db.query(VA).options(joinedload(VA.user)).all()
    changed = False
    for va in rows:
        user = va.user
        names = [va.name]
        if user is not None:
            names.extend([user.display_name, user.legal_name])
        if is_arby_name(*names) and not va.engagement_verification:
            va.engagement_verification = True
            changed = True
    if changed:
        db.commit()


def engagement_subjects(db: Session) -> list[VA]:
    return (
        db.query(VA)
        .options(joinedload(VA.user))
        .filter(VA.engagement_verification.is_(True), VA.is_active.is_(True))
        .order_by(VA.name)
        .all()
    )


def is_manager(current) -> bool:
    return current.role in (UserRole.admin, UserRole.auditor)
