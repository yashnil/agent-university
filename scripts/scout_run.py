#!/usr/bin/env python3
"""Run the Scout agent for one company through the live QM deployment.

  scripts/scout_run.py [--style thorough|minimal] [Company Name]      (default: Linear)

--style appends method instructions to the prompt (the skill is unchanged), so teacher
runs can differ in method: `thorough` gathers 4+ sources incl. about/pricing pages and
the Wikipedia REST summary API; `minimal` uses only the homepage plus one more source.

1. Mints a single-use admin sign-in (`qm admin-login`) and redeems it at the portal,
   exactly as a browser would. The token and cookies stay in memory, never printed.
2. Sends one real web turn (portal -> web-ui -> core /v1/turns) asking the agent to
   use the `scout-research-company` skill.
3. Polls the run until it finishes and prints the agent's reply.
4. Locates the sandbox the run used (docker label qm.sandbox=1, org=agent-university),
   asks that container for its real $HOME and the artifact's realpath, and runs
   scripts/verify_company.py against the file in place.

Requires Node 24 on PATH for `npm exec qm` (see PROGRESS.md).
"""
import http.cookiejar
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
DEPLOY_DIR = os.path.dirname(HERE)
PORTAL = "http://localhost:8081"
ORG = "agent-university"
RUN_TIMEOUT_S = 900


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def sign_in():
    out = subprocess.run(
        ["npm", "exec", "--silent", "qm", "--", "admin-login"],
        cwd=DEPLOY_DIR, capture_output=True, text=True, check=True,
    ).stdout
    m = re.search(r"#token=([A-Za-z0-9._~-]+)", out)
    if not m:
        sys.exit("admin-login did not print a link")
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect)
    req = urllib.request.Request(
        f"{PORTAL}/auth/admin-login",
        data=urllib.parse.urlencode({"token": m.group(1)}).encode(),
        headers={"Origin": PORTAL, "Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        opener.open(req)
    except urllib.error.HTTPError as e:
        if e.code != 303:
            sys.exit(f"admin sign-in failed: HTTP {e.code}")
    if not any(True for _ in jar):
        sys.exit("admin sign-in set no session cookie")
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(opener, method, path, body=None):
    req = urllib.request.Request(
        f"{PORTAL}{path}", method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", "Origin": PORTAL},
    )
    try:
        with opener.open(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:500]


def docker(*args):
    return subprocess.run(["docker", *args], capture_output=True, text=True)


def sandboxes():
    # Include stopped containers: QM parks (docker stop) the sandbox as soon as the run
    # ends, but its home volume, and so the artifact, persists.
    r = docker("ps", "-a", "--filter", "label=qm.sandbox=1", "--filter", f"label=qm.org={ORG}",
               "--format", "{{.Names}}")
    return [n for n in r.stdout.split() if n]


def running(name):
    return docker("inspect", "-f", "{{.State.Running}}", name).stdout.strip() == "true"


STYLES = {
    "thorough": (
        " Method: be thorough. Fetch at least four distinct sources before writing: the homepage, "
        "its /about page, its /pricing page, and the Wikipedia REST summary API "
        "(https://en.wikipedia.org/api/rest_v1/page/summary/<Title>); check each fetch's HTTP status "
        "with curl -s -o /dev/null -w '%{http_code}' and cite only the ones that returned 200. "
        "Write the JSON with a python3 script (json.dump) rather than a heredoc."
    ),
    "minimal": (
        " Method: be quick and minimal. Fetch only the homepage and exactly one more source "
        "(the Wikipedia article), extract the <title> and meta description with grep, "
        "and write the file in a single printf command; cite exactly those two URLs."
    ),
}


def main():
    args = sys.argv[1:]
    style = None
    if len(args) >= 2 and args[0] == "--style":
        style, args = args[1], args[2:]
        if style not in STYLES:
            sys.exit(f"unknown --style {style}; choose from {', '.join(STYLES)}")
    company = " ".join(args) or "Linear"
    slug = slugify(company)
    opener = sign_in()
    print(f"signed in at {PORTAL} as the seeded admin")

    prompt = (
        f"Use the scout-research-company skill to research the company \"{company}\". "
        f"Fetch real public sources with curl, write the artifact to "
        f"$HOME/workspace/scout/{slug}/company.json, validate it, and reply with its absolute path."
    ) + (STYLES[style] if style else "")
    status, turn = call(opener, "POST", "/api/turn", {"text": prompt, "clientTurnId": str(uuid.uuid4())})
    if status not in (200, 201, 202) or not isinstance(turn, dict) or not turn.get("runId"):
        sys.exit(f"turn rejected: HTTP {status} {turn}")
    run_id = turn["runId"]
    print(f"run {run_id} started")

    deadline = time.time() + RUN_TIMEOUT_S
    run = {}
    while time.time() < deadline:
        status, run = call(opener, "GET", f"/api/runs/{urllib.parse.quote(run_id)}")
        state = run.get("status") if isinstance(run, dict) else None
        if state in ("done", "failed"):
            break
        time.sleep(5)
    else:
        sys.exit(f"run {run_id} did not finish within {RUN_TIMEOUT_S}s")
    print(f"run {run_id} status: {run.get('status')}")
    reply = run.get("result") or run.get("reply") or run.get("output") or run.get("error")
    if reply:
        print("--- agent reply ---")
        print(reply if isinstance(reply, str) else json.dumps(reply, indent=2)[:4000])
        print("-------------------")
    if run.get("status") != "done":
        sys.exit(1)

    result = find_and_verify(f"workspace/scout/{slug}/company.json", sandboxes())
    if not result:
        print(f"company.json not found in any sandbox ({', '.join(sandboxes()) or 'none'})")
        print("FAIL")
        return 1
    return result["returncode"]


def find_and_verify(rel, names):
    """Find `$HOME/<rel>` in the first of `names` that has it and run the verifier there.

    Uses each container's own $HOME rather than an assumed path. A parked sandbox is
    started just for the check and parked again as QM does. Returns None when no
    container has the file, else its location and content, the verifier's exit code, and its
    VerificationResult (schemas/contracts/verification-result.schema.json).
    """
    for name in names:
        parked = not running(name)
        if parked and docker("start", name).returncode != 0:
            continue
        try:
            home = docker("exec", name, "sh", "-c", "printf %s \"$HOME\"").stdout.strip()
            found = docker("exec", name, "realpath", "-e", f"{home}/{rel}")
            if found.returncode != 0:
                continue
            path = found.stdout.strip()
            scope = docker("inspect", "-f", '{{index .Config.Labels "qm.scope"}}', name).stdout.strip()
            vol = docker("inspect", "-f", '{{range .Mounts}}{{.Name}}:{{.Destination}} {{end}}', name).stdout.strip()
            print(f"artifact container: {name}\nartifact scope    : {scope}\nhome volume       : {vol}\nartifact path     : {path}")
            v = subprocess.run(
                [sys.executable, os.path.join(HERE, "verify_company.py"), "--json", "--container", name, path],
                capture_output=True, text=True,
            )
            verification = json.loads(v.stdout)
            print(f"artifact: {name}:{path}")
            for c in verification["checks"]:
                print(f"  [{'ok' if c['passed'] else 'FAIL'}] {c.get('message', c['name'])}")
            print("PASS" if verification["passed"] else "FAIL")
            content = docker("exec", name, "cat", path).stdout
            return {"container": name, "scope": scope, "volume": vol, "path": path,
                    "returncode": v.returncode, "verification": verification, "content": content}
        finally:
            if parked:
                docker("stop", "-t", "2", name)
    return None


if __name__ == "__main__":
    sys.exit(main())
