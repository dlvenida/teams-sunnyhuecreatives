"""Screenshot verification records for Arby Mae Malumay's engagement tasks.

These tables hang off existing tasks. They do not create Task Board items and
they do not store rates, pay, or invoice amounts.
"""
import uuid
from datetime import date, datetime, time

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, Time, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class EngagementTarget(Base):
    """Per-client daily targets. Management can change these with a reason."""

    __tablename__ = "engagement_targets"
    __table_args__ = (UniqueConstraint("client_id", "platform", name="uq_engagement_target_client_platform"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    platform: Mapped[str] = mapped_column(String(20))
    dm_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dm_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    comment_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    comment_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    share_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    share_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reporting_timezone: Mapped[str | None] = mapped_column(String(100), nullable=True)
    account_names: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class EngagementVerification(Base):
    """One verification record per existing engagement task."""

    __tablename__ = "engagement_verifications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), unique=True, index=True)
    va_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vas.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    platform: Mapped[str] = mapped_column(String(20))
    work_date: Mapped[date] = mapped_column(Date, index=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approval_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    rejection_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    screenshots: Mapped[list["EngagementScreenshot"]] = relationship(back_populates="verification", cascade="all, delete-orphan")
    activities: Mapped[list["EngagementActivity"]] = relationship(back_populates="verification", cascade="all, delete-orphan")
    audits: Mapped[list["EngagementAudit"]] = relationship(back_populates="verification", cascade="all, delete-orphan")


class EngagementScreenshot(Base):
    __tablename__ = "engagement_screenshots"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    verification_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("engagement_verifications.id", ondelete="CASCADE"), index=True)
    storage_key: Mapped[str] = mapped_column(String(512), default="")
    storage_backend: Mapped[str] = mapped_column(String(20), default="local")
    original_name: Mapped[str] = mapped_column(String(255), default="screenshot")
    content_type: Mapped[str] = mapped_column(String(100), default="image/avif")
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    extraction_status: Mapped[str] = mapped_column(String(20), default="unclear")
    extraction_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    platform_seen: Mapped[str | None] = mapped_column(String(20), nullable=True)
    account_seen: Mapped[str | None] = mapped_column(String(255), nullable=True)
    alerts: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    verification: Mapped["EngagementVerification"] = relationship(back_populates="screenshots")
    activities: Mapped[list["EngagementActivity"]] = relationship(back_populates="screenshot")


class EngagementActivity(Base):
    __tablename__ = "engagement_activities"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    verification_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("engagement_verifications.id", ondelete="CASCADE"), index=True)
    screenshot_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("engagement_screenshots.id", ondelete="CASCADE"), index=True)
    activity_type: Mapped[str] = mapped_column(String(30), default="unknown")
    username_raw: Mapped[str | None] = mapped_column(String(255), nullable=True)
    username_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    activity_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    activity_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    body_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[str] = mapped_column(String(10), default="low")
    platform_hint: Mapped[str | None] = mapped_column(String(20), nullable=True)
    account_hint: Mapped[str | None] = mapped_column(String(255), nullable=True)
    share_evidence: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(30), default="needs_review")
    counted: Mapped[bool] = mapped_column(Boolean, default=False)
    alerts: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    decision: Mapped[str | None] = mapped_column(String(20), nullable=True)
    decision_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    decision_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    decision_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    original_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    verification: Mapped["EngagementVerification"] = relationship(back_populates="activities")
    screenshot: Mapped["EngagementScreenshot"] = relationship(back_populates="activities")


class EngagementAudit(Base):
    __tablename__ = "engagement_audits"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    verification_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("engagement_verifications.id", ondelete="CASCADE"), nullable=True, index=True)
    activity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("engagement_activities.id", ondelete="SET NULL"), nullable=True)
    client_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="SET NULL"), nullable=True)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    actor_name: Mapped[str] = mapped_column(String(255), default="")
    actor_role: Mapped[str] = mapped_column(String(30), default="")
    action: Mapped[str] = mapped_column(String(40))
    reason: Mapped[str] = mapped_column(Text, default="")
    original_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    new_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    verification: Mapped["EngagementVerification | None"] = relationship(back_populates="audits")
