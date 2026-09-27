#!/usr/bin/env python3
"""Company skill registry: the source of truth for what the organization trusts.

Lives in the repo under registry/ so it is versioned, reviewable and shared:

  registry/ledger.jsonl         every certification decision, pass or fail, append-only (audit trail)
  registry/skills/<id>.json     the canonical CertificationRecord of each *certified* skill
  registry/index.json           one summary row per certified skill (what the UI lists)

Only a certified record can become canonical, and a certified skill is never replaced by a
worse one: `better()` ranks records deterministically (see RANK). Failed exams are kept in
the ledger so a judge can see why a skill did not graduate.

  registry.py list                 print the index
  registry.py show <skill-id>      print a skill's canonical record
  registry.py ledger [<skill-id>]  print decisions, oldest first
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGISTRY_DIR = os.path.join(ROOT, "registry")


def _p(*parts):
    return os.path.join(REGISTRY_DIR, *parts)


def _write_json(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(value, f, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def rank_key(record):
    """Higher is better. Deterministic: certified first, then more checks passed, then cheaper
    and faster runs (record.metrics, when the runtime supplies them), then runId as a tiebreak."""
    d = record["decision"]
    passed = next((r["evidence"].get("passedCount", 0) for r in d["rulings"]
                   if r["rule"] == "verifier_checks_passed"), 0)
    m = record.get("metrics") or {}
    big = float("inf")
    return (d["certified"], sum(r["passed"] for r in d["rulings"]), passed,
            -m.get("costUsd", big), -m.get("toolCalls", big), -m.get("durationMs", big),
            str(record["transfer"].get("runId") or ""))


RANK = "certified > rules passed > checks passed > lower costUsd > fewer toolCalls > lower durationMs > runId"


def best(records):
    """The best record of a batch (e.g. a swarm of students), or None if the batch is empty."""
    return max(records, key=rank_key) if records else None


def load(skill_id):
    try:
        with open(_p("skills", f"{skill_id}.json")) as f:
            return json.load(f)
    except FileNotFoundError:
        return None


def ledger(skill_id=None):
    try:
        with open(_p("ledger.jsonl")) as f:
            rows = [json.loads(line) for line in f if line.strip()]
    except FileNotFoundError:
        return []
    return [r for r in rows if skill_id is None or r["skill"]["id"] == skill_id]


def index():
    try:
        with open(_p("index.json")) as f:
            return json.load(f)
    except FileNotFoundError:
        return {"skills": []}


def summary(record):
    t, d = record["transfer"], record["decision"]
    return {
        "id": record["skill"]["id"],
        "name": record["skill"].get("name"),
        "status": record["skill"]["status"],
        "artifactType": record["skill"].get("artifactType"),
        "teacher": record["teacher"],
        "student": t["student"],
        "examCase": t["examCase"],
        "procedureId": record.get("procedureId"),
        "certifiedAt": d["decidedAt"],
        "policy": d["policy"]["id"],
        "record": f"registry/skills/{record['skill']['id']}.json",
    }


def record_decision(record):
    """Append the decision to the ledger; promote it if it is certified and beats the current one.
    Returns True when the record became the skill's canonical record."""
    os.makedirs(REGISTRY_DIR, exist_ok=True)
    with open(_p("ledger.jsonl"), "a") as f:
        f.write(json.dumps(record, sort_keys=True) + "\n")
    if not record["decision"]["certified"]:
        return False
    skill_id = record["skill"]["id"]
    current = load(skill_id)
    if current is not None and rank_key(current) >= rank_key(record):
        return False
    _write_json(_p("skills", f"{skill_id}.json"), record)
    rows = [s for s in index()["skills"] if s["id"] != skill_id] + [summary(record)]
    _write_json(_p("index.json"), {"skills": sorted(rows, key=lambda s: s["id"])})
    return True


def main(argv):
    cmd = argv[0] if argv else "list"
    if cmd == "list":
        print(json.dumps(index(), indent=2))
    elif cmd == "show" and len(argv) == 2:
        rec = load(argv[1])
        if rec is None:
            sys.exit(f"{argv[1]} is not certified")
        print(json.dumps(rec, indent=2))
    elif cmd == "ledger":
        for r in ledger(argv[1] if len(argv) > 1 else None):
            print(f"{r['decision']['decidedAt']}  {r['skill']['id']:<20} "
                  f"{r['transfer']['student'].get('id', '?'):<24} {r['decision']['summary']}")
    else:
        sys.exit(__doc__)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
