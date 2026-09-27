#!/usr/bin/env python3
"""Capture a successful QM Scout run as a Memorable procedure.

  scripts/memorable_capture.py --run <runId> --company "Linear"

Memorable has no QM integration, so this is the adapter between them:

1. Observe. Loads the QM run (portal /api/runs/:id, cached under .agent-university/runs,
   because core keeps run activity for only 1 hour). Re-verifies the run's company.json in
   the run's own sandbox with scripts/verify_company.py, which must PASS. The record gets
   status `observed`, and a `skill.observed` event is emitted.
2. Converts the run's `execute` tool calls into a Memorable trace and generalizes it. The
   company name, domain, Wikipedia title and slug become placeholders, and the written JSON
   body becomes a schema template. A leak check built from the source artifact's own values
   (name, domain, URLs, proper nouns and numbers in the summary) must find nothing, or the
   capture aborts before anything is sent.
3. Stores it with native `memorable ingest <trace.json>`. Memorable's hosted extractor turns
   the trace into a procedure, and the CLI writes it to the local store.
4. Recall (Milestone 2's "reproduced"). Native `memorable recall` for an unseen company
   must rank the new procedure first, and native `memorable show` must render it with the
   same leak check passing. Then the record's procedureId is set and `skill.recalled` is
   emitted.

The record is .agent-university/skills/research-company.json (see scripts/au_record.py).

Requires `memorable login` (ingest refuses without API credentials).
"""
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import au_record  # noqa: E402
import scout_run  # noqa: E402

MEMORABLE = os.path.expanduser("~/.memorable/bin/memorable")
SKILL_ID = "research-company"
SKILL_NAME = "Research Company"
ARTIFACT_TYPE = "company.json"
TASK = ("Research a company from real public web sources and write a validated "
        "$HOME/workspace/scout/<slug>/company.json with company_name, website, "
        "product_summary and source_urls")
PROMPT = ('Research the company "<Company>". Fetch real public sources with curl, write the artifact to '
          "$HOME/workspace/scout/<slug>/company.json, validate it, and reply with its absolute path.")
JSON_TEMPLATE = """{
  "company_name": "<Company>",
  "website": "https://<company-domain>",
  "product_summary": "<2-3 sentences from the fetched pages: what the product is, who it is for, how it is positioned>",
  "source_urls": [
    "https://<company-domain>",
    "https://<company-domain>/about",
    "https://en.wikipedia.org/wiki/<Wikipedia_Title>"
  ]
}"""
# Capitalized words that carry no company-specific answer.
GENERIC = {"It", "The", "A", "An", "In", "Its", "With", "And", "For", "Inc"}


def memorable(*args, stdin=None):
    r = subprocess.run([MEMORABLE, *args], capture_output=True, text=True, input=stdin)
    return r.returncode, (r.stdout + r.stderr).strip()


def load_run(opener, run_id):
    cached = os.path.join(au_record.RECORD_DIR, "runs", f"{run_id}.json")
    if os.path.exists(cached):
        with open(cached) as f:
            return json.load(f)
    status, run = scout_run.call(opener, "GET", f"/api/runs/{urllib.parse.quote(run_id)}")
    if status != 200 or not isinstance(run, dict):
        sys.exit(f"cannot load run {run_id}: HTTP {status}")
    au_record.save_run(run_id, run)
    return run


def leak_terms(artifact):
    """Everything in the source answer that must not reach Memorable."""
    domain = urllib.parse.urlparse(artifact["website"]).netloc.removeprefix("www.")
    terms = {artifact["company_name"], domain, *artifact["source_urls"]}
    terms |= {w for w in re.findall(r"\b[A-Z][A-Za-z]+\b", artifact["product_summary"]) if w not in GENERIC}
    terms |= set(re.findall(r"\b\d[\d,]*\d\b", artifact["product_summary"]))
    # Any run of 4 consecutive summary words: catches a copied answer phrase even when it is all lowercase.
    words = re.findall(r"[A-Za-z0-9][A-Za-z0-9'-]*", artifact["product_summary"])
    terms |= {" ".join(words[i:i + 4]) for i in range(len(words) - 3)}
    return sorted(t for t in terms if t)


