"""Startup seeding must not plant demo rows unless SEED_DEMO_DATA is on."""
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Client, Project, Task, User, UserRole, VA, WorkLog
from app.services.seed import seed_database

ADMIN_URL = "postgresql://shc:shc@localhost:5432/postgres"
TEST_URL = "postgresql://shc:shc@localhost:5432/shc_seed_test"


class SeedDemoFlagTests(unittest.TestCase):
    def setUp(self):
        admin = create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
        with admin.connect() as conn:
            conn.execute(text("DROP DATABASE IF EXISTS shc_seed_test"))
            conn.execute(text("CREATE DATABASE shc_seed_test"))
        admin.dispose()
        self.engine = create_engine(TEST_URL)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)

    def tearDown(self):
        self.engine.dispose()
        admin = create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
        with admin.connect() as conn:
            conn.execute(text(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'shc_seed_test' AND pid <> pg_backend_pid()"
            ))
            conn.execute(text("DROP DATABASE IF EXISTS shc_seed_test"))
        admin.dispose()

    def test_empty_db_without_flag_creates_only_the_admin(self):
        db = self.Session()
        try:
            with (
                patch("app.services.seed.settings.seed_demo_data", False),
                patch("app.services.seed.settings.admin_email", "admin@sunnyhuecreatives.com"),
                patch("app.services.seed.settings.admin_password", "launch-secret"),
            ):
                seed_database(db)
                seed_database(db)

            users = db.query(User).all()
            self.assertEqual([u.email for u in users], ["admin@sunnyhuecreatives.com"])
            self.assertEqual(users[0].role, UserRole.admin)
            self.assertEqual(db.query(VA).count(), 0)
            self.assertEqual(db.query(Client).count(), 0)
            self.assertEqual(db.query(Project).count(), 0)
            self.assertEqual(db.query(Task).count(), 0)
            self.assertEqual(db.query(WorkLog).count(), 0)
            self.assertIsNone(db.query(User).filter(User.email == "auditor@sunnyhue.local").first())
            self.assertIsNone(db.query(User).filter(User.email == "myra@sunnyhue.local").first())
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
