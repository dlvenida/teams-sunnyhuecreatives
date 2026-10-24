from datetime import date, datetime, time
from decimal import Decimal
import re
from typing import Annotated, Any
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, Field

from app.models import (
    BillingType,
    Cadence,
    ClientApprovalStatus,
    ClockStatus,
    Currency,
    InvoiceStatus,
    PaymentMethod,
    PayType,
    ProjectStatus,
    RateStatus,
    TaskPriority,
    TaskRecurrence,
    TaskStatus,
    UserRole,
    WorkLogStatus,
)


def _normalize_email(value: str) -> str:
    email = value.strip().lower()
    if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email):
        raise ValueError("Invalid email address")
    return email


AppEmail = Annotated[str, BeforeValidator(_normalize_email)]


# Auth
class LoginRequest(BaseModel):
    email: AppEmail
    password: str


class PinLoginRequest(BaseModel):
    """Quick login: username + 6-digit PIN (email still accepted for older clients)."""
    username: str | None = None
    email: str | None = None
    pin: str = Field(pattern=r"^\d{6}$")


class SetPinRequest(BaseModel):
    current_password: str
    pin: str = Field(pattern=r"^\d{6}$")


class RemovePinRequest(BaseModel):
    current_password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    username: str | None = None
    role: UserRole
    must_change_password: bool = False
    va_id: UUID | None = None
    name: str | None = None
    user_id: UUID | None = None
    is_impersonating: bool = False
    impersonated_by: UUID | None = None
    impersonated_by_name: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class CreateVAUserRequest(BaseModel):
    email: AppEmail
    password: str = Field(min_length=8)
    name: str
    currency: Currency


class CreateAppUserRequest(BaseModel):
    email: AppEmail
    password: str = Field(min_length=8)
    name: str
    role: str = "auditor"  # admin | auditor | va
    currency: Currency = Currency.PHP


class AppUserResponse(BaseModel):
    id: UUID
    email: str
    username: str | None = None
    name: str
    role: str
    is_active: bool
    va_id: UUID | None = None
    auditing_count: int = 0


# Clients
class ClientCreate(BaseModel):
    name: str
    billing_type: BillingType
    default_rate: Decimal | None = None
    included_hours: Decimal | None = None
    overage_rate: Decimal | None = None


class ClientUpdate(BaseModel):
    name: str | None = None
    billing_type: BillingType | None = None
    default_rate: Decimal | None = None
    is_active: bool | None = None
    included_hours: Decimal | None = None
    overage_rate: Decimal | None = None


class ClientResponse(BaseModel):
    id: UUID
    name: str
    billing_type: BillingType
    default_rate: Decimal | None
    is_active: bool
    approval_status: ClientApprovalStatus = ClientApprovalStatus.approved
    proposed_by_name: str | None = None
    proposed_at: datetime | None = None
    reviewed_at: datetime | None = None

    model_config = {"from_attributes": True}


class ClientApproveRequest(BaseModel):
    billing_type: BillingType | None = None
    default_rate: Decimal | None = None
    included_hours: Decimal | None = None
    overage_rate: Decimal | None = None


class SubClientCreate(BaseModel):
    client_id: UUID
    name: str


class SubClientUpdate(BaseModel):
    client_id: UUID | None = None
    name: str | None = None
    is_active: bool | None = None


class SubClientResponse(BaseModel):
    id: UUID
    client_id: UUID
    name: str
    is_active: bool

    model_config = {"from_attributes": True}


# VAs
class VAResponse(BaseModel):
    id: UUID
    name: str
    currency: Currency
    is_active: bool
    email: str | None = None
    user_id: UUID | None = None
    reviewer_user_id: UUID | None = None
    reviewer_name: str | None = None

    model_config = {"from_attributes": True}


class VAReviewerUpdate(BaseModel):
    reviewer_user_id: UUID | None = None


