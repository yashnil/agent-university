#!/usr/bin/env python3
"""Check the frozen shared contracts. Stdlib only, Python 3.9+. Run by `npm test`.

1. Every schema in schemas/ loads, and every $ref resolves.
2. Every fixture in demo/fixtures/ validates against its schema (see FIXTURES), and the
   fixtures agree with each other (statuses, pass flags, ids).
3. lib/types.ts matches the schemas: the same field names, the same optional/required
   split, and the same enum members. This is what keeps the TypeScript mirror from drifting.
4. demo/cases.json names a teacher case and an unseen exam case.

Implements the JSON Schema subset the schemas use: type, required, properties, items,
enum, minItems, uniqueItems, minLength, minimum, maximum, pattern and $ref. It also
implements x-payloadByType, which selects an event's payload schema by its type.
Prints one line per check, exits 1 on any failure.
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEMAS = os.path.join(ROOT, "schemas")
FIXTURES_DIR = os.path.join(ROOT, "demo", "fixtures")
TYPES_TS = os.path.join(ROOT, "lib", "types.ts")

# fixture file -> schema file (relative to schemas/)
FIXTURES = {
    "company.json": "company.schema.json",
    "repo_analysis.json": "repo_analysis.schema.json",
    "score.json": "score.schema.json",
    "outreach.md": "outreach.schema.json",
    "skill-observed.json": "contracts/skill.schema.json",
    "skill-certified.json": "contracts/skill.schema.json",
    "transfer-result.json": "contracts/transfer-result.schema.json",
    "transfer-result-failed.json": "contracts/transfer-result.schema.json",
    "certification-record.json": "certification-record.schema.json",
    "certification-record-failed.json": "certification-record.schema.json",
    "verification-result.json": "contracts/verification-result.schema.json",
    "gap-discovered.json": "contracts/event.schema.json",
    "plan-composed.json": "contracts/event.schema.json",
    "events.json": "contracts/event.schema.json",  # an array of events, validated one by one
}
# TypeScript interface -> schema file
TS_INTERFACES = {
    "AgentIdentity": "contracts/agent-identity.schema.json",
    "Skill": "contracts/skill.schema.json",
    "VerificationResult": "contracts/verification-result.schema.json",
    "TransferResult": "contracts/transfer-result.schema.json",
}
TS_UNIONS = {
    "SkillStatus": ("contracts/skill.schema.json", "#/$defs/SkillStatus"),
    "ArtifactType": ("contracts/skill.schema.json", "#/$defs/ArtifactType"),
    "EventType": ("contracts/event.schema.json", "#/properties/type"),
}

failures = []


def report(name, ok, detail=""):
    print(f"  [{'ok' if ok else 'FAIL'}] {name}{': ' + detail if detail and not ok else ''}")
    if not ok:
        failures.append(name)


# ---------------------------------------------------------------- schema validation

_cache = {}


def load_schema(rel):
    if rel not in _cache:
        with open(os.path.join(SCHEMAS, rel)) as f:
            _cache[rel] = json.load(f)
    return _cache[rel]


def pointer(doc, frag):
    node = doc
    for part in [p for p in frag.lstrip("#").split("/") if p]:
        node = node[part]
    return node


def resolve(ref, base):
    """Resolve a $ref relative to the schema file `base`. Returns (schema, new_base)."""
    file_part, _, frag = ref.partition("#")
    rel = os.path.normpath(os.path.join(os.path.dirname(base), file_part)) if file_part else base
    return pointer(load_schema(rel), frag), rel


TYPES = {"object": dict, "array": list, "string": str, "boolean": bool, "integer": int, "number": (int, float)}


def validate(value, schema, base, path="$"):
    errs = []
    if "$ref" in schema:
        target, tbase = resolve(schema["$ref"], base)
        errs += validate(value, target, tbase, path)
    t = schema.get("type")
    if t:
        ok = isinstance(value, TYPES[t]) and not (t in ("integer", "number") and isinstance(value, bool))
        if not ok:
            return errs + [f"{path}: expected {t}"]
    if "enum" in schema and value not in schema["enum"]:
        errs.append(f"{path}: {value!r} not in {schema['enum']}")
    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0):
            errs.append(f"{path}: shorter than {schema['minLength']}")
        if "pattern" in schema and not re.search(schema["pattern"], value):
            errs.append(f"{path}: {value!r} does not match {schema['pattern']}")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errs.append(f"{path}: below {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            errs.append(f"{path}: above {schema['maximum']}")
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0):
            errs.append(f"{path}: fewer than {schema['minItems']} items")
        if schema.get("uniqueItems") and len({json.dumps(v, sort_keys=True) for v in value}) != len(value):
            errs.append(f"{path}: items not unique")
        for i, item in enumerate(value):
            if "items" in schema:
                errs += validate(item, schema["items"], base, f"{path}[{i}]")
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                errs.append(f"{path}: missing required {key!r}")
        for key, sub in schema.get("properties", {}).items():
            if key in value:
                errs += validate(value[key], sub, base, f"{path}.{key}")
        by_type = schema.get("x-payloadByType")
        if by_type and value.get("type") in by_type:
            errs += validate(value.get("payload"), by_type[value["type"]], base, f"{path}.payload")
    return errs


def all_refs(node):
    if isinstance(node, dict):
        if "$ref" in node:
            yield node["$ref"]
        for v in node.values():
            yield from all_refs(v)
    elif isinstance(node, list):
        for v in node:
            yield from all_refs(v)


# ---------------------------------------------------------------- outreach.md

def parse_outreach(text):
    m = re.search(r"^# Outreach: *(.+?) *$", text, re.M)
    sections, current = {}, None
    for line in text.splitlines():
        h = re.match(r"^## +(.+?) *$", line)
        if h:
            current = re.sub(r"\W+", "_", h.group(1).strip().lower()).strip("_")
            sections[current] = ""
        elif current:
            sections[current] += line + "\n"
    return {"company_name": m.group(1) if m else "", "sections": {k: v.strip() for k, v in sections.items()}}


# ---------------------------------------------------------------- lib/types.ts

def strip_comments(src):
    return re.sub(r"//[^\n]*", "", src)


def split_members(body):
    """Split an object-type body into top-level members: {name: (optional, type_text)}."""
    members, depth, cur = {}, 0, ""
    for ch in body + ";":
        if ch in "{([<":
            depth += 1
        elif ch in "})]>":
            depth -= 1
        if ch in ";\n," and depth == 0:
            m = re.match(r'^\s*("?[\w.]+"?)(\?)?\s*:\s*(.+)$', cur, re.S)
            if m:
                members[m.group(1).strip('"')] = (bool(m.group(2)), m.group(3).strip())
            cur = ""
        else:
            cur += ch
    return members


def block(src, name):
    m = re.search(rf"\binterface {name}\b[^{{]*{{", src)
    if not m:
        return None
    depth, i = 1, m.end()
    while depth:
        depth += {"{": 1, "}": -1}.get(src[i], 0)
        i += 1
    return src[m.end():i - 1]


def union(src, name):
    m = re.search(rf"\btype {name}\s*=([^;]+);", src)
    return sorted(re.findall(r'"([^"]+)"', m.group(1))) if m else None


def fields(schema):
    req = set(schema.get("required", []))
    return {k: (k not in req) for k in schema.get("properties", {})}


def check_types():
    src = strip_comments(open(TYPES_TS).read())
    for iface, rel in TS_INTERFACES.items():
        body = block(src, iface)
        ts = {k: opt for k, (opt, _) in split_members(body).items()} if body is not None else None
        report(f"types.ts {iface} matches {rel}", ts == fields(load_schema(rel)),
               f"ts={ts} schema={fields(load_schema(rel))}")
    for name, (rel, frag) in TS_UNIONS.items():
        want = sorted(pointer(load_schema(rel), frag)["enum"])
        report(f"types.ts {name} matches {rel}{frag}", union(src, name) == want, f"ts={union(src, name)} schema={want}")
    cert_src = strip_comments(open(os.path.join(ROOT, "lib", "certification.ts")).read())
    body = block(cert_src, "CertificationRecord")
    ts = {k: opt for k, (opt, _) in split_members(body).items()} if body is not None else None
    want = fields(load_schema("certification-record.schema.json"))
    report("certification.ts CertificationRecord matches certification-record.schema.json", ts == want,
           f"ts={ts} schema={want}")
    event = load_schema("contracts/event.schema.json")
    payloads = split_members(block(src, "EventPayloads") or "")
    report("types.ts EventPayloads covers every event type",
           sorted(payloads) == sorted(event["x-payloadByType"]), f"ts={sorted(payloads)}")
    for etype, ref in event["x-payloadByType"].items():
        if etype not in payloads:
            continue
        schema, _ = resolve(ref["$ref"], "contracts/event.schema.json")
        body = payloads[etype][1].strip()[1:-1]
        ts = {k: opt for k, (opt, _) in split_members(body).items()}
        report(f"types.ts EventPayloads[{etype}] matches schema", ts == fields(schema),
               f"ts={ts} schema={fields(schema)}")


# ---------------------------------------------------------------- main

def main():
    print("schemas")
    for dirpath, _, files in os.walk(SCHEMAS):
        for f in sorted(files):
            rel = os.path.relpath(os.path.join(dirpath, f), SCHEMAS)
            try:
                doc = load_schema(rel)
                for ref in all_refs(doc):
                    resolve(ref, rel)
                report(f"{rel} loads and its $refs resolve", True)
            except Exception as e:  # noqa: BLE001
                report(f"{rel} loads and its $refs resolve", False, repr(e))

    print("fixtures")
    data = {}
    for name, rel in FIXTURES.items():
        p = os.path.join(FIXTURES_DIR, name)
        if not os.path.exists(p):
            report(f"demo/fixtures/{name} exists", False)
            continue
        raw = open(p).read()
        value = parse_outreach(raw) if name.endswith(".md") else json.loads(raw)
        data[name] = value
        items = value if name == "events.json" else [value]
        errs = [e for item in items for e in validate(item, load_schema(rel), rel)]
        report(f"demo/fixtures/{name} valid against {rel}", not errs, "; ".join(errs[:5]))

    print("fixture consistency")
    obs, cert, tr = data.get("skill-observed.json"), data.get("skill-certified.json"), data.get("transfer-result.json")
    if obs and cert and tr:
        report("skill-observed is observed with no transfer", obs["status"] == "observed" and "transfer" not in obs)
        report("skill-certified is certified with a passed transfer",
               cert["status"] == "certified" and cert.get("transfer", {}).get("passed") is True)
        report("certified student differs from teacher", cert["transfer"]["student"]["id"] != cert["teacher"]["id"])
        report("transfer-result matches skill-certified",
               tr["skillId"] == cert["id"] and tr["examCase"] == cert["transfer"]["examCase"]
               and tr["student"] == cert["transfer"]["student"] and tr.get("procedureId") == cert.get("procedureId"))
        v = tr["verification"]
        report("transfer-result passed == verification.passed == all checks",
               tr["passed"] == v["passed"] == all(c["passed"] for c in v["checks"]))
    if data.get("events.json"):
        types = [e["type"] for e in data["events.json"]]
        report("events.json is in lifecycle order",
               types == sorted(types, key=["skill.observed", "skill.recalled", "exam.started", "exam.passed",
                                           "skill.certified", "plan.composed", "gap.discovered"].index))
    for name, want in (("gap-discovered.json", "gap.discovered"), ("plan-composed.json", "plan.composed")):
        if data.get(name):
            report(f"{name} has type {want}", data[name]["type"] == want)

    print("certification records")
    rec, bad = data.get("certification-record.json"), data.get("certification-record-failed.json")
    if rec and bad and cert:
        report("certification-record is certified and its skill equals skill-certified",
               rec["decision"]["certified"] and rec["skill"] == cert)
        report("certification-record-failed is not certified and stays transferred",
               not bad["decision"]["certified"] and bad["skill"]["status"] == "transferred"
               and bad["decision"]["failedRules"] == ["verifier_checks_passed"])
        sys.path.insert(0, os.path.join(ROOT, "scripts"))
        import certify
        events = data.get("events.json")
        for name, tname in (("certification-record.json", "transfer-result.json"),
                            ("certification-record-failed.json", "transfer-result-failed.json")):
            fx = data[name]
            iso = next(r for r in fx["decision"]["rulings"] if r["rule"] == "isolation_attested")["evidence"].get("facts")
            again = certify.certify(obs, data[tname], events=events, isolation=iso, decided_at=fx["decision"]["decidedAt"])
            report(f"{name} is what scripts/certify.py produces today", again == fx,
                   "regenerate it (see tests/test_certify.py)")

    print("verifier on fixture")
    r = subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "verify_company.py"), "--json",
                        os.path.join(FIXTURES_DIR, "company.json")], capture_output=True, text=True)
    try:
        out = json.loads(r.stdout)
        errs = validate(out, load_schema("contracts/verification-result.schema.json"),
                        "contracts/verification-result.schema.json")
        report("verify_company.py --json emits a VerificationResult", not errs, "; ".join(errs))
        report("verify_company.py passes demo/fixtures/company.json", out["passed"] and r.returncode == 0)
    except ValueError:
        report("verify_company.py --json emits JSON", False, r.stdout[:200] + r.stderr[:200])

    print("lib/types.ts")
    check_types()

    print("demo/cases.json")
    cases = json.load(open(os.path.join(ROOT, "demo", "cases.json")))
    teacher = [c for c in cases["cases"] if c["role"] == "teacher"]
    exam = [c for c in cases["cases"] if c["role"] == "exam"]
    report("one teacher case and at least one unseen exam case",
           len(teacher) == 1 and exam and all(c["company"] != teacher[0]["company"] for c in exam))
    ids = {c["id"] for c in cases["cases"]}
    if cert:
        report("skill-certified examCase is a case in demo/cases.json", cert["transfer"]["examCase"] in ids)

    print(f"\n{'FAIL' if failures else 'PASS'}: {len(failures)} failing check(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
