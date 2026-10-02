import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("required dashboard files exist", () => {
  for (const file of ["server.mjs", "dist/index.html", "dist/styles.css", "dist/app.js", "tools/agy_cli_transplant.py", "start.command"]) {
    assert.equal(fs.existsSync(path.join(root, file)), true, file);
  }
});

test("server is local-only and frontend has no remote assets", () => {
  const server = fs.readFileSync(path.join(root, "server.mjs"), "utf8");
  const html = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
  assert.match(server, /const HOST = "127\.0\.0\.1"/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(html, /__PANEL_TOKEN_VALUE__/);
});

test("handoff keeps identity tables out of the copied table list", () => {
  const script = fs.readFileSync(path.join(root, "tools/agy_cli_transplant.py"), "utf8");
  const copied = script.match(/COPY_TABLES = \(([\s\S]*?)\)/)?.[1] || "";
  assert.doesNotMatch(copied, /trajectory_meta/);
  assert.match(script, /PRESERVE_TABLES = \("trajectory_meta", "trajectory_metadata_blob"\)/);
});

test("failed verified handoffs have an automatic rollback path", () => {
  const server = fs.readFileSync(path.join(root, "server.mjs"), "utf8");
  assert.match(server, /restoreBackupFiles\(job\)/);
  assert.match(server, /failed_rolled_back/);
  assert.match(server, /binding_tables_unchanged/);
});

test("parallel rooms use transcript deltas and never splice trajectory tables", () => {
  const server = fs.readFileSync(path.join(root, "server.mjs"), "utf8");
  assert.match(server, /baselineMaxStepIndex/);
  assert.match(server, /transcript\.jsonl/);
  assert.match(server, /buildMergeShards/);
  assert.match(server, /MERGE_SHARD_CHARS/);
  assert.doesNotMatch(server, /UNION\s+ALL\s+SELECT.+steps/is);
});

test("brain copies prefer APFS copy-on-write clones", () => {
  const script = fs.readFileSync(path.join(root, "tools/agy_cli_transplant.py"), "utf8");
  assert.match(script, /"\/bin\/cp", "-cR"/);
  assert.match(script, /shutil\.copytree/);
});

test("conversation summaries expose cached local storage volume", () => {
  const server = fs.readFileSync(path.join(root, "server.mjs"), "utf8");
  const app = fs.readFileSync(path.join(root, "dist/app.js"), "utf8");
  assert.match(server, /totalLocalBytes/);
  assert.match(server, /SIZE_CACHE_TTL_MS/);
  assert.match(server, /databaseBytes \+ brainBytes \+ annotationBytes/);
  assert.match(app, /formatBytes\(item\.totalLocalBytes\)/);
});
