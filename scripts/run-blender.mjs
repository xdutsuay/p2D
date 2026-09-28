#!/usr/bin/env node
/**
 * Run a Blender Python script with project root as cwd arg.
 * Usage: node scripts/run-blender.mjs <script.py> [extra args...]
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptName = process.argv[2];
const extra = process.argv.slice(3);

if (!scriptName) {
  console.error("Usage: node scripts/run-blender.mjs <script.py> [args...]");
  process.exit(1);
}

const blenderCandidates = [
  process.env.BLENDER_PATH,
  String.raw`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`,
  String.raw`C:\Program Files\Blender Foundation\Blender 4.2\blender.exe`,
  "blender",
].filter(Boolean);

let blender = null;
for (const c of blenderCandidates) {
  if (c === "blender" || fs.existsSync(c)) {
    blender = c;
    break;
  }
}

if (!blender) {
  console.error("Blender not found. Set BLENDER_PATH.");
  process.exit(1);
}

const scriptPath = path.join(root, "blender", "scripts", scriptName);
if (!fs.existsSync(scriptPath)) {
  console.error("Script missing:", scriptPath);
  process.exit(1);
}

const args = ["--background", "--python", scriptPath, "--", root, ...extra];
console.log(">", blender, args.join(" "));

const child = spawn(blender, args, { stdio: "inherit", cwd: root });
child.on("exit", (code) => process.exit(code ?? 1));
