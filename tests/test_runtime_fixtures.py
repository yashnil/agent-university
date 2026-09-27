"""The sanitized live-run fixtures runtime shares (Linear -> Vercel transfer, Milestone 2).

  demo/fixtures/transfer-result-vercel.json      TransferResult (+ producer keys)
  demo/fixtures/skill-transferred-vercel.json    Skill in `transferred`: runtime's last state
  demo/fixtures/events-vercel-transferred.json   the events runtime emitted, in order
  demo/fixtures/company-vercel.json              the student's artifact

Offline. They validate against the frozen contracts, agree with each other, stop before
certification, and carry no personal or machine-specific data.
"""
import json
import os
import re
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(ROOT, "demo", "fixtures")
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import check_contracts as cc  # noqa: E402

FILES = {
    "transfer-result-vercel.json": "contracts/transfer-result.schema.json",
    "skill-transferred-vercel.json": "contracts/skill.schema.json",
    "events-vercel-transferred.json": "contracts/event.schema.json",
    "company-vercel.json": "company.schema.json",
}
LIFECYCLE = ["skill.observed", "skill.recalled", "exam.started", "exam.passed", "skill.certified"]
RUNTIME_EVENTS = {"skill.observed", "skill.recalled", "exam.started"}
# Anything that identifies the operator or this machine's QM deployment.
FORBIDDEN = [r"@", r"/Users/", r"/home/", r"qm-sbx-", r"qm-home-", r"personal:", r"group:web-project",
             r"web:[^\"]*:", r"adminUrl", r"admin/history", r"token", r"mk_[A-Za-z0-9]", r"localhost",
             r"\"/root/"]


def load(name):
    with open(os.path.join(FIX, name)) as f:
        raw = f.read()
    return raw, json.loads(raw)


class RuntimeFixtures(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw, cls.data = {}, {}
        for name in FILES:
            cls.raw[name], cls.data[name] = load(name)
        cls.tr = cls.data["transfer-result-vercel.json"]
        cls.skill = cls.data["skill-transferred-vercel.json"]
        cls.events = cls.data["events-vercel-transferred.json"]

    def test_valid_against_frozen_schemas(self):
        for name, rel in FILES.items():
            items = self.data[name] if isinstance(self.data[name], list) else [self.data[name]]
            errs = [e for item in items for e in cc.validate(item, cc.load_schema(rel), rel)]
            self.assertEqual(errs, [], name)

    def test_transfer_result_is_a_verified_isolated_pass(self):
        v = self.tr["verification"]
        self.assertTrue(self.tr["passed"] == v["passed"] == all(c["passed"] for c in v["checks"]) is True)
        self.assertEqual(len(v["checks"]), 6)
        self.assertTrue(all(self.tr["isolation"].values()), self.tr["isolation"])
        self.assertNotEqual(self.tr["student"]["id"], self.tr["teacher"]["id"])
        self.assertEqual((self.tr["sourceCase"], self.tr["examCase"]), ("teach-linear", "exam-vercel"))

    def test_verifier_reproduces_the_result_on_the_shared_artifact(self):
        path = os.path.join(ROOT, self.tr["artifact"]["path"])
        r = subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "verify_company.py"), "--json", path],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(json.loads(r.stdout), self.tr["verification"])

    def test_skill_stops_at_transferred_and_matches_the_result(self):
        s, tr = self.skill, self.tr
        self.assertEqual(s["status"], "transferred")
        self.assertEqual(s["transfer"], {"student": tr["student"], "examCase": tr["examCase"], "passed": tr["passed"]})
        self.assertEqual((s["id"], s["procedureId"], s["teacher"]), (tr["skillId"], tr["procedureId"], tr["teacher"]))

    def test_events_are_runtime_only_and_in_lifecycle_order(self):
        types = [e["type"] for e in self.events]
        self.assertEqual(set(types), RUNTIME_EVENTS)  # no faked exam.passed / skill.certified
        self.assertEqual(types, sorted(types, key=LIFECYCLE.index))
        started = [e for e in self.events if e["type"] == "exam.started"][-1]["payload"]
        self.assertEqual((started["student"], started["runId"], started["examCase"]),
                         (self.tr["student"], self.tr["runId"], self.tr["examCase"]))
        recalls = [e["payload"] for e in self.events if e["type"] == "skill.recalled"]
        self.assertIn(self.tr["student"], [p.get("agent") for p in recalls])
        self.assertTrue(all(p["procedureId"] == self.tr["procedureId"] for p in recalls))

    def test_no_personal_or_machine_data(self):
        for name, text in self.raw.items():
            for pat in FORBIDDEN:
                self.assertIsNone(re.search(pat, text), f"{name} matches {pat!r}")
            for agent_id in re.findall(r"qm-thread-[\w-]+", text):
                self.assertTrue(agent_id.startswith("qm-thread-sanitized-"), f"{name}: unsanitized id {agent_id}")


# Other committed data derived from the live runs: the recorded run metrics and the frozen final demo.
DERIVED = ["run-metrics.json", "final-demo.json", "composite/repo_analysis-vercel.json", "composite/score-vercel.json"]


class DerivedFixturesArePrivate(unittest.TestCase):
    def test_no_personal_or_machine_data(self):
        patterns = [p for p in FORBIDDEN if p != r"token"] + [r"#token="]
        for name in DERIVED:
            with open(os.path.join(FIX, name)) as f:
                text = f.read()
            for pat in patterns:
                self.assertIsNone(re.search(pat, text), f"{name} matches {pat!r}")
            for agent_id in re.findall(r"qm-thread-[\w-]+", text):
                self.assertTrue(agent_id.startswith("qm-thread-sanitized-"), f"{name}: unsanitized id {agent_id}")

    def test_run_metrics_record_no_invented_tokens(self):
        with open(os.path.join(FIX, "run-metrics.json")) as f:
            runs = json.load(f)["runs"]
        self.assertEqual([r["role"] for r in runs], ["teacher", "student"])
        self.assertTrue(all(r["tokens"] is None for r in runs))


if __name__ == "__main__":
    unittest.main()