class VAUpdate(BaseModel):
    name: str | None = None
    email: AppEmail | None = None
    currency: Currency | None = None
    is_active: bool | None = None


class AdminResetPasswordRequest(BaseModel):
    password: str = Field(min_length=8)


class VADelegateRequest(BaseModel):
    delegate_to_va_id: UUID
    include_done_tasks: bool = True
    transfer_logs: bool = True


# Profile
class NotificationPreferences(BaseModel):
    popup_enabled: bool = True
    sound_enabled: bool = True
    sound_id: str = "chime"  # chime | bell | ping | loud
    popup_types: dict[str, bool] = Field(default_factory=lambda: {
        "comment": True,
        "task": True,
        "log": True,
        "clock": True,
        "delegation": True,
        "invoice": True,
        "system": True,
    })


class ProfileUpdate(BaseModel):
    username: str | None = None
    display_name: str | None = None
    phone: str | None = None
    address: str | None = None
    wise_email: str | None = None
    ph_bank_account: str | None = None
    ph_bank_account_name: str | None = None
    ph_bank_name: str | None = None
    job_title: str | None = None
    bio: str | None = None
    timezone: str | None = None
    skills: list[str] | None = None
    emergency_contact_name: str | None = None
    emergency_contact_phone: str | None = None
    emergency_contact_relationship: str | None = None
    hire_date: date | None = None
    date_of_birth: date | None = None
    linkedin_url: str | None = None
    portfolio_url: str | None = None
    status_message: str | None = None
    notification_preferences: NotificationPreferences | None = None


class EmailChangeRequest(BaseModel):
    new_email: AppEmail


class EmailChangeConfirm(BaseModel):
    code: str = Field(min_length=6, max_length=6)


class ProfileResponse(BaseModel):
    id: UUID
    email: str
    username: str | None = None
    pending_email: str | None = None
    role: UserRole
    display_name: str
    has_profile_photo: bool = False
    phone: str | None = None
    address: str | None = None
    wise_email: str | None = None
    ph_bank_account: str | None = None
    ph_bank_account_name: str | None = None
    ph_bank_name: str | None = None
    currency: Currency | None = None
    must_change_password: bool = False
    has_pin: bool = False
    job_title: str | None = None
    bio: str | None = None
    timezone: str | None = None
    skills: list[str] | None = None
    emergency_contact_name: str | None = None
    emergency_contact_phone: str | None = None
    emergency_contact_relationship: str | None = None
    hire_date: date | None = None
    tenure_years: int | None = None
    tenure_months: int | None = None
    tenure_label: str | None = None
    date_of_birth: date | None = None
    linkedin_url: str | None = None
    portfolio_url: str | None = None
    status_message: str | None = None
    notification_preferences: NotificationPreferences | None = None
    created_at: datetime | None = None


# Projects / Tasks / Time clock
class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    client_id: UUID
    sub_client_id: UUID | None = None
    description: str | None = None
    color: str = "#ec4899"
    status: ProjectStatus = ProjectStatus.active
    cadence: Cadence = Cadence.weekly
    start_date: date | None = None
    due_date: date | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    client_id: UUID | None = None
    sub_client_id: UUID | None = None
    description: str | None = None
    color: str | None = None
    status: ProjectStatus | None = None
    cadence: Cadence | None = None
    start_date: date | None = None
    due_date: date | None = None


