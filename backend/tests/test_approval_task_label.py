import unittest
from types import SimpleNamespace

from app.services.log_display import approval_task_label


class ApprovalTaskLabelTests(unittest.TestCase):
    def test_uses_typed_task_name(self):
        log = SimpleNamespace(task_name="Calendar draft", task=None, description_plain="Longer notes")
        self.assertEqual(approval_task_label(log), "Calendar draft")

    def test_falls_back_to_linked_task(self):
        log = SimpleNamespace(task_name=None, task=SimpleNamespace(title="Inbox triage"), description_plain="Sorted mail")
        self.assertEqual(approval_task_label(log), "Inbox triage")

    def test_old_entry_uses_description_then_untitled(self):
        described = SimpleNamespace(task_name="", task=None, description_plain="Clocked work\nmore")
        self.assertEqual(approval_task_label(described), "Clocked work")
        empty = SimpleNamespace(task_name=None, task=None, description_plain="  ")
        self.assertEqual(approval_task_label(empty), "Untitled task")


if __name__ == "__main__":
    unittest.main()
