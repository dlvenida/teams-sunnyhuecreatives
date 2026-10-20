"""auditor user role

Revision ID: 009
Revises: 008
"""
from typing import Sequence, Union
from alembic import op

revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'auditor'")


def downgrade() -> None:
    pass  # Postgres cannot easily drop enum values; leave it.
