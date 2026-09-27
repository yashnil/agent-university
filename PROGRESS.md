# Agent University: progress

## COMPLETE

- **QM local deployment** (docker target) runs core, web-ui, portal with auth and admin, and
  Postgres. `qm check` passes and admin sign-in works (History → Admin access fix).
- **Docker socket access for core:** `--group-add 0` (History → Blocker).
- **Sandbox startup:** a one-line patch in the running core container makes the local
  sandbox backend use `QM_CORE_CONTAINER` (History → Sandbox startup fix; re-apply steps
  below).
- **Milestone 1: Scout → Research Company → company.json.**
  - Real QM runs `9f8d36da-12d3-4d42-bd7d-924fce932f46` (wrote the file) and
    `3a7aa40d-caf1-4b55-af3d-c2f9ada6cd46` (re-verified it).
  - The artifact is `/root/workspace/scout/linear/company.json` in the admin's personal
    sandbox, and `scripts/verify_company.py` reports PASS (6/6).
- **Preflight (00_Preflight_Sync_and_Branching):**
  - Repo baseline, `.gitignore`.
  - Frozen contracts: `schemas/contracts/*` ⇄ `lib/types.ts`.
  - Artifact pipeline schemas, and the event names with their payloads.
  - Sanitized fixtures (`demo/fixtures`) and `demo/cases.json` (teach Linear, exam Vercel).
  - Offline `npm test`, README, and `docs/HANDOFF.md` (ownership and protocol).
  - `verify_company.py --json` emits a contract `VerificationResult`.

## MILESTONE 2: COMPLETE (2026-09-27)

**Memorable capture → fresh-agent transfer → verified exam** (`feat/runtime`). Runtime stops at
status `transferred` and hands certification a contract `TransferResult`. Runtime no longer emits
`exam.passed` / `skill.certified` or sets `certified`: those belong to certification (HANDOFF §2).

**Teacher**
- Case `teach-linear` (Linear). Real QM run `9f8d36da-12d3-4d42-bd7d-924fce932f46`: fetched the
  homepage, /about and Wikipedia live with curl and wrote `/root/workspace/scout/linear/company.json`
  in the admin's personal sandbox.
- Re-verified in place at capture time: `verify_company.py` **PASS 6/6**.
- Teacher: the admin's default web thread (scope `personal:<admin>`). The real `qm-thread-…` id stays in
  the local record because it hashes a threadRef that contains an email.

**Memorable** (CLI 0.5.19, logged in, extraction API configured, local encrypted store)
- Capture: **stored** by native `memorable ingest` from the generalized trace (4 tool calls).
- Procedure: **`procedures/37196e61-add-company-data-to-company-json-file`** (Memorable chose the title).
- The trace carries placeholders (`<Company>`, `<company-domain>`, `<Wikipedia_Title>`, `<slug>`) and
  a schema template instead of the written JSON.
- Leakage test: **PASS**. 0 of 79 source-answer terms are in the stored procedure (`memorable show`).
  The terms are the name, domain, source URLs, capitalized words, numbers and every 4-word run of the
  summary. "linear" appears nowhere, and a positive control (answer appended) is detected.
  Offline: `tests/test_memorable_capture.py`.
- Recall for an unseen company ranks it first (0.551 at capture, 0.629 for the Vercel task).

**Transfer**
- Case `exam-vercel` (Vercel). QM run `5e30ec98-4e35-48eb-9460-d40b8ded3bc3`.
- Fresh student (a new `qm-thread-…` id, from a random threadRef): new project → scope
  `group:web-project-23b7fd8b-aaf5-452f-b56b-6265135e7aa9`, new threadRef and session, new
  sandbox container and home volume.
- Freshness: before the turn the scope had no sandbox, so no artifact could exist. The student's
  container and volume were not among those present before the exam, and the artifact's mtime is after
  exam start. The student workspace contains only `scout/vercel/` (no Linear artifact).
- The `scout-research-company` layer skill was unpublished during the exam (layer v3), and the run
  never read it. It was restored afterwards (layer v4). Core was not recreated, and the patch is intact.
- Recall evidence: native `memorable recall` → procedure above at rank 1. Native `memorable show` output
  was the only procedural knowledge in the prompt, and the prompt passed the leak check.
  `skill.recalled` (agent = student) and `exam.started` were emitted.
