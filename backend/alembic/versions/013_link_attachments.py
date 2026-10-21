"""link attachments (Google Drive / Dropbox) on comments

Revision ID: 013
Revises: 012
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "013"
down_revision: Union[str, None] = "012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("comment_attachments", sa.Column("link_url", sa.Text(), nullable=True))
    op.add_column("comment_attachments", sa.Column("provider", sa.String(30), nullable=True))
    op.alter_column("comment_attachments", "storage_key", server_default="")


def downgrade() -> None:
    op.drop_column("comment_attachments", "provider")
    op.drop_column("comment_attachments", "link_url")
