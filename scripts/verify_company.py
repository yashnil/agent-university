#!/usr/bin/env python3
"""Deterministic verifier for a Scout company.json artifact.

Usage:
  verify_company.py [--json] <path>                      # a local file
  verify_company.py [--json] --container <name> <path>   # a file inside a QM sandbox container

Exit 0 and print PASS when every check holds; exit 1 and print FAIL otherwise.
With --json, print only a VerificationResult (schemas/contracts/verification-result.schema.json).
No network access: URLs are checked structurally, not fetched.
"""
import json
import subprocess
import sys
from urllib.parse import urlparse


def valid_url(value):
    if not isinstance(value, str) or value != value.strip() or " " in value:
        return False
    u = urlparse(value)
    return u.scheme in ("http", "https") and "." in u.hostname if u.hostname else False


def non_empty_str(value):
    return isinstance(value, str) and value.strip() != ""


def read(args):
    if len(args) == 3 and args[0] == "--container":
        r = subprocess.run(["docker", "exec", args[1], "cat", args[2]], capture_output=True, text=True)
        return (r.stdout if r.returncode == 0 else None), f"{args[1]}:{args[2]}"
    if len(args) == 1:
        try:
            with open(args[0], encoding="utf-8") as f:
                return f.read(), args[0]
        except OSError:
            return None, args[0]
    sys.exit(__doc__)


def main():
    args = sys.argv[1:]
    as_json = "--json" in args
    raw, where = read([a for a in args if a != "--json"])
    checks = []

    def check(name, label, ok):
        checks.append((name, label, bool(ok)))
        return bool(ok)

    data = None
    if check("file_exists", "file exists", raw is not None):
        try:
            data = json.loads(raw)
        except ValueError:
            data = None
    check("valid_json_object", "valid JSON object", isinstance(data, dict))
    d = data if isinstance(data, dict) else {}
    check("company_name_present", "company_name present", non_empty_str(d.get("company_name")))
    check("website_valid_url", "website present (http(s) URL)", valid_url(d.get("website")))
    check("product_summary_present", "product_summary present", non_empty_str(d.get("product_summary")))
    urls = d.get("source_urls")
    good = {u for u in urls if valid_url(u)} if isinstance(urls, list) else set()
    check("source_urls_min_two", f"at least two valid source URLs ({len(good)} distinct valid)", len(good) >= 2)

    passed = all(ok for _, _, ok in checks)
    if as_json:
        print(json.dumps({"passed": passed,
                          "checks": [{"name": n, "passed": ok, "message": label} for n, label, ok in checks]}))
        return 0 if passed else 1
    print(f"artifact: {where}")
    for _, label, ok in checks:
        print(f"  [{'ok' if ok else 'FAIL'}] {label}")
    print("PASS" if passed else "FAIL")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