class ProjectResponse(BaseModel):
    id: UUID
    client_id: UUID
    client_name: str | None = None
    sub_client_id: UUID | None = None
    sub_client_name: str | None = None
    name: str
    description: str | None = None
    color: str
    status: ProjectStatus
    cadence: Cadence
    start_date: date | None = None
    due_date: date | None = None
    task_total: int = 0
    task_done: int = 0
    task_in_progress: int = 0
    total_hours: Decimal = Decimal("0")
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    description: str | None = None
    client_id: UUID
    sub_client_id: UUID | None = None
    project_id: UUID | None = None
    assignee_va_id: UUID | None = None
    status: TaskStatus = TaskStatus.todo
    priority: TaskPriority = TaskPriority.medium
    start_date: date | None = None
    due_date: date | None = None
    estimated_hours: Decimal | None = None
    tags: list[str] | None = None
    checklist: list[dict[str, Any]] | None = None
    recurrence: TaskRecurrence = TaskRecurrence.none
    recurrence_interval: int = Field(default=1, ge=1, le=365)
    recurrence_unit: str | None = None  # day|week|month|year when custom
    recurrence_weekdays: list[int] | None = None  # 0=Mon .. 6=Sun
    recurrence_until: date | None = None


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    client_id: UUID | None = None
    sub_client_id: UUID | None = None
    project_id: UUID | None = None
    assignee_va_id: UUID | None = None
    status: TaskStatus | None = None
    priority: TaskPriority | None = None
    start_date: date | None = None
    due_date: date | None = None
    estimated_hours: Decimal | None = None
    position: int | None = None
    tags: list[str] | None = None
    checklist: list[dict[str, Any]] | None = None
    recurrence: TaskRecurrence | None = None
    recurrence_interval: int | None = Field(default=None, ge=1, le=365)
    recurrence_unit: str | None = None
    recurrence_weekdays: list[int] | None = None
    recurrence_until: date | None = None


class TaskResponse(BaseModel):
    id: UUID
    title: str
    description: str | None = None
    client_id: UUID
    client_name: str | None = None
    sub_client_id: UUID | None = None
    sub_client_name: str | None = None
    project_id: UUID | None = None
    project_name: str | None = None
    project_color: str | None = None
    assignee_va_id: UUID | None = None
    assignee_name: str | None = None
    status: TaskStatus
    priority: TaskPriority
    start_date: date | None = None
    due_date: date | None = None
    estimated_hours: Decimal | None = None
    logged_hours: Decimal = Decimal("0")
    position: int = 0
    tags: list[str] | None = None
    checklist: list[dict[str, Any]] | None = None
    recurrence: TaskRecurrence = TaskRecurrence.none
    recurrence_interval: int = 1
    recurrence_unit: str | None = None
    recurrence_weekdays: list[int] | None = None
    recurrence_until: date | None = None
    recurrence_label: str | None = None
    series_id: UUID | None = None
    parent_task_id: UUID | None = None
    completed_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class MentionIn(BaseModel):
    user_id: UUID
    name: str


class TaskCommentCreate(BaseModel):
    body: str = Field(min_length=1)
    parent_id: UUID | None = None
    mentions: list[MentionIn] = []
    attachment_ids: list[UUID] = []


class TaskCommentUpdate(BaseModel):
    body: str = Field(min_length=1)
    mentions: list[MentionIn] = []


class ReactionToggle(BaseModel):
    emoji: str = Field(min_length=1, max_length=16)


class LinkAttachmentCreate(BaseModel):
    url: str = Field(min_length=8, max_length=2000)


class AttachmentResponse(BaseModel):
    id: UUID
    comment_id: UUID | None = None
    original_name: str
    link_url: str | None = None
    provider: str | None = None
    kind: str = "image"
    size_bytes: int
    original_size: int
    width: int | None = None
    height: int | None = None
    original_width: int | None = None
    original_height: int | None = None
    format: str = "avif"
    storage_backend: str = "local"
    is_annotation: bool = False
    annotated_from_id: UUID | None = None
    created_at: datetime | None = None
    url: str


class ReactionSummary(BaseModel):
    emoji: str
    count: int
    users: list[str] = []
    reacted_by_me: bool = False


class TaskCommentResponse(BaseModel):
    id: UUID
    task_id: UUID | None = None
    project_id: UUID | None = None
    author_user_id: UUID
    author_name: str
    author_role: str = "va"
    body: str
    parent_id: UUID | None = None
    mentions: list[MentionIn] = []
    is_pinned: bool = False
    edited_at: datetime | None = None
    created_at: datetime
    reactions: list[ReactionSummary] = []
    attachments: list[AttachmentResponse] = []

    model_config = {"from_attributes": True}


