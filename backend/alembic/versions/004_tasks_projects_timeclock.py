"""projects, tasks, time clock, extended profile

Revision ID: 004
Revises: 003
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Extended profile
    op.add_column("users", sa.Column("job_title", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("bio", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("timezone", sa.String(100), nullable=True))
    op.add_column("users", sa.Column("skills", postgresql.JSONB(), nullable=True))
    op.add_column("users", sa.Column("emergency_contact_name", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("emergency_contact_phone", sa.String(50), nullable=True))
    op.add_column("users", sa.Column("emergency_contact_relationship", sa.String(100), nullable=True))
    op.add_column("users", sa.Column("hire_date", sa.Date(), nullable=True))
    op.add_column("users", sa.Column("date_of_birth", sa.Date(), nullable=True))
    op.add_column("users", sa.Column("linkedin_url", sa.String(512), nullable=True))
    op.add_column("users", sa.Column("portfolio_url", sa.String(512), nullable=True))
    op.add_column("users", sa.Column("status_message", sa.String(255), nullable=True))

    # Enums
    project_status = postgresql.ENUM("active", "on_hold", "completed", "archived", name="project_status", create_type=False)
    cadence = postgresql.ENUM("weekly", "biweekly", "monthly", name="cadence", create_type=False)
    task_status = postgresql.ENUM("todo", "in_progress", "in_review", "done", "blocked", name="task_status", create_type=False)
    task_priority = postgresql.ENUM("low", "medium", "high", "urgent", name="task_priority", create_type=False)
    clock_status = postgresql.ENUM("running", "paused", "completed", name="clock_status", create_type=False)
    for e in (project_status, cadence, task_status, task_priority, clock_status):
        e.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("client_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sub_client_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sub_clients.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("color", sa.String(20), server_default="#ec4899"),
        sa.Column("status", project_status, server_default="active"),
        sa.Column("cadence", cadence, server_default="weekly"),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("client_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sub_client_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sub_clients.id", ondelete="SET NULL"), nullable=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assignee_va_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vas.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", task_status, server_default="todo"),
        sa.Column("priority", task_priority, server_default="medium"),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("estimated_hours", sa.Numeric(8, 2), nullable=True),
        sa.Column("position", sa.Integer(), server_default="0"),
        sa.Column("tags", postgresql.JSONB(), nullable=True),
        sa.Column("checklist", postgresql.JSONB(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "task_comments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_name", sa.String(255), server_default=""),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    # WorkLog links
    op.add_column("work_logs", sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True))
    op.add_column("work_logs", sa.Column("task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True))
    op.add_column("work_logs", sa.Column("clock_in_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("work_logs", sa.Column("clock_out_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("work_logs", sa.Column("source", sa.String(20), server_default="manual"))

    op.create_table(
        "time_clock_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("va_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vas.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True),
        sa.Column("client_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("clients.id", ondelete="SET NULL"), nullable=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True),
        sa.Column("work_log_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("work_logs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("clock_in", sa.DateTime(timezone=True), nullable=False),
        sa.Column("clock_out", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("total_paused_seconds", sa.Integer(), server_default="0"),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("status", clock_status, server_default="running"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("time_clock_entries")
    op.drop_column("work_logs", "source")
    op.drop_column("work_logs", "clock_out_at")
    op.drop_column("work_logs", "clock_in_at")
    op.drop_column("work_logs", "task_id")
    op.drop_column("work_logs", "project_id")
    op.drop_table("task_comments")
    op.drop_table("tasks")
    op.drop_table("projects")
    for col in ("status_message","portfolio_url","linkedin_url","date_of_birth","hire_date","emergency_contact_relationship","emergency_contact_phone","emergency_contact_name","skills","timezone","bio","job_title"):
        op.drop_column("users", col)
