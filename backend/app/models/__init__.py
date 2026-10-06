import enum
import uuid
from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    Time,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class UserRole(str, enum.Enum):
    admin = "admin"
    va = "va"


class BillingType(str, enum.Enum):
    hourly = "hourly"
    fixed = "fixed"


class Currency(str, enum.Enum):
    PHP = "PHP"
    USD = "USD"


class WorkLogStatus(str, enum.Enum):
    submitted = "submitted"
    approved = "approved"
    rejected = "rejected"
    invoiced = "invoiced"


class InvoiceStatus(str, enum.Enum):
    unpaid = "unpaid"
    paid = "paid"


class PaymentMethod(str, enum.Enum):
    wise = "wise"
    paypal = "paypal"
    bank_transfer = "bank_transfer"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, name="user_role"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    profile_photo_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    wise_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ph_bank_account: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ph_bank_account_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ph_bank_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    pending_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email_verification_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    email_verification_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    va_profile: Mapped["VA | None"] = relationship(back_populates="user", uselist=False)


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    billing_type: Mapped[BillingType] = mapped_column(Enum(BillingType, name="billing_type"))
    default_rate: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    sub_clients: Mapped[list["SubClient"]] = relationship(back_populates="client", cascade="all, delete-orphan")
    work_logs: Mapped[list["WorkLog"]] = relationship(back_populates="client")
    invoices: Mapped[list["Invoice"]] = relationship(back_populates="client")


class SubClient(Base):
    __tablename__ = "sub_clients"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    client: Mapped["Client"] = relationship(back_populates="sub_clients")
    work_logs: Mapped[list["WorkLog"]] = relationship(back_populates="sub_client")


class VA(Base):
    __tablename__ = "vas"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    currency: Mapped[Currency] = mapped_column(Enum(Currency, name="currency"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="va_profile")
    work_logs: Mapped[list["WorkLog"]] = relationship(back_populates="va")


class WorkLog(Base):
    __tablename__ = "work_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    work_date: Mapped[date] = mapped_column(Date)
    va_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vas.id"))
    client_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clients.id"))
    sub_client_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("sub_clients.id"), nullable=True)
    description_lexical: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    description_plain: Mapped[str] = mapped_column(Text)
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    hours: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    va_rate: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    va_pay: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[WorkLogStatus] = mapped_column(
        Enum(WorkLogStatus, name="work_log_status"), default=WorkLogStatus.submitted
    )
    invoice_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("invoices.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    va: Mapped["VA"] = relationship(back_populates="work_logs")
    client: Mapped["Client"] = relationship(back_populates="work_logs")
    sub_client: Mapped["SubClient | None"] = relationship(back_populates="work_logs")
    invoice: Mapped["Invoice | None"] = relationship(back_populates="work_logs")


class Invoice(Base):
    __tablename__ = "invoices"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    invoice_number: Mapped[str] = mapped_column(String(50), unique=True)
    client_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clients.id"))
    period_label: Mapped[str] = mapped_column(String(100))
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    total_hours: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    billing_type: Mapped[BillingType] = mapped_column(Enum(BillingType, name="invoice_billing_type"))
    rate: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    status: Mapped[InvoiceStatus] = mapped_column(Enum(InvoiceStatus, name="invoice_status"), default=InvoiceStatus.unpaid)
    payment_method: Mapped[PaymentMethod] = mapped_column(Enum(PaymentMethod, name="payment_method"))
    bank_details: Mapped[str | None] = mapped_column(Text, nullable=True)
    payment_terms_days: Mapped[int] = mapped_column(Integer, default=7)
    issue_date: Mapped[date] = mapped_column(Date)
    due_date: Mapped[date] = mapped_column(Date)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    client: Mapped["Client"] = relationship(back_populates="invoices")
    line_items: Mapped[list["InvoiceLineItem"]] = relationship(back_populates="invoice", cascade="all, delete-orphan")
    work_logs: Mapped[list["WorkLog"]] = relationship(back_populates="invoice")


class InvoiceLineItem(Base):
    __tablename__ = "invoice_line_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    invoice_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("invoices.id", ondelete="CASCADE"))
    work_log_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("work_logs.id"), nullable=True)
    line_date: Mapped[date] = mapped_column(Date)
    description: Mapped[str] = mapped_column(Text)
    hours: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    rate: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))

    invoice: Mapped["Invoice"] = relationship(back_populates="line_items")


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, default=dict)
