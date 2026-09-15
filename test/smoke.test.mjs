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
