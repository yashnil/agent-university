# Company skill registry

What the organization trusts. Written only by `scripts/certify.py --promote` (and the swarm
runner), through `scripts/registry.py`. Committed on purpose: every promotion is a reviewable
diff in a PR.

| File | Contents |
|---|---|
| `ledger.jsonl` | Every certification decision, pass or fail, one `CertificationRecord` per line. Append-only audit trail. |
| `skills/<id>.json` | The canonical `CertificationRecord` of each **certified** skill. Source of truth for the UI and for composition. |
| `index.json` | `RegistryIndex`: one summary row per certified skill. |

Schema: `schemas/certification-record.schema.json`. TypeScript: `lib/certification.ts`.

## Policy `au-transfer-v1`

A skill is certified only when every rule holds. Each rule is recorded with its reason and
evidence in `decision.rulings`, so a failed skill shows exactly why.

| Rule | Holds when |
|---|---|
| `teacher_run_verified` | a `skill.observed` event by the skill's teacher shows a verifier PASS |
| `procedure_recalled` | the student was given the skill's Memorable procedure |
| `exam_case_unseen` | the exam case is an exam case for this skill in `demo/cases.json`, and its company is not the teacher's |
| `student_distinct_from_teacher` | the student's agent id differs from the teacher's |
| `artifact_matches_skill` | the exam is for this skill and produced its artifact type |
| `verifier_checks_complete` | the verifier reported every required check for the artifact type |
| `verifier_checks_passed` | every check passed, and the `passed` flags agree with the checks |
| `isolation_attested` | every runtime isolation fact supplied is true (required with `--require-isolation`) |

Resulting status: `certified` if all rules hold. `transferred` if a distinct student really
took an unseen exam for this skill but something else failed. Otherwise the skill stays
`observed`. No new statuses; `exam.passed` and `skill.certified` are emitted only when earned.

Ranking when several students pass (e.g. a swarm): certified > rules passed > checks passed >
lower `costUsd` > fewer `toolCalls` > lower `durationMs` > `runId`. A certified record is never
replaced by a worse one.

```bash
python3 scripts/certify.py --skill demo/fixtures/skill-observed.json \
  --transfer demo/fixtures/transfer-result.json --events demo/fixtures/events.json
python3 scripts/registry.py list | show <id> | ledger [<id>]
```
