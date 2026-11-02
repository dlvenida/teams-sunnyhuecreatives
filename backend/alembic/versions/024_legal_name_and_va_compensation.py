"""Legal name, VA compensation mode, and timesheet rejected status

Revision ID: 024
Revises: 023
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "024"
down_revision: Union[str, None] = "023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("legal_name", sa.String(length=255), nullable=True))
    op.add_column(
        "vas",
        sa.Column("compensation_mode", sa.String(length=32), nullable=False, server_default="hourly"),
    )
    op.add_column("vas", sa.Column("va_package_amount", sa.Numeric(12, 2), nullable=True))
    op.add_column(
        "vas",
        sa.Column("va_package_currency", sa.String(length=10), nullable=True, server_default="USD"),
    )
    # New enum value cannot be used in the same transaction on older Postgres.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE timesheet_status ADD VALUE IF NOT EXISTS 'rejected'")


def downgrade() -> None:
    op.execute("UPDATE timesheet_submissions SET status = 'submitted' WHERE status::text = 'rejected'")
    op.execute("ALTER TABLE timesheet_submissions ALTER COLUMN status DROP DEFAULT")
    op.execute("ALTER TYPE timesheet_status RENAME TO timesheet_status_old")
    op.execute("CREATE TYPE timesheet_status AS ENUM ('submitted', 'reviewed')")
    op.execute(
        "ALTER TABLE timesheet_submissions ALTER COLUMN status TYPE timesheet_status "
        "USING status::text::timesheet_status"
    )
    op.execute("ALTER TABLE timesheet_submissions ALTER COLUMN status SET DEFAULT 'submitted'")
    op.execute("DROP TYPE timesheet_status_old")
    op.drop_column("vas", "va_package_currency")
    op.drop_column("vas", "va_package_amount")
    op.drop_column("vas", "compensation_mode")
    op.drop_column("users", "legal_name")