class ProjectCommentCreate(TaskCommentCreate):
    pass


class ProjectCommentResponse(TaskCommentResponse):
    pass


class MeetupCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    notes: str | None = None
    starts_at: datetime
    ends_at: datetime | None = None
    location: str | None = None
    attendees: list[MentionIn] = []


class MeetupUpdate(BaseModel):
    title: str | None = None
    notes: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    location: str | None = None
    attendees: list[MentionIn] | None = None


class MeetupResponse(BaseModel):
    id: UUID
    project_id: UUID
    title: str
    notes: str | None = None
    starts_at: datetime
    ends_at: datetime | None = None
    location: str | None = None
    attendees: list[MentionIn] = []
    created_by_name: str = ""
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class TeamMemberResponse(BaseModel):
    user_id: UUID
    name: str
    role: str
    va_id: UUID | None = None


class ClockInRequest(BaseModel):
    task_id: UUID | None = None
    client_id: UUID | None = None
    project_id: UUID | None = None
    notes: str | None = None


class ClockOutRequest(BaseModel):
    notes: str | None = None
    create_work_log: bool = True
    description: str | None = None
    comment: str | None = None


class VAWorkLogUpdate(BaseModel):
    work_date: date | None = None
    client_id: UUID | None = None
    sub_client_id: UUID | None = None
    project_id: UUID | None = None
    task_id: UUID | None = None
    description_plain: str | None = None
    description_lexical: dict[str, Any] | None = None
    start_time: time | None = None
    end_time: time | None = None
    notes: str | None = None


class TimeClockResponse(BaseModel):
    id: UUID
    va_id: UUID
    va_name: str | None = None
    task_id: UUID | None = None
    task_title: str | None = None
    client_id: UUID | None = None
    client_name: str | None = None
    project_id: UUID | None = None
    project_name: str | None = None
    work_log_id: UUID | None = None
    clock_in: datetime
    clock_out: datetime | None = None
    duration_seconds: int | None = None
    elapsed_seconds: int = 0
    status: ClockStatus
    notes: str | None = None
    is_adjusted: bool = False
    adjustment_count: int = 0
    last_adjusted_at: datetime | None = None
    last_adjustment_reason: str | None = None
    original_clock_in: datetime | None = None
    original_clock_out: datetime | None = None
    last_adjusted_by_name: str | None = None
    last_adjusted_by_role: str | None = None
    pending_correction_request_id: UUID | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class ClockAdjustRequest(BaseModel):
    """Admin/auditor adjustment of a clock entry on behalf of a VA. Reason required for audit."""
    clock_in: datetime | None = None
    clock_out: datetime | None = None
    notes: str | None = None
    client_id: UUID | None = None
    project_id: UUID | None = None
    task_id: UUID | None = None
    reason: str = Field(min_length=3, max_length=1000)
    correction_request_id: UUID | None = None


class ClockCorrectionRequestCreate(BaseModel):
    """VA asks staff to revise wrong clock-in, clock-out, or date."""
    proposed_clock_in: datetime | None = None
    proposed_clock_out: datetime | None = None
    proposed_notes: str | None = None
    reason: str = Field(min_length=3, max_length=1000)


class ClockCorrectionRequestResponse(BaseModel):
    id: UUID
    entry_id: UUID
    va_id: UUID
    va_name: str | None = None
    task_title: str | None = None
    client_name: str | None = None
    current_clock_in: datetime | None = None
    current_clock_out: datetime | None = None
    proposed_clock_in: datetime | None = None
    proposed_clock_out: datetime | None = None
    proposed_notes: str | None = None
    reason: str
    status: str
    resolved_by_name: str | None = None
    resolved_at: datetime | None = None
    resolution_note: str | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class TimeClockAdjustmentResponse(BaseModel):
    id: UUID
    entry_id: UUID
    va_id: UUID
    va_name: str | None = None
    adjusted_by_name: str = ""
    adjusted_by_role: str = "va"
    reason: str
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None
    work_log_synced: bool = False
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


