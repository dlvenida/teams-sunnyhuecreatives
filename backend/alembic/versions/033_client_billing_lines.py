"""Saved client billing lines for flexible invoices

Revision ID: 033
Revises: 032

Each client keeps a list of default billing lines. An invoice copies those
lines for one period. Editing the invoice does not change the saved setup,
and generating an invoice does not change VA time logs.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "033"
down_revision: Union[str, None] = "032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "client_billing_lines",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("client_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("billing_type", sa.String(length=20), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("default_hours", sa.Numeric(8, 2), nullable=True),
        sa.Column("default_rate", sa.Numeric(12, 2), nullable=True),
        sa.Column("default_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.add_column("invoice_line_items", sa.Column("line_kind", sa.String(length=20), nullable=True))
    op.add_column(
        "invoice_line_items",
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True),
    )
    op.alter_column("invoices", "client_id", existing_type=postgresql.UUID(as_uuid=True), nullable=True)
    op.add_column("invoices", sa.Column("one_off_name", sa.String(length=255), nullable=True))
    op.add_column("invoices", sa.Column("one_off_email", sa.String(length=255), nullable=True))
    op.add_column("invoices", sa.Column("one_off_business", sa.String(length=255), nullable=True))
    op.add_column("invoices", sa.Column("one_off_address", sa.Text(), nullable=True))
    op.add_column("invoices", sa.Column("currency", sa.String(length=10), nullable=False, server_default="USD"))


def downgrade() -> None:
    op.drop_column("invoices", "currency")
    op.drop_column("invoices", "one_off_address")
    op.drop_column("invoices", "one_off_business")
    op.drop_column("invoices", "one_off_email")
    op.drop_column("invoices", "one_off_name")
    op.alter_column("invoices", "client_id", existing_type=postgresql.UUID(as_uuid=True), nullable=False)
    op.drop_column("invoice_line_items", "project_id")
    op.drop_column("invoice_line_items", "line_kind")
    op.drop_table("client_billing_lines")
