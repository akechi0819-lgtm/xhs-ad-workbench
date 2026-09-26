#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaName = process.argv[2] || "draft";
if (!["deconstruct", "draft", "humanize"].includes(schemaName)) {
  throw new Error("schema 名称必须是 deconstruct、draft 或 humanize");
}
const source = path.join(root, "content", "schemas", `${schemaName}.schema.json`);
const destination = path.resolve(process.argv[3] || path.join(root, "runs", "schemas", `${schemaName}.codex.schema.json`));

// Codex structured output accepts a JSON Schema subset. Keep business rules in
// the source schema and validateProductionSheet; this file is only for generation.
function toCodexSchema(value) {
  if (Array.isArray(value)) return value.map(toCodexSchema);
  if (!value || typeof value !== "object") return value;
  const allowed = new Set(["type", "description", "properties", "required", "additionalProperties", "items", "enum", "anyOf", "$ref", "$defs"]);
  const result = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === "properties" || key === "$defs") {
      result[key] = Object.fromEntries(Object.entries(nested).map(([name, child]) => [name, toCodexSchema(child)]));
    } else if (allowed.has(key)) result[key] = toCodexSchema(nested);
    else if (key === "const") result.enum = [nested];
  }
  if (result.type === "object" && result.properties) {
    result.additionalProperties = false;
    result.required = Object.keys(result.properties);
  }
  return result;
}

const normative = JSON.parse(await fs.readFile(source, "utf8"));
const generated = toCodexSchema(normative);
await fs.mkdir(path.dirname(destination), { recursive: true });
await fs.writeFile(destination, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
process.stdout.write(`${destination}\n`);