# User reports (to Administrator + Auditor)
class UserReportCreate(BaseModel):
    category: str = "general"
    title: str = Field(min_length=3, max_length=500)
    body: str = Field(min_length=3)
    client_id: UUID | None = None
    project_id: UUID | None = None
    task_id: UUID | None = None


class UserReportUpdate(BaseModel):
    status: str | None = None  # open | acknowledged | resolved
    admin_note: str | None = None


class UserReportResponse(BaseModel):
    id: UUID
    reporter_user_id: UUID
    reporter_va_id: UUID | None = None
    reporter_name: str = ""
    reporter_role: str = "va"
    category: str = "general"
    title: str
    body: str
    client_id: UUID | None = None
    client_name: str | None = None
    project_id: UUID | None = None
    project_name: str | None = None
    task_id: UUID | None = None
    task_title: str | None = None
    status: str = "open"
    admin_note: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


# Work logs
class WorkLogCreate(BaseModel):
    work_date: date
    client_id: UUID
    sub_client_id: UUID | None = None
    project_id: UUID | None = None
    task_id: UUID | None = None
    description_lexical: dict[str, Any] | None = None
    description_plain: str
    start_time: time
    end_time: time
    va_rate: Decimal | None = None  # ignored — resolved from approved VARate
    notes: str | None = None


class WorkLogAttachmentResponse(BaseModel):
    id: UUID
    work_log_id: UUID
    filename: str
    content_type: str
    size_bytes: int
    width: int | None = None
    height: int | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# VA Rates
class VARateCreate(BaseModel):
    client_id: UUID
    pay_type: PayType
    currency: Currency
    amount: Decimal
    notes: str | None = None


class VARateAdminCreate(BaseModel):
    va_id: UUID
    client_id: UUID
    pay_type: PayType
    currency: Currency
    amount: Decimal
    notes: str | None = None


class VARateResponse(BaseModel):
    id: UUID
    va_id: UUID
    va_name: str | None = None
    client_id: UUID
    client_name: str | None = None
    pay_type: PayType
    currency: Currency
    amount: Decimal
    status: RateStatus
    set_by_admin: bool
    notes: str | None = None
    effective_from: date | None = None
    created_at: datetime
    reviewed_at: datetime | None = None
    is_active_approved: bool = False

    model_config = {"from_attributes": True}


# Client Packages
class ClientPackageCreate(BaseModel):
    client_id: UUID
    name: str
    billing_type: BillingType
    amount: Decimal
    included_hours: Decimal | None = None
    overage_rate: Decimal | None = None
    currency: Currency = Currency.USD
    is_default: bool = False


class ClientPackageUpdate(BaseModel):
    name: str | None = None
    billing_type: BillingType | None = None
    amount: Decimal | None = None
    included_hours: Decimal | None = None
    overage_rate: Decimal | None = None
    currency: Currency | None = None
    is_default: bool | None = None
    is_active: bool | None = None


class ClientPackageResponse(BaseModel):
    id: UUID
    client_id: UUID
    name: str
    billing_type: BillingType
    amount: Decimal
    included_hours: Decimal | None = None
    overage_rate: Decimal | None = None
    currency: Currency
    is_default: bool
    is_active: bool

    model_config = {"from_attributes": True}


class WorkLogUpdate(BaseModel):
    work_date: date | None = None
    client_id: UUID | None = None
    sub_client_id: UUID | None = None
    project_id: UUID | None = None
    task_id: UUID | None = None
    description_lexical: dict[str, Any] | None = None
    description_plain: str | None = None
    start_time: time | None = None
    end_time: time | None = None
    va_rate: Decimal | None = None
    notes: str | None = None
    status: WorkLogStatus | None = None