- The student fetched https://vercel.com and https://en.wikipedia.org/wiki/Vercel live (HTTP 200)
  and wrote `/root/workspace/scout/vercel/company.json` itself. No expected values were injected.
- Verifier: **PASS 6/6**. All 13 isolation and freshness checks hold.
- Skill record status: `transferred`, `transfer.passed = true`.

**Handoff to certification** (details: `docs/HANDOFF.md` §4, "Handoff: Milestone 2 transfer result")
- Shared, sanitized: `demo/fixtures/transfer-result-vercel.json`, plus `skill-transferred-vercel.json`,
  `events-vercel-transferred.json` and `company-vercel.json` (the student's artifact).
  - They are validated against the frozen contracts and privacy-scanned by `tests/test_runtime_fixtures.py`.
  - Agent ids are pseudonymized. No scope, container, volume, session, threadRef or URL is included.
- Live, unsanitized, gitignored: `.agent-university/transfers/5e30ec98-4e35-48eb-9460-d40b8ded3bc3.json`
  and `.agent-university/skills/research-company.json`.
- Certification applies its policy (for example `passed` and every `isolation` check → `exam.passed`,
  `skill.certified`, `certified`) without knowing QM internals.

**Commands**
```bash
nvm use 24
python3 scripts/memorable_capture.py --run 9f8d36da-12d3-4d42-bd7d-924fce932f46 --company Linear
mv sandbox/skills/scout-research-company .agent-university/hidden-skills/ && npm exec qm -- layer sync
python3 scripts/transfer_run.py Vercel
mv .agent-university/hidden-skills/scout-research-company sandbox/skills/ && npm exec qm -- layer sync
```

## KNOWN ISSUES

1. **Core patch is not durable.** It is lost if core is recreated (`qm up`, image change). To
   re-apply:
   ```bash
   docker cp qm-agent-university-core:/app/src/config.ts /tmp/config.ts
   # in localSandboxEnv(), right after the LOCAL_SANDBOX_DOCKER_BIN line, add:
   #     ...(env.QM_CORE_CONTAINER ? { coreContainer: env.QM_CORE_CONTAINER } : {}),
   docker cp /tmp/config.ts qm-agent-university-core:/app/src/config.ts && docker restart qm-agent-university-core
   ```
   This should be reported upstream: `localSandboxEnv` should read `QM_CORE_CONTAINER`.
2. **Docker socket group resets** when Docker Desktop restarts (History → Blocker, option 1).
3. **Intermittent admin sign-in HTTP 400.** It happens on the first `scout_run.py` sign-in after
   an idle stretch, and a retry succeeds. Cause unknown; auth was left unchanged on purpose.
4. **Run activity expires after 1 hour in core.** Scripts cache runs under
   `.agent-university/runs/` (gitignored).
5. **`ADMIN_GRANTS` lives in `.env`, not in the repo.** `qm.config.jsonc` maps it with
   `secretEnv.core.ADMIN_GRANTS`, and `.env.example` lists the name with an empty value.
   - `qm admin-login` and `scripts/*` read it from `.env` (or the environment).
   - The running core already has it, and the grant is persisted in Postgres.
   - A fresh clone needs `ADMIN_GRANTS=<email>:org_admin` in `.env` only to run QM itself.
6. **Hiding the Scout skill is manual** (move it out of `sandbox/`, `layer sync`, then restore).
   `transfer_run.py` refuses to run while it is published.
7. **Memorable recall is store-wide.** Memorable's own Claude Code hooks also store procedures from
   coding sessions on this machine (one is `procedures/a2663497-…`). It ranked second, below Research
   Company, but a future unrelated procedure could outrank it. `transfer_run.py` takes rank 1.
8. **Memorable 0.5.19** (0.5.30 is available). It was left unchanged for this milestone.
9. **Student run reply is not in `result`.** `/api/runs/:id` returns only `status`, `sessionId`
   and `adminUrl`, so the script prints `None`. The reply is in the run activity.
10. **No app scaffold yet.** The PDF skeleton's Next.js app (`npm run dev`) is the UI owner's
   first PR. Until it is merged, `npm test` is the shared baseline command.

## NEXT

- **Runtime:** the run API (`lib/qm.ts`, `app/api/run/**`) returning these `TransferResult`s and
  `Event`s. It could also automate hiding and restoring the skill.
- **Certification:** consume `demo/fixtures/transfer-result-vercel.json` and decide `certified`.
  Also the next verifiers and failing fixtures.
- **UI/demo:** the lifecycle, exam, composition and GAP views from fixtures, including the live
  Vercel set (`*-vercel*.json`, which stops at `transferred`) next to the fictional full lifecycle.
  Then from live output.

---

# History (detailed log, oldest first)

### Status (2026-09-27)
- `qm check` passes.
- `qm up`: core, web-ui, portal (with embedded auth broker + admin), and Postgres all running on docker.
- `qm admin-login` produces a one-time link at `http://localhost:8081/auth/admin-login#token=…` (valid 5 min, single use).

### What changed

#### qm.config.jsonc
1. `publicUrl`: `http://localhost:8082` → `http://localhost:8081`. The portal (the public front door) listens on 8081. With 8082, the portal
   advertised the web-ui's port, so admin-login links, OIDC redirects and cookies all landed on the web-ui.
2. `env.auth.AUTH_EMAIL_TRANSPORT: "resend"`. Validation requires the field, but `RESEND_API_KEY` is optional,
   so with no key `qm check` reports "sign-in email: disabled; use qm admin-login". No email dependency.
3. `env.portal.NODE_ENV: "development"`. The portal image defaults to production, which refuses non-https
   URLs. Development mode only relaxes those https checks; `PORTAL_LOCAL_AUTH_BYPASS` is still off, and the real
   session secrets are in use. **Remove this for any https/non-local deployment.**
- Unchanged: `services` = core, web-ui, admin, portal, auth (auth is required for `admin-login`); sandbox `backend: local`;
  `HARNESS: pi`; `modelProvider: anthropic`.

#### .env (values never printed; backup in the session scratchpad)
Added via `qm secrets set` (stdin), all generated with the commands in `.env.example`:
`AUTH_TOKEN_SECRET`, `AUTH_CLIENT_SECRET`, `PORTAL_SESSION_SECRET`, `AUTH_SIGNING_JWK`,
and `AUTH_ALLOWED_EMAILS` (the admin email taken from `ADMIN_GRANTS`). `ANTHROPIC_API_KEY` was not touched.

### Commands run
- `qm check` (failed: `AUTH_EMAIL_TRANSPORT`, then Node 22) → passed after the fixes
- `qm plan` → showed 5 missing auth/portal secrets
- `qm up` → portal FATAL (https required in production) → fixed with NODE_ENV → up
- `qm admin-login` → link pointed at :8082 (the web-ui) → fixed `publicUrl` → `qm up` again
- `qm status`, `qm admin-login` → OK

### Gotchas
- The shell's default `node` is nvm v22. qm needs 24: run `nvm use 24` (v24.21.0 is installed) before `npm exec qm …`.
- Use the portal: **http://localhost:8081**. The web-ui (8082) is published directly and answers without auth. Admin is at
  `http://localhost:8081/admin`. The `admin : http://localhost:8083/admin` URL printed by `up` has nothing listening.

### Needs you
- Open the admin-login link in a browser within 5 minutes (re-run `npm exec qm -- admin-login` for a fresh one).
- `PUBLIC_API_URL` in `.env` points at `http://host.docker.internal:3000`, and nothing listens on port 3000. Core is on
  host port 8080. If agent tools that call back into core fail, the likely fix is `http://host.docker.internal:8080`.
  I left it unchanged; confirm before changing it.

### Admin access fix (2026-09-27)

**Problem:** admin-login links failed with "This account does not have admin access." `ADMIN_GRANTS` existed only in
`.env`, and the docker target forwards only computed secret names, so core never received it (`qm up` warned about
this). Core seeds the `admin_grants` table from `ADMIN_GRANTS` lazily on the first admin check, and only while the
table is empty. With no value it seeded nothing, so the portal's probe for the email returned "not admin".

**Changes:**
1. `qm.config.jsonc`: `env.core.ADMIN_GRANTS = "<admin-email>:org_admin"`. Core is the service that
   reads it (`src/config.ts`, `bootAdminGrantSeed`). `qm admin-login` also reads `config.env.core.ADMIN_GRANTS` first.
2. `.env`: the `ADMIN_GRANTS=` line is commented out (the value is kept in the comment) because the CLI no longer needs
   it. This removes the "not forwarded" warning. `.env` is still mode 600. No other secret was touched.
- No database wipe, volume removal or `qm init`. No change to email setup.

**Verification:**
- `qm check` passes. `qm up`: all services ready, with no "not forwarded" warning.
- The core container env now contains `ADMIN_GRANTS`.
- Postgres `admin_grants` was empty before the fix. After one admin-login redemption it holds
  `<admin-email> | org:agent-university | org_admin | system`.
- One admin-login link was redeemed with curl for the test: POST `/auth/admin-login` returned `303 → /admin/`, so the
  access check passes. That link is now used. Run `npm exec qm -- admin-login` for a fresh one.

**Superseded (preflight):** the email moved out of `qm.config.jsonc`. `ADMIN_GRANTS` is in `.env` again, now mapped
to core through `secretEnv.core.ADMIN_GRANTS` so no email is committed. `qm admin-login` reads it there. Checks after
the move: `qm check` passed, an admin-login link redeemed to `303 → /admin/`, and core was not recreated.

**Status: admin access is correctly seeded and persisted.** The grant now lives in Postgres. Core seeds only an empty
table, so changing `ADMIN_GRANTS` later will not change existing grants. Manage further admins from the Admin → Users tab.

### Milestone 1: Scout → Research Company → company.json (2026-09-27)

**Status: DONE (see "Sandbox startup fix" below).** A real QM sandbox runs shell commands, Linear research ran, and
`/root/workspace/scout/linear/company.json` exists. `verify_company.py` reports PASS.
(The earlier status was BLOCKED: the agent ran, but its sandbox could not start.)

#### Implementation
- `sandbox/skills/scout-research-company/SKILL.md`: the Scout workflow. It fetches public sources with `curl` in
  the sandbox and writes `$HOME/workspace/scout/<slug>/company.json` in the required schema (`company_name`, `website`,
  `product_summary`, `source_urls`). It validates the file with python and replies with the `realpath`. Loaded
  through the deployment layer (`qm check` lists it, `qm layer sync` → layer v2). No new tool or Dockerfile.
- `scripts/scout_run.py [Company]` (default Linear): the real run, going through QM with nothing bypassed. It mints
  `qm admin-login`, redeems it at the portal like a browser (the token and cookies stay in memory and are never
  printed), and POSTs one web turn via portal → web-ui `/api/turn` → core `/v1/turns`. It polls `/api/runs/:id` and
  prints the reply. It then finds the sandbox container (labels `qm.sandbox=1`, `qm.org=agent-university`), reads
  that container's own `$HOME`, resolves the artifact with `realpath -e`, and runs the verifier on the file in place.
- `scripts/verify_company.py <file>` or `--container <name> <path>`: a deterministic verifier with no network.
  It checks that the file exists, is a valid JSON object, and has a non-empty `company_name`, an http(s) `website`
  and a non-empty `product_summary`, plus ≥2 distinct valid http(s) `source_urls`. It prints PASS/FAIL and exits 0/1.
  Checked on fixtures: good → PASS, and bad fields, malformed JSON or a missing file → FAIL.
- No Memorable, no UI, no secret changed or printed.

#### Sandbox workspace path (from the running core's source, `/app/src/sandbox/local-sandbox.ts`)
`SANDBOX_BACKEND=local` → one Docker container per scope, `qm-sbx-<scope-slug>`, image
`qm-agent-university-sandbox-local:latest`, `HOME=/root` on volume `qm-home-<scope-slug>`, and workdir
`/root/workspace`. So the expected artifact is `/root/workspace/scout/linear/company.json` in the run's `qm-sbx-*`
container (persisted in its `qm-home-*` volume). `scout_run.py` resolves it from the live container rather than
assuming it.

#### Commands
```bash
nvm use 24
npm exec qm -- check          # passes; skills: greet, scout-research-company
npm exec qm -- layer sync     # deployment layer v2
python3 scripts/scout_run.py Linear
python3 scripts/verify_company.py --container <qm-sbx-…> /root/workspace/scout/linear/company.json
```

#### Result of the real run
Run `eb9dfa31-6a37-4986-afc4-900cd071c0ed`, session `75f75f3f-2c84-482b-b3a6-0d9e9ece9a9e`
(http://localhost:8081/admin/history/s/75f75f3f-2c84-482b-b3a6-0d9e9ece9a9e). The turn reached the model and the
Scout skill, but every shell command failed with "SANDBOX_BACKEND=local requires a running Docker daemon". The agent
correctly refused to invent the file. The verifier reported FAIL (no sandbox container, no file).

#### Blocker: core cannot use the Docker socket (a qm CLI bug on Docker Desktop for macOS)
- `docker exec qm-agent-university-core docker version` → `permission denied … /var/run/docker.sock`.
  The core log also says "no Docker daemon is reachable from core (permission denied …)".
- Core runs as `node` (uid 1000). Inside Docker Desktop's VM the mounted socket is `root:root 0660`.
- `qm up` (0.1.12, and unchanged in 0.1.13) adds `--group-add <gid of the socket on the macOS host>` = `20` (staff),
  which does not match the in-VM gid `0`.
- Verified with throwaway containers of the core image: `--group-add 20` → permission denied; `--group-add 0` → works.
- qm has no config knob for this (the `runArgs`/`hostDockerSocket` in `dist/src/backends/docker.js`).

Needs a decision, because any fix grants core root-equivalent control of the host Docker daemon (which is what
`sandbox.backend: "local"` is designed to do):
1. **One-off operator fix (simplest):** `sudo chgrp 0 ~/.docker/run/docker.sock && npm exec qm -- up`. qm then passes
   `--group-add 0`. Docker Desktop resets the group on restart, so repeat it before `qm up` after a restart.
2. A small user-level relay socket under `/tmp` (which inherits gid 0), used as `DOCKER_HOST` for `qm up`.
   It needs no sudo but is a long-running process. Not added: the attempt was blocked as a permission-sensitive
   action, so it needs your explicit approval.
3. Report upstream: qm should `--group-add` the in-VM gid (or 0 on Docker Desktop) instead of the host stat gid.
4. Use a remote sandbox backend (e2b/modal/…) instead of `local`.
After 1 or 2: `python3 scripts/scout_run.py Linear` should produce the artifact and print the verifier result.

#### PUBLIC_API_URL (investigated, not changed)
Tested from the sandbox image with `--add-host=host.docker.internal:host-gateway` (as local-sandbox.ts runs it):
`http://host.docker.internal:3000` → unreachable, `http://host.docker.internal:8080` → core answers (401 on
unsigned `/health`). The core→sandbox exec path (file writes, shell) does not use it, so it is not this milestone's
blocker. The agent's self-API/control tools do use it (`orchestrator.ts`: `AGENT_API_URL = apiBaseUrl`). If a run
shows self-API failures once the sandbox works, the justified fix is
`npm exec qm -- secrets set PUBLIC_API_URL` → `http://host.docker.internal:8080`, then `qm up`. Left unchanged
because it is in `.env` and has not been shown to block this milestone.

### Sandbox startup fix (2026-09-27)

The Docker socket group fix (core runs with `--group-add 0`) was already in place and was left unchanged.

#### Symptom
Run `394c022a-c086-4842-89da-47ef9971dc8f`: "the exec daemon never came up (connection refused)", and
`scout_run.py` then reported `company.json not found in any running sandbox (none)`.

#### Evidence
- `docker logs qm-sbx-personal-<admin>-fe1ac6` → `[microvm-agent] exec daemon listening on 8080`
  0.7s after start. **The daemon did start.** It did not crash and it bound the correct port (the image `EXPOSE`s 8080/tcp).
- The core log: `local sandbox qm-sbx-…: exec daemon never became reachable: … ECONNREFUSED 127.0.0.1:55000`.
- Sandbox `HostConfig.PortBindings` = `8080/tcp → 127.0.0.1:0`, and core was not attached to `qm-net-…`.
- The container exited 137 (not OOM) about 36s after start. That is core's 30s `waitDaemon` deadline followed by cleanup.

#### Root cause: a bug in the pinned core image (not in the sandbox image, and not an architecture problem)
`/app/src/sandbox/local-sandbox.ts` has two ways to reach the exec daemon:
- if `coreContainer` is set: `docker network connect qm-net-<scope> <core>` and fetch `http://<sandbox-name>:8080`
- otherwise (core running on the host): publish `-p 127.0.0.1:0:8080` and fetch `http://127.0.0.1:<port>`

The qm CLI sets `QM_CORE_CONTAINER=qm-agent-university-core` for core (`dist/src/backends/docker.js`). In core's
`src/config.ts`, `localSandboxEnv()` declares `coreContainer` in its interface but never reads `QM_CORE_CONTAINER`.
Only the AWS builder (line 304) does. So core used the host path. Inside the core container, `127.0.0.1` is core's
own loopback, so every health poll got ECONNREFUSED.

#### Architecture (checked and ruled out)
The sandbox image is `linux/amd64` on an arm64 host, so it runs under emulation. It boots and serves normally:
the daemon is up in under 1s, and `uname -m` in the sandbox → `x86_64`. No `--platform` workaround is needed.

#### Fix (one line, applied in the running core container)
In `qm-agent-university-core:/app/src/config.ts`, `localSandboxEnv()`, add:
```ts
    ...(env.QM_CORE_CONTAINER ? { coreContainer: env.QM_CORE_CONTAINER } : {}),
```
Applied with `docker cp` of the patched file, then `docker restart qm-agent-university-core`. Core runs
`node src/index.ts` from source, so no build is needed. Volumes, Postgres, secrets, auth and the socket group were
not touched. **This patch lives in the container's writable layer.** It survives `docker restart` but **not a
recreation of core** (for example a `qm up` that replaces the container, or a core image upgrade). To re-apply it:
```bash
docker cp qm-agent-university-core:/app/src/config.ts /tmp/config.ts
# add the line above right after the LOCAL_SANDBOX_DOCKER_BIN line in localSandboxEnv()
docker cp /tmp/config.ts qm-agent-university-core:/app/src/config.ts && docker restart qm-agent-university-core
```
Report upstream: `localSandboxEnv` should read `QM_CORE_CONTAINER`.

#### scripts/scout_run.py fix
After a run, QM parks the sandbox (`docker stop -t 2`). It does not handle SIGTERM, so it shows `Exited (137)`,
which is normal. The artifact persists on the `qm-home-*` volume. The script only searched running containers, so it
always missed the file. It now lists stopped sandboxes too (`docker ps -a`), starts a parked one for the check, and
stops it again afterwards.

#### Verification
1. Shell smoke test through a real agent turn: run `b7cea545-ccdd-4380-85d3-50bfbad6d3cf`. The `execute` tool ran
   `echo QM_SHELL_OK $(uname -m) $(whoami) $HOME` → `QM_SHELL_OK x86_64 root /root`, exit 0.
   Docker events show core joining `qm-net-personal-…` right after the sandbox starts.
2. Linear research: run `9f8d36da-12d3-4d42-bd7d-924fce932f46` fetched https://linear.app, /about and Wikipedia live
   and wrote the file (685 bytes). The old script then missed it because the sandbox was parked.
3. `python3 scripts/scout_run.py Linear` (with the script fix): run `3a7aa40d-caf1-4b55-af3d-c2f9ada6cd46` → status done,
   artifact `qm-sbx-personal-<admin>-fe1ac6:/root/workspace/scout/linear/company.json`
   (volume `qm-home-personal-<admin>-fe1ac6`), and **verify_company.py: PASS** (all 6 checks). Exit 0.
   In the same session, this run re-fetched the sources and re-validated the existing file rather than writing a new one.

#### Open items
- **The core patch does not survive recreation** (see above). Re-apply it after any `qm up` that recreates core.
- **Intermittent admin sign-in `HTTP 400`:** twice, the first `scout_run.py` sign-in after an idle stretch failed;
  an immediate retry succeeded. Host and Docker VM clocks matched when checked. The cause is not found. It is
  unrelated to the sandbox, and auth was deliberately not changed. If it happens, rerun the script.