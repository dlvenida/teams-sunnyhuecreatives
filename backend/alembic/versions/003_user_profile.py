"""user profile fields

Revision ID: 003
Revises: 002
Create Date: 2026-07-01
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("display_name", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("profile_photo_path", sa.String(512), nullable=True))
    op.add_column("users", sa.Column("phone", sa.String(50), nullable=True))
    op.add_column("users", sa.Column("address", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("wise_email", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("ph_bank_account", sa.String(100), nullable=True))
    op.add_column("users", sa.Column("ph_bank_account_name", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("ph_bank_name", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("pending_email", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("email_verification_code", sa.String(10), nullable=True))
    op.add_column("users", sa.Column("email_verification_expires_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "email_verification_expires_at")
    op.drop_column("users", "email_verification_code")
    op.drop_column("users", "pending_email")
    op.drop_column("users", "ph_bank_name")
    op.drop_column("users", "ph_bank_account_name")
    op.drop_column("users", "ph_bank_account")
    op.drop_column("users", "wise_email")
    op.drop_column("users", "address")
    op.drop_column("users", "phone")
    op.drop_column("users", "profile_photo_path")
    op.drop_column("users", "display_name")