class WorkLogResponse(BaseModel):
    id: UUID
    work_date: date
    va_id: UUID
    va_name: str | None = None
    client_id: UUID
    client_name: str | None = None
    sub_client_id: UUID | None
    sub_client_name: str | None = None
    description_lexical: dict[str, Any] | None
    description_plain: str
    start_time: time
    end_time: time
    hours: Decimal
    va_rate: Decimal | None = None
    va_pay: Decimal | None = None
    notes: str | None
    status: WorkLogStatus
    invoice_id: UUID | None
    project_id: UUID | None = None
    project_name: str | None = None
    task_id: UUID | None = None
    task_title: str | None = None
    clock_in_at: datetime | None = None
    clock_out_at: datetime | None = None
    source: str = "manual"
    payable_on: date | None = None
    rolled_to_next_payroll: bool = False
    created_at: datetime
    attachment_count: int = 0

    model_config = {"from_attributes": True}


# Invoices
class InvoiceGenerateRequest(BaseModel):
    client_id: UUID
    year: int
    month: int
    cutoff: int = Field(ge=15, le=30)
    billing_type: BillingType
    rate: Decimal
    invoice_number: str | None = None
    payment_method: PaymentMethod
    bank_details: str | None = None
    payment_terms_days: int = 7
    package_id: UUID | None = None
    included_hours: Decimal | None = None
    overage_rate: Decimal | None = None
    service_description: str | None = None  # client-facing text on generated line items


class InvoiceLineItemUpdate(BaseModel):
    description: str | None = None
    rate: Decimal | None = None
    amount: Decimal | None = None


class InvoicePreviewResponse(BaseModel):
    period_label: str
    period_start: date
    period_end: date
    approved_entries: int
    submitted_entries: int
    total_hours: Decimal
    estimated_amount: Decimal | None = None
    billing_type: BillingType
    can_generate: bool
    message: str
    included_hours: Decimal | None = None
    overage_hours: Decimal | None = None
    overage_amount: Decimal | None = None


class InvoiceLineItemResponse(BaseModel):
    id: UUID
    line_date: date
    description: str
    hours: Decimal
    rate: Decimal
    amount: Decimal

    model_config = {"from_attributes": True}


class InvoiceResponse(BaseModel):
    id: UUID
    invoice_number: str
    client_id: UUID
    client_name: str | None = None
    period_label: str
    period_start: date
    period_end: date
    total_hours: Decimal
    billing_type: BillingType
    rate: Decimal
    amount: Decimal
    status: InvoiceStatus
    payment_method: PaymentMethod
    bank_details: str | None
    payment_terms_days: int
    issue_date: date
    due_date: date
    paid_at: datetime | None
    line_items: list[InvoiceLineItemResponse] = []

    model_config = {"from_attributes": True}


# Payroll & Reports
class PayrollRequest(BaseModel):
    va_id: UUID | None = None
    period: str = "this_week"
    date_from: date | None = None
    date_to: date | None = None


class PayrollEntry(BaseModel):
    id: UUID
    work_date: date
    client_name: str
    description: str
    hours: Decimal
    rate: Decimal
    pay: Decimal
    project_name: str | None = None
    task_title: str | None = None
    source: str = "manual"
    status: str = "approved"
    start_time: str | None = None
    end_time: str | None = None


class PayrollBreakdown(BaseModel):
    label: str
    hours: Decimal
    pay: Decimal = Decimal("0")


class PayrollDay(BaseModel):
    work_date: date
    hours: Decimal


