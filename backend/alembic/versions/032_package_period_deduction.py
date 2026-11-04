"""A Fixed Package override can store a deduction for the period

Revision ID: 032
Revises: 031

031 adds Approved tasks and staff notes. This column comes after that so the
two open pull requests share one Alembic head when both are on main.
The deduction is subtracted from that period's package amount. It does not
change the saved VA Rate.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "032"
down_revision: Union[str, None] = "031"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("package_period_overrides", sa.Column("deduction", sa.Numeric(12, 2), nullable=True))


def downgrade() -> None:
    op.drop_column("package_period_overrides", "deduction")
