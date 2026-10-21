"""VA rates, client packages, work-log attachments, package_hours billing

Revision ID: 016
Revises: 015
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "016"
down_revision: Union[str, None] = "015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    # Enum ADD VALUE cannot run inside a transaction block on some PG versions
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE billing_type ADD VALUE IF NOT EXISTS 'package_hours'")
        op.execute("ALTER TYPE invoice_billing_type ADD VALUE IF NOT EXISTS 'package_hours'")

    pay_type = postgresql.ENUM("hourly", "package", name="pay_type", create_type=False)
    rate_status = postgresql.ENUM("pending", "approved", "rejected", name="rate_status", create_type=False)
    pay_type.create(op.get_bind(), checkfirst=True)
    rate_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "va_rates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("va_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vas.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("client_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("pay_type", pay_type, nullable=False),
        sa.Column("currency", postgresql.ENUM("PHP", "USD", name="currency", create_type=False), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("status", rate_status, nullable=False, server_default="pending", index=True),
        sa.Column("set_by_admin", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("effective_from", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )

    op.create_table(
        "work_log_attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("work_log_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("work_logs.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("storage_key", sa.String(512), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False, server_default=""),
        sa.Column("content_type", sa.String(100), nullable=False, server_default="image/jpeg"),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("uploaded_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )

    op.create_table(
        "client_packages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("client_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("billing_type", postgresql.ENUM("hourly", "fixed", "package_hours", name="billing_type", create_type=False), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("included_hours", sa.Numeric(8, 2), nullable=True),
        sa.Column("overage_rate", sa.Numeric(12, 2), nullable=True),
        sa.Column("currency", postgresql.ENUM("PHP", "USD", name="currency", create_type=False), nullable=False, server_default="USD"),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )

    # Backfill one default package per existing client
    op.execute(
        """
        INSERT INTO client_packages (id, client_id, name, billing_type, amount, currency, is_default, is_active)
        SELECT gen_random_uuid(), id, name || ' — Default', billing_type, COALESCE(default_rate, 0), 'USD', true, true
        FROM clients
        """
    )


def downgrade() -> None:
    op.drop_table("client_packages")
    op.drop_table("work_log_attachments")
    op.drop_table("va_rates")
    op.execute("DROP TYPE IF EXISTS rate_status")
    op.execute("DROP TYPE IF EXISTS pay_type")
