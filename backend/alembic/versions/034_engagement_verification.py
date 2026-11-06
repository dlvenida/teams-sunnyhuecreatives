"""Engagement screenshot verification for one VA

Revision ID: 034
Revises: 033

Adds a durable flag on the VA record and the verification tables. This does
not change tasks, clock entries, work logs, payroll, or invoices.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "034"
down_revision: Union[str, None] = "033"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "vas",
        sa.Column("engagement_verification", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "engagement_targets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("client_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("platform", sa.String(20), nullable=False),
        sa.Column("dm_min", sa.Integer(), nullable=True),
        sa.Column("dm_max", sa.Integer(), nullable=True),
        sa.Column("comment_min", sa.Integer(), nullable=True),
        sa.Column("comment_max", sa.Integer(), nullable=True),
        sa.Column("share_min", sa.Integer(), nullable=True),
        sa.Column("share_max", sa.Integer(), nullable=True),
        sa.Column("reporting_timezone", sa.String(100), nullable=True),
        sa.Column("account_names", postgresql.JSONB(), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("client_id", "platform", name="uq_engagement_target_client_platform"),
    )
    op.create_table(
        "engagement_verifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("va_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vas.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("client_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("platform", sa.String(20), nullable=False),
        sa.Column("work_date", sa.Date(), nullable=False, index=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("approval_note", sa.Text(), nullable=True),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejected_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("rejection_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "engagement_screenshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("verification_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("engagement_verifications.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("storage_key", sa.String(512), nullable=False, server_default=""),
        sa.Column("storage_backend", sa.String(20), nullable=False, server_default="local"),
        sa.Column("original_name", sa.String(255), nullable=False, server_default="screenshot"),
        sa.Column("content_type", sa.String(100), nullable=False, server_default="image/avif"),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("extraction_status", sa.String(20), nullable=False, server_default="unclear"),
        sa.Column("extraction_note", sa.Text(), nullable=True),
        sa.Column("platform_seen", sa.String(20), nullable=True),
        sa.Column("account_seen", sa.String(255), nullable=True),
        sa.Column("alerts", postgresql.JSONB(), nullable=True),
        sa.Column("uploaded_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "engagement_activities",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("verification_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("engagement_verifications.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("screenshot_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("engagement_screenshots.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("activity_type", sa.String(30), nullable=False, server_default="unknown"),
        sa.Column("username_raw", sa.String(255), nullable=True),
        sa.Column("username_key", sa.String(255), nullable=True),
        sa.Column("activity_date", sa.Date(), nullable=True),
        sa.Column("activity_time", sa.Time(), nullable=True),
        sa.Column("body_text", sa.Text(), nullable=True),
        sa.Column("confidence", sa.String(10), nullable=False, server_default="low"),
        sa.Column("platform_hint", sa.String(20), nullable=True),
        sa.Column("account_hint", sa.String(255), nullable=True),
        sa.Column("share_evidence", sa.Boolean(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(30), nullable=False, server_default="needs_review"),
        sa.Column("counted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("alerts", postgresql.JSONB(), nullable=True),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column("decision", sa.String(20), nullable=True),
        sa.Column("decision_reason", sa.Text(), nullable=True),
        sa.Column("decision_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("decision_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("original_result", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "engagement_audits",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("verification_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("engagement_verifications.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("activity_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("engagement_activities.id", ondelete="SET NULL"), nullable=True),
        sa.Column("client_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("clients.id", ondelete="SET NULL"), nullable=True),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("actor_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("actor_role", sa.String(30), nullable=False, server_default=""),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("original_result", postgresql.JSONB(), nullable=True),
        sa.Column("new_result", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("engagement_audits")
    op.drop_table("engagement_activities")
    op.drop_table("engagement_screenshots")
    op.drop_table("engagement_verifications")
    op.drop_table("engagement_targets")
    op.drop_column("vas", "engagement_verification")
