// Minimal JSON Schema validator for the schemas in schemas/: the same subset and the same
// error strings as scripts/check_contracts.py (type, required, properties, items, enum,
// minItems, uniqueItems, minLength, minimum, maximum, pattern, $ref, x-payloadByType).

import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { ROOT } from "./certification.ts";

type Schema = Record<string, any>;
const cache = new Map<string, Schema>();

export function loadSchema(rel: string): Schema {
  if (!cache.has(rel)) cache.set(rel, JSON.parse(readFileSync(join(ROOT, "schemas", rel), "utf8")));
  return cache.get(rel)!;
}

function resolve(ref: string, base: string): [Schema, string] {
  const [file, frag = ""] = ref.split("#");
  const rel = file ? normalize(join(dirname(base), file)) : base;
  let node: any = loadSchema(rel);
  for (const part of frag.split("/").filter(Boolean)) node = node[part];
  return [node, rel];
}

const isType: Record<string, (v: unknown) => boolean> = {
  object: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  array: Array.isArray,
  string: (v) => typeof v === "string",
  boolean: (v) => typeof v === "boolean",
  integer: Number.isInteger,
  number: (v) => typeof v === "number",
};

export function validate(value: unknown, schema: Schema, base: string, path = "$"): string[] {
  const errs: string[] = [];
  if (schema.$ref) {
    const [target, tbase] = resolve(schema.$ref, base);
    errs.push(...validate(value, target, tbase, path));
  }
  if (schema.type && !isType[schema.type](value)) return [...errs, `${path}: expected ${schema.type}`];
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: ${JSON.stringify(value)} not in ${JSON.stringify(schema.enum)}`);
  if (typeof value === "string") {
    if (value.length < (schema.minLength ?? 0)) errs.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`${path}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${path}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${path}: above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0)) errs.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) errs.push(`${path}: items not unique`);
    if (schema.items) value.forEach((item, i) => errs.push(...validate(item, schema.items, base, `${path}[${i}]`)));
  }
  if (isType.object(value)) {
    const o = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in o)) errs.push(`${path}: missing required '${key}'`);
    for (const [key, sub] of Object.entries(schema.properties ?? {}))
      if (key in o) errs.push(...validate(o[key], sub as Schema, base, `${path}.${key}`));
    const byType = schema["x-payloadByType"];
    if (byType && typeof o.type === "string" && byType[o.type]) errs.push(...validate(o.payload, byType[o.type], base, `${path}.payload`));
  }
  return errs;
}

/** Validate against a schema file under schemas/, e.g. "certification-record.schema.json". */
export const errorsAgainst = (value: unknown, rel: string) => validate(value, loadSchema(rel), rel);
