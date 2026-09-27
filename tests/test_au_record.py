"""The runtime's skill record (scripts/au_record.py) emits frozen-contract shapes.

Offline: no QM, Memorable or Docker. Run with `python3 -m unittest discover -s tests`.
"""
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import au_record  # noqa: E402
import check_contracts as cc  # noqa: E402

SKILL = "contracts/skill.schema.json"
EVENT = "contracts/event.schema.json"
PASSED = {"passed": True, "checks": [{"name": "file_exists", "passed": True}]}


def errors(value, schema):
    return cc.validate(value, cc.load_schema(schema), schema)


class AuRecordContract(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        au_record.RECORD_DIR = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def test_full_lifecycle_matches_contracts(self):
        rec = au_record.load("research-company", "Research Company", "company.json")
        teacher = au_record.agent("web:teacher@example.com:default", "Scout (teacher)")
        student = au_record.agent("web:teacher@example.com:0000", "Scout (fresh student)")
        self.assertNotEqual(teacher["id"], student["id"])
        self.assertNotIn("example.com", teacher["id"])

        rec["teacher"] = teacher
        au_record.set_status(rec, "observed")
        au_record.emit(rec, "skill.observed", {"skillId": rec["id"], "teacher": teacher, "artifactType": "company.json",
                                               "runId": "r1", "artifactPath": "/p", "verification": PASSED})
        rec["procedureId"] = "procedures/abc-research"
        au_record.emit(rec, "skill.recalled", {"skillId": rec["id"], "procedureId": rec["procedureId"], "query": "q"})
        au_record.emit(rec, "exam.started", {"skillId": rec["id"], "examCase": "exam-vercel", "student": student})
        rec["transfer"] = {"student": student, "examCase": "exam-vercel", "passed": True}
        au_record.set_status(rec, "transferred")
        au_record.emit(rec, "exam.passed", {"skillId": rec["id"], "examCase": "exam-vercel", "student": student,
                                            "verification": PASSED})
        au_record.set_status(rec, "certified")
        au_record.emit(rec, "skill.certified", {"skillId": rec["id"], "teacher": teacher, "student": student,
                                                "examCase": "exam-vercel"})
        au_record.save(rec)
        loaded = au_record.load("research-company", "x", "company.json")

        self.assertEqual(errors(loaded, SKILL), [])
        for e in loaded["events"]:
            self.assertEqual(errors(e, EVENT), [], e["type"])
        self.assertEqual(loaded["status"], "certified")

    def test_status_never_moves_backwards(self):
        rec = au_record.load("s", "S", "company.json")
        with self.assertRaises(SystemExit):
            au_record.set_status(rec, "transferred")  # nothing observed yet
        au_record.set_status(rec, "observed")
        au_record.set_status(rec, "certified")
        with self.assertRaises(SystemExit):
            au_record.set_status(rec, "transferred")

    def test_unknown_event_rejected(self):
        rec = au_record.load("s", "S", "company.json")
        with self.assertRaises(ValueError):
            au_record.emit(rec, "skill.reproduced", {})


if __name__ == "__main__":
    unittest.main()
