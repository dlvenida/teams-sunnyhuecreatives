from datetime import date, datetime, time
from decimal import Decimal
import re
from typing import Annotated, Any
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, Field

from app.models import (
    BillingType,
    Currency,
    InvoiceStatus,
    PaymentMethod,
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


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    role: UserRole
    must_change_password: bool = False
    va_id: UUID | None = None
    name: str | None = None


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


# Clients
class ClientCreate(BaseModel):
    name: str
    billing_type: BillingType
    default_rate: Decimal | None = None


class ClientUpdate(BaseModel):
    name: str | None = None
    billing_type: BillingType | None = None
    default_rate: Decimal | None = None
    is_active: bool | None = None


class ClientResponse(BaseModel):
    id: UUID
    name: str
    billing_type: BillingType
    default_rate: Decimal | None
    is_active: bool

    model_config = {"from_attributes": True}


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

    model_config = {"from_attributes": True}


class VAUpdate(BaseModel):
    name: str | None = None
    email: AppEmail | None = None
    currency: Currency | None = None
    is_active: bool | None = None


class AdminResetPasswordRequest(BaseModel):
    password: str = Field(min_length=8)


# Profile
class ProfileUpdate(BaseModel):
    display_name: str | None = None
    phone: str | None = None
    address: str | None = None
    wise_email: str | None = None
    ph_bank_account: str | None = None
    ph_bank_account_name: str | None = None
    ph_bank_name: str | None = None


class EmailChangeRequest(BaseModel):
    new_email: AppEmail


class EmailChangeConfirm(BaseModel):
    code: str = Field(min_length=6, max_length=6)


class ProfileResponse(BaseModel):
    id: UUID
    email: str
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


# Work logs
class WorkLogCreate(BaseModel):
    work_date: date
    client_id: UUID
    sub_client_id: UUID | None = None
    description_lexical: dict[str, Any] | None = None
    description_plain: str
    start_time: time
    end_time: time
    va_rate: Decimal
    notes: str | None = None


class WorkLogUpdate(BaseModel):
    work_date: date | None = None
    client_id: UUID | None = None
    sub_client_id: UUID | None = None
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
    va_rate: Decimal
    va_pay: Decimal
    notes: str | None
    status: WorkLogStatus
    invoice_id: UUID | None
    created_at: datetime

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


class PayrollVAResult(BaseModel):
    va_id: UUID
    va_name: str
    currency: Currency
    total_hours: Decimal
    total_pay: Decimal
    entry_count: int
    entries: list[PayrollEntry]


class PayrollResponse(BaseModel):
    period_start: date
    period_end: date
    vas: list[PayrollVAResult]
    total_php: Decimal
    total_usd: Decimal


class ReportRequest(BaseModel):
    client_id: UUID
    year: int
    month: int
    cutoff: int = Field(ge=15, le=30)
    show_rate: bool = False


class ReportLine(BaseModel):
    work_date: date
    description: str
    hours: Decimal
    rate: Decimal | None = None
    amount: Decimal | None = None


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


class DisplaySettingsResponse(BaseModel):
    hide_pricing: bool = True
    booking_url: str = ""
    booking_hide_pricing: bool = True
    default_va_hourly_rate: Decimal = Decimal("75.00")