class PayrollVAResult(BaseModel):
    va_id: UUID
    va_name: str
    currency: Currency
    total_hours: Decimal
    total_pay: Decimal
    entry_count: int
    entries: list[PayrollEntry]
    pending_hours: Decimal = Decimal("0")
    pending_count: int = 0
    days_worked: int = 0
    avg_hours_per_day: Decimal = Decimal("0")
    clock_hours: Decimal = Decimal("0")
    manual_hours: Decimal = Decimal("0")
    tasks_done: int = 0
    by_client: list[PayrollBreakdown] = []
    daily: list[PayrollDay] = []
    prev_hours: Decimal = Decimal("0")
    prev_pay: Decimal = Decimal("0")
    change_pct: float | None = None
    payment_label: str | None = None
    is_paid: bool = False
    run_id: UUID | None = None
    timesheet_submitted: bool = False
    timesheet_status: str | None = None
    timesheet_id: UUID | None = None


class TimesheetSubmitRequest(BaseModel):
    date_from: date
    date_to: date
    notes: str | None = None


class TimesheetSubmissionResponse(BaseModel):
    id: UUID
    va_id: UUID
    va_name: str | None = None
    period_start: date
    period_end: date
    status: str
    notes: str | None = None
    submitted_at: datetime
    reviewed_at: datetime | None = None
    entry_count: int = 0
    total_hours: Decimal = Decimal("0")


class PayrollResponse(BaseModel):
    period_start: date
    period_end: date
    vas: list[PayrollVAResult]
    total_php: Decimal
    total_usd: Decimal
    total_hours: Decimal = Decimal("0")
    total_pending_hours: Decimal = Decimal("0")


class PayrollRunCreate(BaseModel):
    va_id: UUID
    period_start: date
    period_end: date
    total_hours: Decimal
    total_pay: Decimal
    currency: str = "PHP"
    method: str | None = None
    notes: str | None = None
    usd_php_rate: Decimal | None = None


class PayrollRunResponse(BaseModel):
    id: UUID
    va_id: UUID
    va_name: str | None = None
    period_start: date
    period_end: date
    total_hours: Decimal
    total_pay: Decimal
    currency: str
    method: str | None = None
    notes: str | None = None
    usd_php_rate: Decimal | None = None
    paid_at: datetime


class BusinessExpenseCreate(BaseModel):
    expense_date: date
    description: str = Field(min_length=1, max_length=500)
    amount: Decimal
    currency: str = "USD"


class BusinessExpenseUpdate(BaseModel):
    expense_date: date | None = None
    description: str | None = Field(default=None, min_length=1, max_length=500)
    amount: Decimal | None = None
    currency: str | None = None


class BusinessExpenseResponse(BaseModel):
    id: UUID
    expense_date: date
    description: str
    amount: Decimal
    currency: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ReportRequest(BaseModel):
    client_id: UUID
    year: int | None = None
    month: int | None = None
    cutoff: int | None = Field(default=30, ge=15, le=30)
    date_from: date | None = None
    date_to: date | None = None
    show_rate: bool = False


class ReportLine(BaseModel):
    work_date: date
    description: str
    hours: Decimal
    rate: Decimal | None = None
    amount: Decimal | None = None
    va_name: str | None = None
    sub_client_name: str | None = None
    project_name: str | None = None
    task_title: str | None = None
    source: str = "manual"
    start_time: str | None = None
    end_time: str | None = None


class ReportBreakdown(BaseModel):
    label: str
    hours: Decimal
    entries: int = 0
    amount: Decimal | None = None
    rate: Decimal | None = None


class ReportDay(BaseModel):
    work_date: date
    hours: Decimal


class ReportResponse(BaseModel):
    client_name: str
    period_label: str
    period_start: date
    period_end: date
    generated_at: date
    show_rate: bool
    lines: list[ReportLine]
    total_hours: Decimal
    total_amount: Decimal | None = None
    by_va: list[ReportBreakdown] = []
    by_project: list[ReportBreakdown] = []
    by_sub_client: list[ReportBreakdown] = []
    by_day: list[ReportDay] = []
    pending_hours: Decimal = Decimal("0")
    pending_count: int = 0
    tasks_done: int = 0
    days_worked: int = 0


