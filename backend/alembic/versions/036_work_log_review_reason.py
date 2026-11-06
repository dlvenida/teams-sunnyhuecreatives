"""Hold duplicate time logs for review instead of rejecting them

Revision ID: 036
Revises: 035
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "036"
down_revision: Union[str, None] = "035"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("work_logs", sa.Column("review_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("work_logs", "review_reason")