def leaks(text, terms):
    """The terms found in `text`, case-insensitive, on word boundaries, any whitespace between words."""
    return [t for t in terms
            if re.search(r"(?<![A-Za-z0-9])" + r"\s+".join(map(re.escape, t.split())) + r"(?![A-Za-z0-9])", text, re.I)]


def generalizer(artifact, slug):
    domain = urllib.parse.urlparse(artifact["website"]).netloc.removeprefix("www.")
    wiki = [u.split("/wiki/", 1)[1] for u in artifact["source_urls"] if "/wiki/" in u]
    name = artifact["company_name"]

    def generalize(text):
        text = re.sub(r"(company\.json\"? <<'EOF'\n).*?(\nEOF)", lambda m: m.group(1) + JSON_TEMPLATE + m.group(2),
                      text, flags=re.S)
        for title in wiki:
            text = text.replace(title, "<Wikipedia_Title>")
        text = re.sub(rf"(?:www\.)?{re.escape(domain)}", "<company-domain>", text, flags=re.I)
        text = text.replace(f"scout/{slug}", "scout/<slug>")
        return re.sub(rf"(?<![A-Za-z0-9]){re.escape(name)}(?![A-Za-z0-9])", "<Company>", text, flags=re.I)

    return generalize


def build_trace(run_id, run, generalize, terms):
    calls, results, corpus = [], {}, ["[user]", PROMPT]
    for a in run.get("activity", []):
        p = a["payload"]
        if a["type"] == "tool_result":
            results[p["callId"]] = p
        elif a["type"] == "tool_call" and p.get("tool") == "execute":
            calls.append(p)
        elif a["type"] in ("text", "thinking"):
            t = generalize(p.get("text") or p.get("thinking") or "").strip()
            if t and not leaks(t, terms):
                corpus += ["[assistant]", t]
    tool_calls = []
    for c in calls:
        r = results.get(c["callId"], {})
        # QM's `execute` is a shell exec with a `command`, the same shape as Bash.
        tool_calls.append({"name": "Bash", "input": {"command": generalize(c["command"])},
                           "result": {"exit_code": r.get("code"), "ok": not r.get("isError", True)}})
    return {"session_id": f"qm-run-{run_id}", "workflow_id": f"qm-run-{run_id}", "prompt": PROMPT,
            "task_description": TASK, "corpus": "\n".join(corpus), "tool_calls": tool_calls}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True, help="QM run id of the successful Scout run")
    ap.add_argument("--company", required=True, help="company that run researched")
    ap.add_argument("--dry-run", action="store_true", help="build and check the trace, send nothing")
    args = ap.parse_args()
    slug = scout_run.slugify(args.company)

    opener = scout_run.sign_in()
    run = load_run(opener, args.run)
    if run.get("status") != "done":
        sys.exit(f"run {args.run} is {run.get('status')}, not done")
    source_scope = f"personal:{scout_run_user()}"
    names = [n for n in scout_run.sandboxes()
             if scout_run.docker("inspect", "-f", '{{index .Config.Labels "qm.scope"}}', n).stdout.strip()
             == source_scope]
    found = scout_run.find_and_verify(f"workspace/scout/{slug}/company.json", names)
    if not found or found["returncode"] != 0:
        sys.exit("observed requires the source artifact to PASS the verifier")
    artifact = json.loads(found["content"])

    rec = au_record.load(SKILL_ID, SKILL_NAME, ARTIFACT_TYPE)
    thread_ref = f"web:{scout_run_user()}:default"
    teacher = au_record.agent(thread_ref, "Scout (teacher)")
    source = {
        "company": args.company,
        "run_id": args.run,
        "session_id": run["result"]["sessionId"],
        "thread_ref": thread_ref,
        "scope": found["scope"],
        "container": found["container"],
        "home_volume": found["volume"],
        "artifact_path": found["path"],
        "admin_url": run["result"].get("adminUrl"),
    }

    terms = leak_terms(artifact)
    generalize = generalizer(artifact, slug)
    trace = build_trace(args.run, run, generalize, terms)
    blob = json.dumps(trace)
    bad = leaks(blob, terms)
    if bad:
        sys.exit(f"trace still contains source-specific values {bad}; nothing sent")
    tdir = os.path.join(au_record.RECORD_DIR, "memorable")
    os.makedirs(tdir, exist_ok=True)
    trace_path = os.path.join(tdir, f"trace-{args.run}.json")
    with open(trace_path, "w") as f:
        json.dump(trace, f, indent=2)
    print(f"trace: {trace_path} ({len(trace['tool_calls'])} tool calls, leak check clean over {len(terms)} terms)")
    if args.dry_run:
        print(json.dumps(trace, indent=2))
        return 0

    rec.update({"teacher": teacher, "status": None, "events": [], "runtime": {"source": source}})
    rec.pop("procedureId", None)
    rec.pop("transfer", None)
    au_record.set_status(rec, "observed")
    au_record.emit(rec, "skill.observed", {
        "skillId": SKILL_ID, "teacher": teacher, "artifactType": ARTIFACT_TYPE, "runId": args.run,
        "artifactPath": found["path"], "verification": found["verification"]})
    au_record.save(rec)

    code, out = memorable("ingest", trace_path)
    print(out)
    m = re.search(r"stored (procedures/\S+?),", out)
    if code != 0 or not m:
        sys.exit("memorable ingest did not store a procedure")
    proc = m.group(1)

    probe = ('Research the company "Acme Robotics" from real public web sources and write '
             "$HOME/workspace/scout/acme-robotics/company.json with company_name, website, "
             "product_summary and source_urls")
    _, recalled = memorable("recall", "--single", probe)
    _, shown = memorable("show", proc)
    print(f"--- memorable recall (unseen company) ---\n{recalled}\n--- memorable show {proc} ---\n{shown}")
    first = re.search(r"procedures/\S+", recalled)
    shown_leaks = leaks(shown, terms)
    rec["runtime"]["memorable"] = {
        "trace_path": os.path.relpath(trace_path, au_record.DEPLOY_DIR), "ingest_output": out,
        "recall_probe": probe, "recall_output": recalled, "show_output": shown,
        "leak_terms_checked": len(terms), "leaks_in_stored_procedure": shown_leaks,
    }
    au_record.save(rec)
    if not first or first.group(0) != proc or shown_leaks:
        sys.exit(f"procedure not recalled cleanly: top recall={first and first.group(0)}, leaks={shown_leaks}")
    rec["procedureId"] = proc
    au_record.emit(rec, "skill.recalled", {"skillId": SKILL_ID, "procedureId": proc, "query": probe, "rank": 1})
    au_record.save(rec)
    print(f"{SKILL_NAME}: {rec['status']}, procedure {proc} recalled  ({au_record.path(SKILL_ID)})")
    return 0

def scout_run_user():
    """The seeded admin, the owner of the source scope.

    Read from ADMIN_GRANTS ("<email>:org_admin"), in the environment or in the gitignored .env,
    the same place `qm admin-login` reads it (qm.config.jsonc secretEnv). It is never committed.
    """
    grants = os.environ.get("ADMIN_GRANTS", "")
    if not grants:
        try:
            with open(os.path.join(au_record.DEPLOY_DIR, ".env")) as f:
                m = re.search(r"^ADMIN_GRANTS=(.*)$", f.read(), re.M)
            grants = m.group(1).strip().strip("'\"") if m else ""
        except OSError:
            pass
    admins = [e.rsplit(":", 1)[0].strip() for e in grants.split(",") if e.strip().endswith(":org_admin")]
    if len(admins) != 1:
        sys.exit("set exactly one <email>:org_admin in ADMIN_GRANTS (.env or environment)")
    return admins[0]

if __name__ == "__main__":
    sys.exit(main())
