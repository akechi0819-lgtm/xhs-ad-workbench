import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/build-codex-schema.mjs");

test("生成 Codex 可用的输出结构，同时保留全部制作单字段", () => {
  const destination = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "xhs-schema-")), "draft.json");
  execFileSync(process.execPath, [script, "draft", destination]);
  const schema = JSON.parse(fs.readFileSync(destination, "utf8"));
  assert.deepEqual(schema.required, Object.keys(schema.properties));
  assert.ok(schema.properties.pages.items.$ref);
  assert.ok(schema.$defs.page.properties.readerFacingCopy.properties.headline);
  const serialized = JSON.stringify(schema);
  for (const unsupported of ["uniqueItems", "allOf", '"if"', '"then"', "minItems", "maxItems"]) {
    assert.equal(serialized.includes(unsupported), false, `${unsupported} 不应进入 Codex 输出结构`);
  }
});

test("拆解、初稿和成品回读 schema 均可解析并生成客户端输出结构", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-all-schemas-"));
  for (const name of ["deconstruct", "draft", "humanize"]) {
    const destination = path.join(directory, `${name}.json`);
    execFileSync(process.execPath, [script, name, destination]);
    const schema = JSON.parse(fs.readFileSync(destination, "utf8"));
    assert.equal(schema.type, "object");
    assert.deepEqual(schema.required, Object.keys(schema.properties));
  }
});
