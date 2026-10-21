"""quick-login PIN on users (hash + brute-force lockout)

Revision ID: 014
Revises: 013
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "014"
down_revision: Union[str, None] = "013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("pin_hash", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("pin_failed_attempts", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("users", sa.Column("pin_locked_until", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "pin_locked_until")
    op.drop_column("users", "pin_failed_attempts")
    op.drop_column("users", "pin_hash")
