"""add is_active to sub_clients

Revision ID: 002
Revises: 001
Create Date: 2026-07-01
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sub_clients", sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False))


def downgrade() -> None:
    op.drop_column("sub_clients", "is_active")
