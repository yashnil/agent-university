"""Certification engine (scripts/certify.py) and company registry (scripts/registry.py).

The invariant under test: one successful run is not enough. A skill is certified only when a
different agent passes an unseen exam from the recalled procedure and every required
deterministic verifier check passes. Offline; run with `python3 -m unittest discover -s tests`.
"""
import copy
import json
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import certify  # noqa: E402
import check_contracts as cc  # noqa: E402
import registry  # noqa: E402

FIX = os.path.join(ROOT, "demo", "fixtures")
RECORD = "certification-record.schema.json"
EVENT = "contracts/event.schema.json"
AT = "2026-01-01T00:04:01Z"
ISOLATED = {"different_scope": True, "different_sandbox": True, "no_answer_leak_in_prompt": True}


def fixture(name):
    with open(os.path.join(FIX, name)) as f:
        return json.load(f)


def errors(value, schema):
    return cc.validate(value, cc.load_schema(schema), schema)


class Base(unittest.TestCase):
    def setUp(self):
        self.skill = fixture("skill-observed.json")
        self.events = fixture("events.json")
        self.transfer = fixture("transfer-result.json")

    def decide(self, skill=None, transfer=None, events=None, **kw):
        kw.setdefault("isolation", ISOLATED)
        return certify.certify(skill or self.skill, transfer or self.transfer,
                               events=self.events if events is None else events, decided_at=AT, **kw)

    def assertFailsOnly(self, record, *rules, status):
        self.assertFalse(record["decision"]["certified"])
        self.assertEqual(record["decision"]["failedRules"], list(rules))
        self.assertEqual(record["skill"]["status"], status)
        self.assertNotIn("skill.certified", [e["type"] for e in record["events"]])
        self.assertEqual(errors(record, RECORD), [])


class Certifies(Base):
    def test_valid_transfer_is_certified(self):
        r = self.decide()
        self.assertTrue(r["decision"]["certified"], certify.explain(r))
        self.assertEqual(r["skill"]["status"], "certified")
        self.assertEqual(r["decision"]["failedRules"], [])
        self.assertEqual([x["rule"] for x in r["decision"]["rulings"]], certify.RULES)
        self.assertEqual([e["type"] for e in r["events"]], ["exam.passed", "skill.certified"])

    def test_record_answers_the_provenance_questions(self):
        r = self.decide()
        self.assertEqual(r["skill"]["id"], "research-company")                  # what skill
        self.assertEqual(r["teacher"]["id"], "agent-teacher-0001")              # who taught it
        self.assertEqual(r["procedureId"], self.transfer["procedureId"])        # what memory
        self.assertEqual(r["transfer"]["examCase"], "exam-northwind")           # which unseen case
        self.assertEqual(r["transfer"]["student"]["id"], "agent-student-0002")  # which student
        self.assertEqual(len(r["verification"]["checks"]), 6)                   # which checks
        self.assertTrue(all(c["passed"] for c in r["verification"]["checks"]))  # did they pass

    def test_outputs_match_frozen_contracts(self):
        r = self.decide()
        self.assertEqual(errors(r, RECORD), [])
        self.assertEqual(errors(r["skill"], "contracts/skill.schema.json"), [])
        for e in r["events"]:
            self.assertEqual(errors(e, EVENT), [], e["type"])

    def test_skill_matches_certified_fixture(self):
        self.assertEqual(self.decide()["skill"], fixture("skill-certified.json"))

    def test_deterministic(self):
        a, b = self.decide(), self.decide()
        self.assertEqual(a, b)
        self.assertRegex(a["decision"]["inputsDigest"], r"^sha256:[0-9a-f]{64}$")

    def test_teacher_evidence_from_runtime_record_events(self):
        skill = dict(self.skill, events=[e for e in self.events if e["type"] == "skill.observed"])
        self.assertTrue(self.decide(skill=skill, events=[])["decision"]["certified"])

    def test_reverify_recomputes_from_the_artifact(self):
        t = copy.deepcopy(self.transfer)
        t["artifact"]["path"] = os.path.join(FIX, "company.json")
        r = self.decide(transfer=t, reverify=True)
        self.assertTrue(r["decision"]["certified"])
        ruling = next(x for x in r["decision"]["rulings"] if x["rule"] == "verifier_checks_complete")
        self.assertEqual(ruling["evidence"]["source"], "re-run")


