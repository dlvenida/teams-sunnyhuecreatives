from datetime import date, time
from decimal import Decimal

from sqlalchemy.orm import Session

from app.auth import hash_password, unique_username
from app.config import settings
from app.models import (
    BillingType,
    Cadence,
    Client,
    Currency,
    Project,
    SubClient,
    Task,
    TaskPriority,
    TaskStatus,
    User,
    UserRole,
    VA,
    WorkLog,
    WorkLogStatus,
)


def seed_database(db: Session) -> None:
    admin = db.query(User).filter(User.role == UserRole.admin).first()
    if not admin:
        admin = User(
            email=settings.admin_email,
            username=unique_username(db, settings.admin_email),
            password_hash=hash_password(settings.admin_password),
            role=UserRole.admin,
            display_name="Jane Laurine Venida",
            job_title="Founder / Admin",
        )
        db.add(admin)
        db.commit()
    elif not admin.display_name:
        admin.display_name = "Jane Laurine Venida"
        db.commit()

    for _u in db.query(User).filter(User.username.is_(None)).all():
        _u.username = unique_username(db, _u.email)
    db.commit()

    # Demo Auditor — monitors VA activity, no destructive access (auditor@sunnyhue.local / auditor2024)
    if not db.query(User).filter(User.email == "auditor@sunnyhue.local").first():
        db.add(User(
            email="auditor@sunnyhue.local",
            username=unique_username(db, "auditor@sunnyhue.local"),
            password_hash=hash_password("auditor2024"),
            role=UserRole.auditor,
            display_name="Audrey Reyes",
            job_title="Project Manager",
        ))
        db.commit()

    if db.query(Client).count() > 0:
        seed_sample_work_logs(db)
        seed_demo_board(db)
        return

    clients_data = [
        {
            "name": "EmpowerHQ Consulting",
            "billing_type": BillingType.fixed,
            "default_rate": Decimal("600.00"),
            "subs": ["Entity A", "Entity B"],
        },
        {
            "name": "Delphine O'Rourke",
            "billing_type": BillingType.hourly,
            "default_rate": Decimal("75.00"),
            "subs": [],
        },
        {
            "name": "Nonprofit Finance Brand",
            "billing_type": BillingType.hourly,
            "default_rate": Decimal("65.00"),
            "subs": [],
        },
    ]

    for c in clients_data:
        client = Client(
            name=c["name"],
            billing_type=c["billing_type"],
            default_rate=c["default_rate"],
        )
        db.add(client)
        db.flush()
        for sub_name in c["subs"]:
            db.add(SubClient(client_id=client.id, name=sub_name))

    vas_data = [
        ("Myra", Currency.PHP, "myra@sunnyhue.local"),
        ("Gem", Currency.USD, "gem@sunnyhue.local"),
        ("Arby", Currency.PHP, "arby@sunnyhue.local"),
        ("Peter", Currency.USD, "peter@sunnyhue.local"),
    ]

    for name, currency, email in vas_data:
        user = User(
            email=email,
            username=unique_username(db, email),
            password_hash=hash_password("va2024"),
            role=UserRole.va,
            must_change_password=True,
        )
        db.add(user)
        db.flush()
        db.add(VA(user_id=user.id, name=name, currency=currency))

    db.commit()
    seed_sample_work_logs(db)
    seed_demo_board(db)


def seed_demo_board(db: Session) -> None:
    if db.query(Project).count() > 0:
        return
    clients = db.query(Client).filter(Client.is_active == True).all()
    vas = db.query(VA).filter(VA.is_active == True).all()
    if not clients or not vas:
        return
    from datetime import timedelta
    today = date.today()
    colors = ["#ec4899", "#8b5cf6", "#06b6d4", "#f59e0b"]
    cadences = [Cadence.weekly, Cadence.biweekly, Cadence.monthly]
    for i, client in enumerate(clients):
        project = Project(client_id=client.id, name=f"{client.name} — Operations", description=f"Ongoing delivery board for {client.name}", color=colors[i % len(colors)], cadence=cadences[i % len(cadences)], start_date=today - timedelta(days=7), due_date=today + timedelta(days=21))
        db.add(project); db.flush()
        samples = [
            ("Inbox & email triage", TaskStatus.in_progress, TaskPriority.high, 0),
            ("Weekly report preparation", TaskStatus.todo, TaskPriority.medium, 3),
            ("Calendar & meeting coordination", TaskStatus.in_review, TaskPriority.medium, 2),
            ("Document cleanup & filing", TaskStatus.done, TaskPriority.low, -2),
            ("Research & data entry", TaskStatus.todo, TaskPriority.low, 7),
        ]
        for pos, (title, st, prio, offset) in enumerate(samples):
            db.add(Task(title=title, description=f"{title} for {client.name}", client_id=client.id, project_id=project.id, assignee_va_id=vas[pos % len(vas)].id, status=st, priority=prio, start_date=today, due_date=today + timedelta(days=offset), estimated_hours=Decimal("4.00"), position=pos, tags=["operations"]))
    db.commit()


def seed_sample_work_logs(db: Session) -> None:
    """Add demo approved logs when none exist so invoicing works out of the box."""
    if db.query(WorkLog).count() > 0:
        return

    va = db.query(VA).first()
    if not va:
        return

    clients = {c.name: c for c in db.query(Client).all()}
    delphine = clients.get("Delphine O'Rourke")
    empower = clients.get("EmpowerHQ Consulting")
    nonprofit = clients.get("Nonprofit Finance Brand")

    today = date.today()
    year, month = today.year, today.month

    samples: list[tuple] = []
    if delphine:
        samples.extend([
            (delphine, date(year, month, 2), "Email management and calendar updates", Decimal("3.50"), Decimal("75.00")),
            (delphine, date(year, month, 5), "Client correspondence and document prep", Decimal("4.00"), Decimal("75.00")),
            (delphine, date(year, month, 10), "Research and reporting tasks", Decimal("2.50"), Decimal("75.00")),
        ])
    if empower:
        sub = db.query(SubClient).filter(SubClient.client_id == empower.id).first()
        samples.append(
            (empower, date(year, month, 8), f"Monthly support — {sub.name if sub else 'Entity A'}", Decimal("6.00"), Decimal("25.00")),
        )
    if nonprofit:
        samples.append(
            (nonprofit, date(year, month, 12), "Social media scheduling and content drafts", Decimal("5.00"), Decimal("65.00")),
        )

    for client, work_date, description, hours, rate in samples:
        pay = (hours * rate).quantize(Decimal("0.01"))
        end_h = 9 + int(hours)
        end_m = int(round((float(hours) % 1) * 60))
        if end_h >= 24:
            end_h, end_m = 17, 0
        db.add(
            WorkLog(
                work_date=work_date,
                va_id=va.id,
                client_id=client.id,
                description_plain=description,
                start_time=time(9, 0),
                end_time=time(end_h, end_m),
                hours=hours,
                va_rate=rate,
                va_pay=pay,
                status=WorkLogStatus.approved,
            )
        )

    db.commit()
