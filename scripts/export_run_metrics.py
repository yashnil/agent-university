#!/usr/bin/env python3
"""Export the recorded metrics of the real teacher and student runs to a shareable fixture.

  scripts/export_run_metrics.py        writes demo/fixtures/run-metrics.json

Reads the cached QM runs (.agent-university/runs/<runId>.json, gitignored) and keeps only what
QM actually recorded: wall-clock (the run's startedAt/finishedAt) and tool calls (the `execute`
shell calls, and how many of them failed). QM's run API records no token usage, so tokens are
null rather than estimated. No prompt, command, output, scope or identity leaves the cache.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import au_record  # noqa: E402

RUNS = [  # role, case, run id (PROGRESS.md, Milestone 2)
    ("teacher", "teach-linear", "9f8d36da-12d3-4d42-bd7d-924fce932f46"),
    ("student", "exam-vercel", "5e30ec98-4e35-48eb-9460-d40b8ded3bc3"),
]
OUT = os.path.join(au_record.DEPLOY_DIR, "demo", "fixtures", "run-metrics.json")


def metrics(run):
    acts = run.get("activity", [])
    results = {a["payload"].get("callId"): a["payload"] for a in acts if a["type"] == "tool_result"}
    shell = [a["payload"] for a in acts if a["type"] == "tool_call" and a["payload"].get("tool") == "execute"]
    failed = [c for c in shell if (lambda r: r.get("isError") or r.get("code") not in (0, None))(results.get(c.get("callId"), {}))]
    return {"wallClockMs": run["finishedAt"] - run["startedAt"], "shellToolCalls": len(shell),
            "failedShellToolCalls": len(failed), "tokens": None}


def main():
    out = {
        "description": "Recorded metrics of the two real QM runs behind the certified Research Company skill. "
                       "Single runs on different companies, not a benchmark. Produced by scripts/export_run_metrics.py "
                       "from the local run cache; tokens are null because QM's run API does not record them.",
        "runs": [],
    }
    for role, case, run_id in RUNS:
        with open(os.path.join(au_record.RECORD_DIR, "runs", f"{run_id}.json")) as f:
            run = json.load(f)
        if run.get("status") != "done":
            sys.exit(f"run {run_id} is {run.get('status')}, not done")
        out["runs"].append({"role": role, "case": case, "runId": run_id, **metrics(run)})
    with open(OUT, "w") as f:
        json.dump(out, f, indent=2)
        f.write("\n")
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
