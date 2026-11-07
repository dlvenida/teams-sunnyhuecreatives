"""The API starts with `alembic upgrade head`. Two revisions with the same id leave two heads and that command fails."""
import unittest
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


class AlembicRevisionTests(unittest.TestCase):
    def test_one_head_after_invoice_breakdown(self):
        root = Path(__file__).resolve().parents[1]
        cfg = Config(str(root / "alembic.ini"))
        cfg.set_main_option("script_location", str(root / "alembic"))
        script = ScriptDirectory.from_config(cfg)
        self.assertEqual(script.get_heads(), ["038"])
        manual = script.get_revision("038")
        self.assertEqual(manual.down_revision, "037")
        self.assertEqual(script.get_revision("037").down_revision, "036")
