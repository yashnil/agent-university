#!/usr/bin/env python3
"""Transfer test: a fresh QM agent researches an unseen company from a Memorable procedure.

  scripts/transfer_run.py Vercel

Needs scripts/memorable_capture.py first (status observed, with a recalled procedureId). Then:

1. Native `memorable recall` picks the procedure for this task, and native `memorable show`
   renders it. That rendering is the only procedural knowledge given to the agent. It is
   appended to the turn text the way Memorable's own prompt hook injects context. The
   source answer never enters the prompt (leak-checked against the source artifact).
2. Fresh agent. A new QM project gives scope group:web-project-<id>, which means its own
   sandbox container and home volume. A new threadRef gives a new session. The source run
   used personal:<admin>, web:<admin>:default.
3. The turn does not name any QM skill, and the scout-research-company layer skill must be
   unpublished during the test (checked through /api/skills).
4. Contract lifecycle (schemas/contracts):
   - `skill.recalled` and `exam.started` are emitted before the turn.
   - Status becomes `transferred` when the run is done and <slug>/company.json exists in
     the fresh sandbox. Skill.transfer = {student, examCase, passed}.
   - Runtime stops there. `exam.passed`, `skill.certified` and status `certified` belong to
     certification (docs/HANDOFF.md section 2).
5. Freshness: before the turn the new scope has no sandbox, and the student's container and home
   volume must not be among those that existed before the exam; the artifact's mtime must be after
   the exam started.
   The contract TransferResult goes to .agent-university/transfers/<runId>.json, with producer-added
   keys certification needs: teacher, sourceCase, sourceRunId, exam timestamps, and `isolation`
   (every separation and freshness check: different scope, container, volume, session and threadRef;
   no read of the skill; no source artifact in the fresh sandbox; no leak in the prompt).
"""
import json
import os
import re
import sys
import time
import urllib.parse
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import au_record  # noqa: E402
import scout_run  # noqa: E402
from memorable_capture import ARTIFACT_TYPE, SKILL_ID, SKILL_NAME, leak_terms, leaks, memorable, scout_run_user  # noqa: E402

LAYER_SKILL = "scout-research-company"


def poll(opener, run_id):
    deadline = time.time() + scout_run.RUN_TIMEOUT_S
    while time.time() < deadline:
        try:
            status, run = scout_run.call(opener, "GET", f"/api/runs/{urllib.parse.quote(run_id)}")
        except TimeoutError:
            continue
        if isinstance(run, dict) and run.get("status") in ("done", "failed"):
            return run
        time.sleep(5)
    sys.exit(f"run {run_id} did not finish within {scout_run.RUN_TIMEOUT_S}s")


def published_skills(opener):
    status, body = scout_run.call(opener, "GET", "/api/skills")
    if status != 200:
        sys.exit(f"GET /api/skills failed: HTTP {status} {body}")
    items = body.get("skills", body) if isinstance(body, dict) else body
    return sorted({s.get("name") or s.get("manifest", {}).get("name")
                   for s in items if isinstance(s, dict) and s.get("status", "published") == "published"})


def skill_reads(run):
    """Every tool call that touched the layer skill, by skill:// URL or working-copy path."""
    hits = []
    for a in run.get("activity", []):
        if a["type"] == "tool_call" and LAYER_SKILL in json.dumps(a["payload"]):
            hits.append(a["payload"])
    return hits


