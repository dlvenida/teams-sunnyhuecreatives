"""collaboration: mentions/reactions/attachments on task comments, project discussion + meet-ups

Revision ID: 012
Revises: 011
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "012"
down_revision: Union[str, None] = "011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _comment_cols(prefix_table: str) -> None:
    pass


def upgrade() -> None:
    # Task comments: threading, mentions, pinning, edit marker, author role
    op.add_column("task_comments", sa.Column("author_role", sa.String(30), server_default="va"))
    op.add_column("task_comments", sa.Column("parent_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("task_comments.id", ondelete="CASCADE"), nullable=True))
    op.create_index("ix_task_comments_parent_id", "task_comments", ["parent_id"])
    op.add_column("task_comments", sa.Column("mentions", postgresql.JSONB(), nullable=True))
    op.add_column("task_comments", sa.Column("is_pinned", sa.Boolean(), server_default=sa.false()))
    op.add_column("task_comments", sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "project_comments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("author_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_name", sa.String(255), server_default=""),
        sa.Column("author_role", sa.String(30), server_default="va"),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("project_comments.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("mentions", postgresql.JSONB(), nullable=True),
        sa.Column("is_pinned", sa.Boolean(), server_default=sa.false()),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "comment_reactions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("scope", sa.String(20), nullable=False, index=True),
        sa.Column("comment_id", postgresql.UUID(as_uuid=True), nullable=False, index=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("user_name", sa.String(255), server_default=""),
        sa.Column("emoji", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("scope", "comment_id", "user_id", "emoji", name="uq_comment_reaction"),
    )
    op.create_table(
        "comment_attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("scope", sa.String(20), nullable=False, index=True),
        sa.Column("scope_id", postgresql.UUID(as_uuid=True), nullable=False, index=True),
        sa.Column("comment_id", postgresql.UUID(as_uuid=True), nullable=True, index=True),
        sa.Column("uploaded_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("uploader_name", sa.String(255), server_default=""),
        sa.Column("storage_key", sa.String(512), nullable=False),
        sa.Column("storage_backend", sa.String(20), server_default="local"),
        sa.Column("original_name", sa.String(255), server_default="image"),
        sa.Column("original_size", sa.Integer(), server_default="0"),
        sa.Column("size_bytes", sa.Integer(), server_default="0"),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("original_width", sa.Integer(), nullable=True),
        sa.Column("original_height", sa.Integer(), nullable=True),
        sa.Column("format", sa.String(10), server_default="avif"),
        sa.Column("is_annotation", sa.Boolean(), server_default=sa.false()),
        sa.Column("annotated_from_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "project_meetups",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("location", sa.String(500), nullable=True),
        sa.Column("attendees", postgresql.JSONB(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by_name", sa.String(255), server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("project_meetups")
    op.drop_table("comment_attachments")
    op.drop_table("comment_reactions")
    op.drop_table("project_comments")
    op.drop_column("task_comments", "edited_at")
    op.drop_column("task_comments", "is_pinned")
    op.drop_column("task_comments", "mentions")
    op.drop_index("ix_task_comments_parent_id", table_name="task_comments")
    op.drop_column("task_comments", "parent_id")
    op.drop_column("task_comments", "author_role")
