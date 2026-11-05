"""Task hourly or package billing

Revision ID: 034
Revises: 033

A task is Hourly by default. Package tasks stay on the time log and off the
hourly invoice lines. Several tasks can share one package line. The hour
breakdown and the package-time note are chosen per invoice.
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
    op.add_column("tasks", sa.Column("billing_mode", sa.String(length=20), nullable=False, server_default="hourly"))
    op.add_column(
        "tasks",
        sa.Column(
            "package_line_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("client_billing_lines.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_tasks_package_line_id", "tasks", ["package_line_id"])
    op.add_column("invoices", sa.Column("show_hourly_breakdown", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("invoices", sa.Column("show_package_time", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("invoices", "show_package_time")
    op.drop_column("invoices", "show_hourly_breakdown")
    op.drop_index("ix_tasks_package_line_id", table_name="tasks")
    op.drop_column("tasks", "package_line_id")
    op.drop_column("tasks", "billing_mode")
