#!/usr/bin/env python3
"""Certification engine: decide whether a skill graduates to `certified`.

One successful run is not enough. A skill becomes trusted only when a *different* agent,
given only the recalled procedure, passes an *unseen* exam case and the artifact passes
every required deterministic verifier check.

  candidate Skill + TransferResult + VerificationResult
                        |
               certification policy (rules below, all deterministic)
                        |
        CertificationRecord (schemas/certification-record.schema.json)

Usage:
  certify.py --skill <skill.json> --transfer <transfer-result.json>
             [--events <events.json>] [--isolation <facts.json>] [--reverify]
             [--require-isolation] [--promote] [--json]

  --skill      a contract Skill, or a runtime record (.agent-university/skills/<id>.json)
               whose `events` array carries the teacher's `skill.observed` event
  --events     extra contract Events (e.g. demo/fixtures/events.json) to find skill.observed in
  --isolation  {"<fact>": true|false, ...} from the runtime, e.g. different_scope, no_leak
  --reverify   re-run the artifact's verifier on artifact.path instead of trusting the report
  --promote    write the record to the company registry (registry/, see scripts/registry.py)

Exit 0 when certified, 1 when not. No network, no LLM: the same inputs always give the
same decision, and every rule says why it passed or failed.
"""
import hashlib
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POLICY_ID = "au-transfer-v1"
RECORD_VERSION = 1

# Per artifact type: the verifier CLI and the check names it must report. A verifier that
# silently drops a check cannot certify anything.
VERIFIERS = {
    "company.json": {
        "cli": os.path.join(ROOT, "scripts", "verify_company.py"),
        "requiredChecks": ["file_exists", "valid_json_object", "company_name_present",
                           "website_valid_url", "product_summary_present", "source_urls_min_two"],
    },
}

# Rule ids, in evaluation order. Stable snake_case: the UI and tests key on them.
RULES = [
    "teacher_run_verified",
    "procedure_recalled",
    "exam_case_unseen",
    "student_distinct_from_teacher",
    "artifact_matches_skill",
    "verifier_checks_complete",
    "verifier_checks_passed",
    "isolation_attested",
]
# The rules that must hold for an exam to have *happened* (status `transferred`).
TRANSFER_RULES = ["teacher_run_verified", "exam_case_unseen", "student_distinct_from_teacher",
                  "artifact_matches_skill"]
STATUSES = ["observed", "transferred", "certified"]


def load_cases(path=None):
    with open(path or os.path.join(ROOT, "demo", "cases.json")) as f:
        return json.load(f)["cases"]


