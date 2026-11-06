"""Store the client task breakdown chosen when an invoice is generated.

Revision ID: 037
Revises: 036
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "037"
down_revision: Union[str, None] = "036"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "invoices",
        sa.Column("include_task_breakdown", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("invoices", sa.Column("task_breakdown", postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column("invoices", "task_breakdown")
    op.drop_column("invoices", "include_task_breakdown")
