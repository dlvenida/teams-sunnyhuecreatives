"""Who may use engagement verification.

The flag on the VA record is the access check. Startup, and each access read,
turns it on for Virtual Assistants who are assigned Instagram, Facebook, or
LinkedIn engagement tasks. An admin choice is kept and is not overwritten.
"""
from __future__ import annotations

from sqlalchemy.orm import Session, joinedload

from app.models import Task, User, UserRole, VA
from app.services.engagement_rules import platform_from_title


def va_has_engagement_work(db: Session, va_id) -> bool:
    titles = db.query(Task.title).filter(Task.assignee_va_id == va_id).all()
    return any(platform_from_title(title) for (title,) in titles)


def sync_engagement_subject(db: Session) -> None:
    """Turn the flag on for Community Engagement VAs. Never turns a manual choice off."""
    rows = (
        db.query(VA)
        .options(joinedload(VA.user))
        .join(User, VA.user_id == User.id)
        .filter(VA.is_active.is_(True), User.role == UserRole.va, User.is_active.is_(True))
        .all()
    )
    changed = False
    for va in rows:
        if va.engagement_verification_manual:
            continue
        if va_has_engagement_work(db, va.id) and not va.engagement_verification:
            va.engagement_verification = True
            changed = True
    if changed:
        db.commit()


def set_engagement_access(db: Session, va_id, enabled: bool) -> VA:
    va = (
        db.query(VA)
        .options(joinedload(VA.user))
        .filter(VA.id == va_id, VA.is_active.is_(True))
        .first()
    )
    if va is None or va.user is None or va.user.role != UserRole.va:
        from fastapi import HTTPException
        raise HTTPException(404, "Virtual Assistant not found")
    va.engagement_verification = bool(enabled)
    va.engagement_verification_manual = True
    db.commit()
    db.refresh(va)
    return va


def engagement_roster(db: Session) -> list[dict]:
    sync_engagement_subject(db)
    rows = (
        db.query(VA)
        .options(joinedload(VA.user))
        .join(User, VA.user_id == User.id)
        .filter(VA.is_active.is_(True), User.role == UserRole.va, User.is_active.is_(True))
        .order_by(VA.name)
        .all()
    )
    return [
        {
            "va_id": str(va.id),
            "name": va.name,
            "enabled": bool(va.engagement_verification),
            "manual": bool(va.engagement_verification_manual),
            "has_engagement_tasks": va_has_engagement_work(db, va.id),
        }
        for va in rows
    ]


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
