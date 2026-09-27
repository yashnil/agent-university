"""Runtime-side skill record, shaped by the frozen contracts in schemas/contracts.

One JSON file per skill: .agent-university/skills/<skill-id>.json (gitignored, since it
holds live run ids and scope names). It is a contract `Skill` (skill.schema.json) with
two runtime-only keys, which contract consumers ignore:
  events  : contract `Event`s (event.schema.json), oldest first
  runtime : evidence for this deployment (runs, containers, scopes, Memorable output)

Status only moves forward: observed -> transferred -> certified. The Milestone 2 stage
"reproduced" is not a status. It is the `skill.recalled` event emitted at capture time.
"""
import hashlib
import json
import os
from datetime import datetime, timezone

DEPLOY_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RECORD_DIR = os.path.join(DEPLOY_DIR, ".agent-university")
STATUSES = ["observed", "transferred", "certified"]
EVENT_TYPES = ["skill.observed", "skill.recalled", "exam.started", "exam.passed",
               "skill.certified", "plan.composed", "gap.discovered"]


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def path(skill_id):
    return os.path.join(RECORD_DIR, "skills", f"{skill_id}.json")


def load(skill_id, name, artifact_type):
    try:
        with open(path(skill_id)) as f:
            return json.load(f)
    except FileNotFoundError:
        return {"id": skill_id, "name": name, "status": None, "teacher": None,
                "artifactType": artifact_type, "events": [], "runtime": {}}


def save(rec):
    os.makedirs(os.path.dirname(path(rec["id"])), exist_ok=True)
    with open(path(rec["id"]), "w") as f:
        json.dump(rec, f, indent=2)
        f.write("\n")


def emit(rec, event_type, payload):
    if event_type not in EVENT_TYPES:
        raise ValueError(f"unknown event type {event_type!r}; the frozen list is {EVENT_TYPES}")
    rec["events"].append({"type": event_type, "at": now(), "payload": payload})


def set_status(rec, status):
    """Advance the status. It never moves backwards; re-observing restarts the record."""
    if status == "observed":
        rec["status"] = status
        return
    if rec["status"] is None or STATUSES.index(status) < STATUSES.index(rec["status"]):
        raise SystemExit(f"cannot move {rec['id']} from {rec['status']} to {status}")
    rec["status"] = status


def agent(thread_ref, name):
    """A contract AgentIdentity for a QM agent.

    A QM agent is one conversation thread (one thread has exactly one session). The id is
    a hash of the threadRef: it is stable before the first run and carries no email.
    """
    return {"id": "qm-thread-" + hashlib.sha256(thread_ref.encode()).hexdigest()[:12], "name": name, "harness": "qm"}


def save_run(run_id, run):
    d = os.path.join(RECORD_DIR, "runs")
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, f"{run_id}.json"), "w") as f:
        json.dump(run, f, indent=1)