def main():
    company = " ".join(sys.argv[1:]) or "Vercel"
    slug = scout_run.slugify(company)
    rec = au_record.load(SKILL_ID, SKILL_NAME, ARTIFACT_TYPE)
    if not rec.get("status") or not rec.get("procedureId"):
        sys.exit(f"{SKILL_NAME} has no recalled procedure yet; run memorable_capture.py first")
    source = rec["runtime"]["source"]
    exam_case = case_id("exam", company)
    if scout_run.slugify(source["company"]) == slug:
        sys.exit("the transfer company must differ from the source company")
    terms = leak_terms(json.loads(source_artifact_json(rec)))

    opener = scout_run.sign_in()
    skills = published_skills(opener)
    print(f"published skills: {', '.join(skills) or 'none'}")
    if LAYER_SKILL in skills:
        sys.exit(f"{LAYER_SKILL} is still published; hide it from the layer first (see PROGRESS.md)")

    task = (f'Research the company "{company}" from real public web sources and write '
            f"$HOME/workspace/scout/{slug}/company.json with company_name, website, product_summary "
            "and source_urls")
    _, recalled = memorable("recall", "--single", task)
    m = re.search(r"procedures/\S+", recalled)
    if not m:
        sys.exit(f"memorable recall found no procedure:\n{recalled}")
    proc = m.group(0)
    _, procedure = memorable("show", proc)
    print(f"--- memorable recall ---\n{recalled}\n--- memorable show {proc} ---\n{procedure}")

    prompt = (
        f'Research the company "{company}". Fetch real public sources with curl, write the artifact to '
        f"$HOME/workspace/scout/{slug}/company.json as a JSON object with exactly these keys: "
        "company_name, website (http(s) URL), product_summary (2-3 sentences), and source_urls "
        "(at least two distinct http(s) URLs you actually fetched). Validate it and reply with its "
        "absolute path.\n\n"
        "Procedural memory retrieved from Memorable for this task (a previous successful run, "
        "generalized; placeholders like <Company> stand for the current company):\n\n" + procedure
    )
    if leaks(prompt, terms):
        sys.exit(f"prompt contains source-specific values {leaks(prompt, terms)}")

    status, created = scout_run.call(opener, "POST", "/api/projects", {"name": f"au-transfer-{slug}-{int(time.time())}"})
    project = created.get("project") if isinstance(created, dict) else None
    if status not in (200, 201) or not project or not project.get("id"):
        sys.exit(f"project create failed: HTTP {status} {created}")
    scope = f"group:web-project-{project['id']}"
    thread_ref = f"web:{scout_run_user()}:{uuid.uuid4()}"
    print(f"fresh agent: project {project['id']}  scope {scope}  thread {thread_ref}")

    # Freshness: before the turn, the new scope has no sandbox (so no artifact can pre-exist), and
    # every existing sandbox container and home volume is recorded so the student's must be new.
    pre_containers = set(scout_run.sandboxes())
    pre_volumes = home_volumes()
    if any(scope_of(n) == scope for n in pre_containers):
        sys.exit(f"a sandbox for {scope} already exists; the student would not start fresh")
    exam_start = time.time()
    freshness = {"exam_start": au_record.now(), "scope_had_sandbox_before_exam": False,
                 "sandboxes_before_exam": len(pre_containers), "home_volumes_before_exam": len(pre_volumes)}
    print(f"freshness: no sandbox for {scope} before the exam ({len(pre_containers)} sandboxes, "
          f"{len(pre_volumes)} home volumes recorded)")

    status, turn = scout_run.call(opener, "POST", "/api/turn", {
        "text": prompt, "clientTurnId": str(uuid.uuid4()), "threadRef": thread_ref, "scopeId": scope})
    if status not in (200, 201, 202) or not isinstance(turn, dict) or not turn.get("runId"):
        sys.exit(f"turn rejected: HTTP {status} {turn}")
    run_id = turn["runId"]
    print(f"run {run_id} started")
    student = au_record.agent(thread_ref, "Scout (fresh student)")
    au_record.emit(rec, "skill.recalled", {"skillId": SKILL_ID, "procedureId": proc, "query": task,
                                           "rank": 1, "agent": student})
    au_record.emit(rec, "exam.started", {"skillId": SKILL_ID, "procedureId": proc, "examCase": exam_case,
                                         "student": student, "runId": run_id})
    au_record.save(rec)
    run = poll(opener, run_id)
    au_record.save_run(run_id, run)
    result = run.get("result") or {}
    print(f"run {run_id} status: {run.get('status')}\n--- agent reply ---\n{result.get('reply') or run.get('error')}\n---")

    names = [n for n in scout_run.sandboxes() if scope_of(n) == scope]
    found = scout_run.find_and_verify(f"workspace/scout/{slug}/company.json", names) if names else None
    written_at = artifact_mtime(found) if found else None
    freshness.update({"student_container_new": bool(found) and found["container"] not in pre_containers,
                      "student_home_volume_new": bool(found) and volume_name(found) not in pre_volumes,
                      "artifact_written_after_exam_start": written_at is not None and written_at >= exam_start - 5})
    source_in_fresh = scout_run.find_and_verify(
        f"workspace/scout/{scout_run.slugify(source['company'])}/company.json", names) if names else None
    reads = skill_reads(run)
    checks = {
        "different_agent": student["id"] != rec["teacher"]["id"],
        "different_session": result.get("sessionId") not in (None, source["session_id"]),
        "different_scope": bool(found) and found["scope"] != source["scope"],
        "different_container": bool(found) and found["container"] != source["container"],
        "different_home_volume": bool(found) and found["volume"] != source["home_volume"],
        "different_thread_ref": thread_ref != source["thread_ref"],
        "layer_skill_unpublished": LAYER_SKILL not in skills,
        "no_layer_skill_reads": not reads,
        "no_source_artifact_in_fresh_sandbox": source_in_fresh is None,
        "no_source_answer_in_prompt": not leaks(prompt, terms),
        "student_container_new": freshness["student_container_new"],
        "student_home_volume_new": freshness["student_home_volume_new"],
        "artifact_written_after_exam_start": freshness["artifact_written_after_exam_start"],
    }
    for k, v in checks.items():
        print(f"  [{'ok' if v else 'FAIL'}] {k}")
    verification = found["verification"] if found else {
        "passed": False, "checks": [{"name": "file_exists", "passed": False, "message": "no artifact in the fresh sandbox"}]}
    # Contract TransferResult (schemas/contracts/transfer-result.schema.json). The keys after `passed` are
    # producer additions, which contract consumers ignore: what certification needs to decide without QM.
    transfer_result = {
        "skillId": SKILL_ID, "procedureId": proc, "examCase": exam_case, "student": student, "runId": run_id,
        "artifact": {"type": ARTIFACT_TYPE, "path": found["path"] if found else f"$HOME/workspace/scout/{slug}/company.json"},
        "verification": verification, "passed": verification["passed"],
        "teacher": rec["teacher"], "sourceCase": case_id("teacher", source["company"]), "sourceRunId": source["run_id"],
        "examStartedAt": freshness["exam_start"], "examFinishedAt": au_record.now(),
        "isolation": checks,
    }
    tdir = os.path.join(au_record.RECORD_DIR, "transfers")
    os.makedirs(tdir, exist_ok=True)
    result_path = os.path.join(tdir, f"{run_id}.json")
    with open(result_path, "w") as f:
        json.dump(transfer_result, f, indent=2)
    rec["runtime"]["transfer"] = {
        "company": company, "run_id": run_id, "run_status": run.get("status"), "session_id": result.get("sessionId"),
        "admin_url": result.get("adminUrl"),
        "thread_ref": thread_ref, "scope": scope, "project_id": project["id"],
        "container": found and found["container"], "home_volume": found and found["volume"],
        "recall_query": task, "recall_output": recalled, "prompt": prompt,
        "separation_checks": checks, "layer_skill_reads": reads, "freshness": freshness,
        "result_path": os.path.relpath(result_path, au_record.DEPLOY_DIR),
    }

    # Runtime stops at `transferred`. exam.passed, skill.certified and status `certified` belong to
    # certification (docs/HANDOFF.md section 2), which decides from the TransferResult above.
    if run.get("status") != "done" or not found:
        au_record.save(rec)
        sys.exit(f"not transferred: the fresh run did not produce the artifact  ({result_path})")
    rec["transfer"] = {"student": student, "examCase": exam_case, "passed": transfer_result["passed"]}
    au_record.set_status(rec, "transferred")
    au_record.save(rec)
    print(f"\n{SKILL_NAME}: {rec['status']}, exam {'PASSED' if transfer_result['passed'] else 'FAILED'}, "
          f"isolation {'clean' if all(checks.values()) else 'NOT clean'}")
    for e in rec["events"]:
        print(f"  {e['at']}  {e['type']}")
    print(f"record: {au_record.path(SKILL_ID)}\ntransfer result: {result_path}")
    return 0 if transfer_result["passed"] and all(checks.values()) else 1