def digest(*values):
    return "sha256:" + hashlib.sha256(
        json.dumps(values, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def teacher_observation(skill, events):
    """The latest `skill.observed` payload for this skill by its teacher, or None."""
    teacher_id = (skill.get("teacher") or {}).get("id")
    found = None
    for e in list(skill.get("events") or []) + list(events or []):
        p = e.get("payload") or {}
        if e.get("type") == "skill.observed" and p.get("skillId") == skill.get("id") \
                and (p.get("teacher") or {}).get("id") == teacher_id:
            found = p
    return found


def run_verifier(artifact_type, path):
    """Re-run the deterministic verifier CLI. Returns a VerificationResult or None."""
    v = VERIFIERS.get(artifact_type)
    if not v:
        return None
    r = subprocess.run([sys.executable, v["cli"], "--json", path], capture_output=True, text=True)
    try:
        return json.loads(r.stdout)
    except ValueError:
        return None


def certify(skill, transfer, *, cases=None, events=None, isolation=None, reverify=False,
            require_isolation=False, decided_at=None):
    """Pure policy decision (apart from the optional verifier re-run). Returns a CertificationRecord."""
    cases = load_cases() if cases is None else cases
    rulings = []

    def rule(rid, ok, reason, **evidence):
        rulings.append({"rule": rid, "passed": bool(ok), "reason": reason, "evidence": evidence})
        return bool(ok)

    teacher = skill.get("teacher") or {}
    student = transfer.get("student") or {}
    verification = transfer.get("verification") or {"passed": False, "checks": []}
    artifact = transfer.get("artifact") or {}
    artifact_type = skill.get("artifactType")

    # 1. The skill was observed: a teacher produced an artifact that passed its verifier.
    obs = teacher_observation(skill, events)
    if not teacher.get("id"):
        rule("teacher_run_verified", False, "skill has no teacher")
    elif obs is None:
        rule("teacher_run_verified", False, f"no skill.observed event by teacher {teacher['id']}",
             teacher=teacher)
    else:
        ok = (obs.get("verification") or {}).get("passed") is True
        rule("teacher_run_verified", ok,
             f"teacher run {obs.get('runId')} {'passed' if ok else 'did not pass'} its verifier",
             teacher=teacher, runId=obs.get("runId"), artifactPath=obs.get("artifactPath"))

    # 2. The student worked from the stored procedure (Memorable), not from the teacher's answer.
    proc, want = transfer.get("procedureId"), skill.get("procedureId")
    rule("procedure_recalled", bool(proc) and (not want or proc == want),
         "no procedureId on the transfer" if not proc
         else f"student used procedure {proc}" if not want or proc == want
         else f"student used {proc} but the skill's procedure is {want}",
         procedureId=proc, skillProcedureId=want)

    # 3. The exam case is a known exam case for this skill and differs from what the teacher saw.
    by_id = {c["id"]: c for c in cases}
    exam = by_id.get(transfer.get("examCase"))
    taught = [c for c in cases if c.get("role") == "teacher" and c.get("skillId") == skill.get("id")]
    if exam is None:
        rule("exam_case_unseen", False, f"exam case {transfer.get('examCase')!r} is not in demo/cases.json")
    elif exam.get("role") != "exam" or exam.get("skillId") != skill.get("id"):
        rule("exam_case_unseen", False, f"{exam['id']} is not an exam case for {skill.get('id')}",
             examCase=exam)
    else:
        seen = [c["company"] for c in taught]
        ok = exam["company"] not in seen
        rule("exam_case_unseen", ok,
             f"exam company {exam['company']} differs from teacher case {', '.join(seen) or '(none)'}" if ok
             else f"exam company {exam['company']} is the case the teacher learned from",
             examCase=exam["id"], examCompany=exam["company"], teacherCases=seen)

    # 4. A different agent took the exam.
    ok = bool(student.get("id")) and student.get("id") != teacher.get("id")
    rule("student_distinct_from_teacher", ok,
         f"student {student.get('id')} ({student.get('harness')}) != teacher {teacher.get('id')} "
         f"({teacher.get('harness')})" if ok else "student and teacher are the same agent" if student.get("id")
         else "transfer has no student",
         student=student, teacher=teacher, crossHarness=student.get("harness") != teacher.get("harness"))

    # 5. The exam is for this skill and produced this skill's artifact type.
    ok = transfer.get("skillId") == skill.get("id") and artifact.get("type") == artifact_type
    rule("artifact_matches_skill", ok,
         f"{artifact.get('type')} at {artifact.get('path')}" if ok
         else f"transfer is {transfer.get('skillId')}/{artifact.get('type')}, "
              f"skill is {skill.get('id')}/{artifact_type}",
         artifact=artifact)

    # Optional: do not trust the reported verification; recompute it from the artifact.
    reverified = None
    if reverify and artifact.get("path"):
        reverified = run_verifier(artifact_type, artifact["path"])
        if reverified is not None:
            verification = reverified

    # 6. Every required check ran.
    spec = VERIFIERS.get(artifact_type)
    names = [c.get("name") for c in verification.get("checks") or []]
    if spec is None:
        rule("verifier_checks_complete", False, f"no deterministic verifier registered for {artifact_type}")
    else:
        missing = [n for n in spec["requiredChecks"] if n not in names]
        rule("verifier_checks_complete", not missing,
             f"all {len(spec['requiredChecks'])} required checks reported" if not missing
             else f"missing required checks: {', '.join(missing)}",
             required=spec["requiredChecks"], reported=names,
             source="re-run" if reverified is not None else "reported")

    # 7. Every check passed, and the pass flags agree with each other.
    checks = verification.get("checks") or []
    failed = [c["name"] for c in checks if not c.get("passed")]
    consistent = verification.get("passed") == (bool(checks) and not failed) \
        and (reverified is not None or transfer.get("passed") == verification.get("passed"))
    ok = bool(checks) and not failed and consistent
    rule("verifier_checks_passed", ok,
         f"{len(checks)}/{len(checks)} checks passed" if ok
         else f"failed checks: {', '.join(failed)}" if failed
         else "no checks reported" if not checks
         else "passed flags disagree with the checks",
         passedCount=len(checks) - len(failed), total=len(checks), failed=failed)

    # 8. Isolation facts from the runtime (different scope/sandbox/session, no leak), if any.
    facts = isolation or {}
    broken = sorted(k for k, v in facts.items() if v is not True)
    if not facts:
        rule("isolation_attested", not require_isolation,
             "no isolation facts supplied" + (" but the policy requires them" if require_isolation
                                              else "; distinct agent identity only"))
    else:
        rule("isolation_attested", not broken,
             f"all {len(facts)} isolation facts hold" if not broken
             else f"isolation broken: {', '.join(broken)}", facts=facts)

    passed = {r["rule"]: r["passed"] for r in rulings}
    certified = all(passed.values())
    transferred = all(passed[r] for r in TRANSFER_RULES)
    status = "certified" if certified else "transferred" if transferred else "observed"
    failed_rules = [r["rule"] for r in rulings if not r["passed"]]
    exam_passed = transferred and passed["verifier_checks_passed"] and passed["verifier_checks_complete"]

    at = decided_at or _now()
    exam_case = transfer.get("examCase")
    contract_skill = {k: skill[k] for k in ("id", "name", "teacher", "artifactType", "procedureId") if k in skill}
    contract_skill["status"] = status
    if transferred:
        contract_skill["transfer"] = {"student": student, "examCase": exam_case, "passed": certified}

    events_out = []
    if exam_passed:
        payload = {"skillId": skill.get("id"), "examCase": exam_case, "student": student,
                   "verification": verification}
        if artifact.get("path"):
            payload["artifactPath"] = artifact["path"]
        events_out.append({"type": "exam.passed", "at": at, "payload": payload})
    if certified:
        payload = {"skillId": skill.get("id"), "teacher": teacher, "student": student, "examCase": exam_case}
        if transfer.get("procedureId"):
            payload["procedureId"] = transfer["procedureId"]
        events_out.append({"type": "skill.certified", "at": at, "payload": payload})

    record = {
        "recordVersion": RECORD_VERSION,
        "skill": contract_skill,
        "teacher": teacher,
        "procedureId": transfer.get("procedureId") or skill.get("procedureId"),
        "transfer": {
            "student": student,
            "examCase": exam_case,
            "runId": transfer.get("runId"),
            "artifact": artifact,
            "passed": certified,
        },
        "verification": verification,
        "decision": {
            "certified": certified,
            "status": status,
            "policy": {"id": POLICY_ID, "rules": RULES, "requireIsolation": require_isolation},
            "summary": (f"CERTIFIED: all {len(rulings)} rules passed" if certified
                        else f"NOT CERTIFIED ({status}): failed {', '.join(failed_rules)}"),
            "failedRules": failed_rules,
            "rulings": rulings,
            "decidedAt": at,
            "inputsDigest": digest(skill, transfer, isolation, reverified),
        },
        "events": events_out,
    }
    if exam:
        record["transfer"]["examCompany"] = exam["company"]
    if not transfer.get("runId"):
        del record["transfer"]["runId"]
    if not record["procedureId"]:
        del record["procedureId"]
    return record


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def explain(record):
    lines = [f"skill: {record['skill']['id']} ({record['skill'].get('name')})",
             f"teacher: {record['teacher'].get('name')} [{record['teacher'].get('id')}]",
             f"student: {record['transfer']['student'].get('name')} [{record['transfer']['student'].get('id')}]",
             f"exam:    {record['transfer']['examCase']} ({record['transfer'].get('examCompany')})",
             f"policy:  {record['decision']['policy']['id']}"]
    for r in record["decision"]["rulings"]:
        lines.append(f"  [{'ok' if r['passed'] else 'FAIL'}] {r['rule']}: {r['reason']}")
    lines.append(record["decision"]["summary"])
    return "\n".join(lines)


def _read(path):
    with open(path) as f:
        return json.load(f)


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--skill", required=True)
    ap.add_argument("--transfer", required=True)
    ap.add_argument("--events")
    ap.add_argument("--isolation")
    ap.add_argument("--cases")
    ap.add_argument("--reverify", action="store_true")
    ap.add_argument("--require-isolation", action="store_true")
    ap.add_argument("--promote", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)

    record = certify(_read(a.skill), _read(a.transfer),
                     cases=load_cases(a.cases) if a.cases else None,
                     events=_read(a.events) if a.events else None,
                     isolation=_read(a.isolation) if a.isolation else None,
                     reverify=a.reverify, require_isolation=a.require_isolation)
    if a.promote:
        import registry
        registry.record_decision(record)
    print(json.dumps(record, indent=2) if a.json else explain(record))
    return 0 if record["decision"]["certified"] else 1


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    sys.exit(main())
