"""Client approval status for auditor proposals

Revision ID: 019
Revises: 018
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "019"
down_revision: Union[str, None] = "018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    approval = postgresql.ENUM(
        "pending", "approved", "rejected", name="client_approval_status", create_type=False
    )
    approval.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "clients",
        sa.Column(
            "approval_status",
            approval,
            nullable=False,
            server_default="approved",
        ),
    )
    op.add_column(
        "clients",
        sa.Column("proposed_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column("clients", sa.Column("proposed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "clients",
        sa.Column("reviewed_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column("clients", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_clients_approval_status", "clients", ["approval_status"])


def downgrade() -> None:
    op.drop_index("ix_clients_approval_status", table_name="clients")
    op.drop_column("clients", "reviewed_at")
    op.drop_column("clients", "reviewed_by")
    op.drop_column("clients", "proposed_at")
    op.drop_column("clients", "proposed_by")
    op.drop_column("clients", "approval_status")
    sa.Enum(name="client_approval_status").drop(op.get_bind(), checkfirst=True)