class ReportClientSummary(BaseModel):
    client_id: UUID
    client_name: str
    billing_type: str
    is_active: bool = True
    billable_hours: Decimal = Decimal("0")
    entries: int = 0
    pending_hours: Decimal = Decimal("0")
    pending_count: int = 0
    ready_to_invoice_hours: Decimal = Decimal("0")
    invoiced_hours: Decimal = Decimal("0")
    amount: Decimal | None = None
    va_names: list[str] = []
    last_activity: date | None = None
    invoice_number: str | None = None
    invoice_status: str | None = None
    prev_period_hours: Decimal = Decimal("0")
    change_pct: float | None = None


class ReportClientsResponse(BaseModel):
    period_label: str
    period_start: date
    period_end: date
    show_rate: bool
    clients: list[ReportClientSummary]
    total_hours: Decimal = Decimal("0")
    total_pending_hours: Decimal = Decimal("0")


class NotificationResponse(BaseModel):
    id: UUID
    type: str
    title: str
    body: str | None = None
    link: str | None = None
    is_read: bool
    created_at: datetime


class NotificationListResponse(BaseModel):
    items: list[NotificationResponse]
    unread: int
    total: int


# Dashboard
class DashboardSummary(BaseModel):
    total_invoiced: Decimal
    paid_by_clients: Decimal
    total_va_payout: Decimal
    estimated_profit: Decimal
    pending_entries: int
    approved_hours: Decimal
    active_clients: int
    invoices_issued: int
    unpaid_invoices: int
    this_week_va_pay: Decimal
    active_vas: int
    hours_by_client: list[dict[str, Any]]
    va_pay_this_week: list[dict[str, Any]]
    pending_logs: list[WorkLogResponse]


# Settings
class SettingsUpdate(BaseModel):
    company_name: str | None = None
    principal_name: str | None = None
    location: str | None = None
    wise_email: str | None = None
    paypal_email: str | None = None
    hide_pricing: bool | None = None
    booking_url: str | None = None
    booking_hide_pricing: bool | None = None
    default_va_hourly_rate: Decimal | None = None
    resend_api_key: str | None = None
    resend_from_email: str | None = None
    admin_notify_email: str | None = None


class SettingsResponse(BaseModel):
    company_name: str
    principal_name: str
    location: str
    wise_email: str
    paypal_email: str
    hide_pricing: bool = True
    booking_url: str = ""
    booking_hide_pricing: bool = True
    default_va_hourly_rate: Decimal = Decimal("75.00")
    resend_api_key: str = ""
    resend_from_email: str = "onboarding@resend.dev"
    admin_notify_email: str = "janelaurine@gmail.com"


class EmailTemplateResponse(BaseModel):
    id: UUID
    key: str
    name: str
    subject: str
    body_html: str
    cta_label: str | None = None
    cta_url: str | None = None
    variables: list[str] = []
    is_active: bool = True
    updated_at: datetime | None = None


class EmailTemplateUpdate(BaseModel):
    subject: str | None = None
    body_html: str | None = None
    cta_label: str | None = None
    cta_url: str | None = None
    is_active: bool | None = None


class EmailTestRequest(BaseModel):
    to_email: str


class EmailLogResponse(BaseModel):
    id: UUID
    template_key: str | None = None
    to_email: str
    subject: str
    status: str
    error: str | None = None
    created_at: datetime


class ActivityLogResponse(BaseModel):
    id: UUID
    user_id: UUID | None = None
    user_name: str
    user_role: str | None = None
    action: str
    description: str
    path: str | None = None
    method: str | None = None
    created_at: datetime


class DisplaySettingsResponse(BaseModel):
    hide_pricing: bool = True
    booking_url: str = ""
    booking_hide_pricing: bool = True
    default_va_hourly_rate: Decimal = Decimal("75.00")
