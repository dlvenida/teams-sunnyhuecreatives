"""Duration logs store hours without a clock range, and overlap ignores them."""
import unittest
import uuid
from datetime import date, time
from decimal import Decimal
from types import SimpleNamespace

from fastapi import HTTPException

from app.models import WorkLogStatus
from app.services.work_log_entry import resolve_timing, timing_mode_for_update
from app.services.work_log_overlap import assert_no_time_overlap


class _Query:
    def __init__(self, rows):
        self.rows = rows

    def filter(self, *args, **kwargs):
        return self

    def all(self):
        return list(self.rows)


class _DB:
    def __init__(self, rows):
        self.rows = rows

    def query(self, model):
        return _Query(self.rows)


def _log(**kwargs):
    base = dict(
        id=uuid.uuid4(),
        start_time=time(9, 0),
        end_time=time(12, 0),
        hours=Decimal("3.00"),
        entry_mode="range",
        status=WorkLogStatus.submitted,
        description_plain="Existing",
    )
    base.update(kwargs)
    return SimpleNamespace(**base)


class ResolveTimingTests(unittest.TestCase):
    def test_duration_stores_hours_and_clears_clock_times(self):
        mode, hours, start, end = resolve_timing(
            entry_mode="duration",
            start_time=time(9, 0),
            end_time=time(11, 0),
            duration_hours=2,
            duration_minutes=15,
        )
        self.assertEqual(mode, "duration")
        self.assertEqual(hours, Decimal("2.25"))
        self.assertIsNone(start)
        self.assertIsNone(end)

    def test_short_duration_round_trips_through_hundredths(self):
        mode, hours, start, end = resolve_timing(
            entry_mode="duration", start_time=None, end_time=None, duration_hours=0, duration_minutes=45,
        )
        self.assertEqual((mode, hours, start, end), ("duration", Decimal("0.75"), None, None))

    def test_rejects_empty_too_long_and_bad_minutes(self):
        with self.assertRaises(HTTPException) as zero:
            resolve_timing(entry_mode="duration", start_time=None, end_time=None, duration_hours=0, duration_minutes=0)
        self.assertEqual(zero.exception.detail, "Please enter your actual work duration.")
        with self.assertRaises(HTTPException) as over:
            resolve_timing(entry_mode="duration", start_time=None, end_time=None, duration_hours=24, duration_minutes=1)
        self.assertIn("24", over.exception.detail)
        with self.assertRaises(HTTPException) as minutes:
            resolve_timing(entry_mode="duration", start_time=None, end_time=None, duration_hours=1, duration_minutes=60)
        self.assertIn("0 to 59", minutes.exception.detail)

    def test_full_day_duration_is_allowed(self):
        _, hours, _, _ = resolve_timing(
            entry_mode="duration", start_time=None, end_time=None, duration_hours=24, duration_minutes=0,
        )
        self.assertEqual(hours, Decimal("24.00"))

    def test_range_still_requires_both_times(self):
        mode, hours, start, end = resolve_timing(
            entry_mode="range", start_time=time(9, 0), end_time=time(11, 30), duration_hours=None, duration_minutes=None,
        )
        self.assertEqual(mode, "range")
        self.assertEqual(hours, Decimal("2.50"))
        self.assertEqual((start, end), (time(9, 0), time(11, 30)))
        with self.assertRaises(HTTPException):
            resolve_timing(entry_mode="range", start_time=None, end_time=time(11, 0), duration_hours=None, duration_minutes=None)

    def test_update_mode_follows_explicit_fields(self):
        log = _log(entry_mode="duration", start_time=None, end_time=None, hours=Decimal("0.75"))
        body = SimpleNamespace(entry_mode="range", start_time=time(13, 0), end_time=time(14, 0), duration_hours=None, duration_minutes=None, model_fields_set={"entry_mode", "start_time", "end_time"})
        self.assertEqual(timing_mode_for_update(body, log), "range")
        date_only = SimpleNamespace(entry_mode=None, start_time=None, end_time=None, duration_hours=None, duration_minutes=None, model_fields_set={"work_date"})
        self.assertEqual(timing_mode_for_update(date_only, log), "duration")


class OverlapTests(unittest.TestCase):
    def test_duration_entries_do_not_block_a_range(self):
        duration = _log(entry_mode="duration", start_time=None, end_time=None, hours=Decimal("2.25"))
        assert_no_time_overlap(
            _DB([duration]),
            va_id=uuid.uuid4(),
            work_date=date(2026, 11, 3),
            start_time=time(9, 0),
            end_time=time(12, 0),
        )

    def test_a_duration_check_skips_overlap_entirely(self):
        busy = _log()
        assert_no_time_overlap(
            _DB([busy]),
            va_id=uuid.uuid4(),
            work_date=date(2026, 11, 3),
            start_time=None,
            end_time=None,
        )

    def test_ranges_still_overlap(self):
        busy = _log(start_time=time(9, 0), end_time=time(12, 0))
        with self.assertRaises(HTTPException) as raised:
            assert_no_time_overlap(
                _DB([busy]),
                va_id=uuid.uuid4(),
                work_date=date(2026, 11, 3),
                start_time=time(11, 0),
                end_time=time(13, 0),
            )
        self.assertIn("Overlapping", raised.exception.detail)


if __name__ == "__main__":
    unittest.main()