def scope_of(container):
    return scout_run.docker("inspect", "-f", '{{index .Config.Labels "qm.scope"}}', container).stdout.strip()


def home_volumes():
    r = scout_run.docker("volume", "ls", "--format", "{{.Name}}")
    return {v for v in r.stdout.split() if v.startswith("qm-home-")}


def volume_name(found):
    """The home volume's name from find_and_verify's "<name>:<dest> ..." mount list."""
    return next((m.split(":", 1)[0] for m in found["volume"].split() if m.endswith(":/root")), found["volume"])


def artifact_mtime(found):
    """The artifact's mtime (epoch seconds) inside its sandbox, or None. The sandbox is parked again after."""
    name = found["container"]
    parked = not scout_run.running(name)
    if parked and scout_run.docker("start", name).returncode != 0:
        return None
    try:
        out = scout_run.docker("exec", name, "stat", "-c", "%Y", found["path"]).stdout.strip()
        return int(out) if out.isdigit() else None
    finally:
        if parked:
            scout_run.docker("stop", "-t", "2", name)


def case_id(role, company):
    """The live demo/cases.json case with this role for this company."""
    with open(os.path.join(au_record.DEPLOY_DIR, "demo", "cases.json")) as f:
        cases = json.load(f)["cases"]
    for c in cases:
        if c["role"] == role and c["company"].lower() == company.lower() and not c.get("fixtureOnly"):
            return c["id"]
    sys.exit(f"{company} is not a {role} case in demo/cases.json")


def source_artifact_json(rec):
    """The source answer, read back from the source sandbox, used only for leak checks."""
    src = rec["runtime"]["source"]
    found = scout_run.find_and_verify(f"workspace/scout/{scout_run.slugify(src['company'])}/company.json",
                                      [src["container"]])
    if not found:
        sys.exit("source artifact is gone; cannot leak-check the transfer prompt")
    return found["content"]


if __name__ == "__main__":
    sys.exit(main())
