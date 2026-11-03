"""Package rates can be paid monthly or bi-weekly

Revision ID: 028
Revises: 027

Null means Monthly. Existing package rates are left null so they keep paying
the full monthly amount. New rates choose Bi-weekly or Monthly explicitly.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "028"
down_revision: Union[str, None] = "027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("va_rates", sa.Column("payment_frequency", sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column("va_rates", "payment_frequency")