class DoesNotCertify(Base):
    def test_one_successful_run_is_not_enough(self):
        # The teacher's own run, replayed as an "exam": same agent, the case it learned from.
        t = copy.deepcopy(self.transfer)
        t["student"] = self.skill["teacher"]
        t["examCase"] = "teach-linear"
        r = self.decide(transfer=t)
        self.assertFailsOnly(r, "exam_case_unseen", "student_distinct_from_teacher", status="observed")
        self.assertEqual(r["events"], [])

    def test_same_agent_as_teacher(self):
        t = copy.deepcopy(self.transfer)
        t["student"] = self.skill["teacher"]
        self.assertFailsOnly(self.decide(transfer=t), "student_distinct_from_teacher", status="observed")

    def test_exam_case_is_the_teacher_case(self):
        t = dict(self.transfer, examCase="teach-linear")
        self.assertFailsOnly(self.decide(transfer=t), "exam_case_unseen", status="observed")

    def test_unknown_exam_case(self):
        t = dict(self.transfer, examCase="exam-nowhere")
        self.assertFailsOnly(self.decide(transfer=t), "exam_case_unseen", status="observed")

    def test_no_teacher_observation(self):
        self.assertFailsOnly(self.decide(events=[]), "teacher_run_verified", status="observed")

    def test_teacher_run_failed_its_verifier(self):
        events = copy.deepcopy(self.events)
        events[0]["payload"]["verification"]["passed"] = False
        self.assertFailsOnly(self.decide(events=events), "teacher_run_verified", status="observed")

    def test_failed_verifier_check_stays_transferred(self):
        r = self.decide(transfer=fixture("transfer-result-failed.json"))
        self.assertFailsOnly(r, "verifier_checks_passed", status="transferred")
        self.assertEqual(r["skill"]["transfer"]["passed"], False)
        self.assertEqual(r["events"], [])
        ruling = next(x for x in r["decision"]["rulings"] if x["rule"] == "verifier_checks_passed")
        self.assertEqual(ruling["evidence"]["failed"], ["source_urls_min_two"])

    def test_missing_required_check(self):
        t = copy.deepcopy(self.transfer)
        t["verification"]["checks"] = [c for c in t["verification"]["checks"] if c["name"] != "source_urls_min_two"]
        self.assertFailsOnly(self.decide(transfer=t), "verifier_checks_complete", status="transferred")

    def test_reported_pass_contradicts_checks(self):
        t = copy.deepcopy(self.transfer)
        t["verification"]["checks"][0]["passed"] = False  # checks fail but passed flags still say true
        r = self.decide(transfer=t)
        self.assertFailsOnly(r, "verifier_checks_passed", status="transferred")

    def test_reverify_catches_a_false_report(self):
        t = copy.deepcopy(self.transfer)  # the report says PASS, the artifact on disk does not
        t["artifact"]["path"] = os.path.join(FIX, "company-invalid.json")
        self.assertFailsOnly(self.decide(transfer=t, reverify=True), "verifier_checks_passed", status="transferred")

    def test_no_procedure(self):
        t = {k: v for k, v in self.transfer.items() if k != "procedureId"}
        self.assertFailsOnly(self.decide(transfer=t), "procedure_recalled", status="transferred")

    def test_different_procedure(self):
        t = dict(self.transfer, procedureId="procedures/ffff-something-else")
        self.assertFailsOnly(self.decide(transfer=t), "procedure_recalled", status="transferred")

    def test_wrong_artifact_type(self):
        t = copy.deepcopy(self.transfer)
        t["artifact"]["type"] = "score.json"
        self.assertFailsOnly(self.decide(transfer=t), "artifact_matches_skill", status="observed")

    def test_isolation_broken(self):
        r = self.decide(isolation=dict(ISOLATED, no_answer_leak_in_prompt=False))
        self.assertFailsOnly(r, "isolation_attested", status="transferred")

    def test_isolation_required_but_missing(self):
        r = self.decide(isolation=None, require_isolation=True)
        self.assertFailsOnly(r, "isolation_attested", status="transferred")

    def test_isolation_optional_by_default(self):
        self.assertTrue(self.decide(isolation=None)["decision"]["certified"])


class Registry(Base):
    def setUp(self):
        super().setUp()
        self.tmp = tempfile.TemporaryDirectory()
        registry.REGISTRY_DIR = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def student(self, i, metrics=None, transfer=None):
        t = copy.deepcopy(transfer or self.transfer)
        t["student"] = {"id": f"agent-student-{i:04d}", "name": f"Freshman #{i}", "harness": "qm"}
        t["runId"] = f"run-{i}"
        r = self.decide(transfer=t)
        if metrics:
            r["metrics"] = metrics
        return r

    def test_failed_exam_is_ledgered_not_promoted(self):
        self.assertFalse(registry.record_decision(self.decide(transfer=fixture("transfer-result-failed.json"))))
        self.assertIsNone(registry.load("research-company"))
        self.assertEqual(registry.index(), {"skills": []})
        self.assertEqual(len(registry.ledger()), 1)

    def test_certified_becomes_canonical_with_index_row(self):
        r = self.decide()
        self.assertTrue(registry.record_decision(r))
        self.assertEqual(registry.load("research-company"), r)
        row = registry.index()["skills"][0]
        self.assertEqual((row["id"], row["status"], row["examCase"]), ("research-company", "certified", "exam-northwind"))

    def test_better_record_replaces_worse_never_the_reverse(self):
        slow = self.student(1, {"toolCalls": 30, "durationMs": 90000})
        fast = self.student(2, {"toolCalls": 12, "durationMs": 40000})
        self.assertTrue(registry.record_decision(slow))
        self.assertTrue(registry.record_decision(fast))
        self.assertFalse(registry.record_decision(slow))
        self.assertEqual(registry.load("research-company")["transfer"]["runId"], "run-2")
        self.assertEqual(len(registry.ledger()), 3)

    def test_best_prefers_certified_over_cheaper_failure(self):
        failed = self.student(1, {"toolCalls": 1}, transfer=fixture("transfer-result-failed.json"))
        ok = self.student(2, {"toolCalls": 50})
        self.assertIs(registry.best([failed, ok]), ok)
        self.assertIsNone(registry.best([]))


class Cli(unittest.TestCase):
    def test_exit_codes(self):
        base = ["--skill", os.path.join(FIX, "skill-observed.json"), "--events", os.path.join(FIX, "events.json")]
        with open(os.devnull, "w") as null:
            stdout, sys.stdout = sys.stdout, null
            try:
                ok = certify.main(base + ["--transfer", os.path.join(FIX, "transfer-result.json")])
                bad = certify.main(base + ["--transfer", os.path.join(FIX, "transfer-result-failed.json")])
            finally:
                sys.stdout = stdout
        self.assertEqual((ok, bad), (0, 1))


if __name__ == "__main__":
    unittest.main()
