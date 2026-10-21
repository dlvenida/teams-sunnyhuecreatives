"""usernames for PIN login (username + 6-digit PIN)

Revision ID: 015
Revises: 014
"""
import re
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "015"
down_revision: Union[str, None] = "014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("username", sa.String(100), nullable=True))
    # Backfill: username = sanitized email local part, deduplicated with a numeric suffix
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, email FROM users ORDER BY created_at")).fetchall()
    used: set[str] = set()
    for user_id, email in rows:
        base = re.sub(r"[^a-z0-9._-]", "", (email or "").split("@")[0].lower()).strip("._-") or "user"
        candidate, n = base, 2
        while candidate in used:
            candidate = f"{base}{n}"; n += 1
        used.add(candidate)
        bind.execute(sa.text("UPDATE users SET username = :u WHERE id = :id"), {"u": candidate, "id": user_id})
    op.create_index("ix_users_username", "users", ["username"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_username", table_name="users")
    op.drop_column("users", "username")
