// Deterministic verifier for a Scout company.json artifact. No network: URLs are checked
// structurally, not fetched. Same checks, names and messages as scripts/verify_company.py
// (kept for the Python runtime scripts); tests/certification.test.ts asserts they agree.

import { readFileSync } from "node:fs";
import type { VerificationResult } from "../types.ts";

export const COMPANY_CHECKS = [
  "file_exists",
  "valid_json_object",
  "company_name_present",
  "website_valid_url",
  "product_summary_present",
  "source_urls_min_two",
] as const;

export function validUrl(value: unknown): boolean {
  if (typeof value !== "string" || value !== value.trim() || value.includes(" ")) return false;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".");
}

const nonEmpty = (v: unknown) => typeof v === "string" && v.trim() !== "";

/** Verify company.json content; `raw` is null when the file could not be read. */
export function verifyCompany(raw: string | null): VerificationResult {
  const checks: VerificationResult["checks"] = [];
  const check = (name: string, message: string, ok: boolean) => {
    checks.push({ name, passed: ok, message });
    return ok;
  };

  let data: unknown = null;
  if (check("file_exists", "file exists", raw !== null)) {
    try {
      data = JSON.parse(raw as string);
    } catch {
      data = null;
    }
  }
  const isObj = typeof data === "object" && data !== null && !Array.isArray(data);
  check("valid_json_object", "valid JSON object", isObj);
  const d = (isObj ? data : {}) as Record<string, unknown>;
  check("company_name_present", "company_name present", nonEmpty(d.company_name));
  check("website_valid_url", "website present (http(s) URL)", validUrl(d.website));
  check("product_summary_present", "product_summary present", nonEmpty(d.product_summary));
  const urls = Array.isArray(d.source_urls) ? new Set(d.source_urls.filter(validUrl)) : new Set();
  check("source_urls_min_two", `at least two valid source URLs (${urls.size} distinct valid)`, urls.size >= 2);

  return { passed: checks.every((c) => c.passed), checks };
}

export function verifyCompanyFile(path: string): VerificationResult {
  let raw: string | null = null;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    raw = null;
  }
  return verifyCompany(raw);
}
