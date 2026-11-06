"""Community Engagement VA screenshot verification flag

Revision ID: 035
Revises: 034

An admin can lock the screenshot-check flag so startup does not change it.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "035"
down_revision: Union[str, None] = "034"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "vas",
        sa.Column("engagement_verification_manual", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("vas", "engagement_verification_manual")
