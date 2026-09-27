#!/usr/bin/env node
import fs from "node:fs/promises";
import { reviewFinalRisk } from "../content/risk-review.mjs";

const args = process.argv.slice(2);
const fileIndex = args.indexOf("--file");
if (fileIndex < 0 || !args[fileIndex + 1]) {
  process.stderr.write("用法: node scripts/check-final-copy.mjs --file final-review-input.json\n");
  process.exitCode = 2;
} else {
  try {
    const input = JSON.parse(await fs.readFile(args[fileIndex + 1], "utf8"));
    process.stdout.write(`${JSON.stringify(reviewFinalRisk(input), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
