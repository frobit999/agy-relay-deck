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

test("dangerous launch mode is explicit, persisted, and disabled by default", () => {
  const server = fs.readFileSync(path.join(root, "server.mjs"), "utf8");
  const html = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
  assert.match(server, /dangerouslySkipPermissions: saved\?\.dangerouslySkipPermissions === true/);
  assert.match(server, /"--dangerously-skip-permissions"/);
  assert.match(server, /SETTINGS_FILE/);
  assert.match(html, /id="skip-permissions"/);
  assert.match(html, /模型可直接执行工具操作/);
});

test("generation cleanup is verification-gated and recoverable", () => {
  const server = fs.readFileSync(path.join(root, "server.mjs"), "utf8");
  assert.match(server, /merged_pending_verification/);
  assert.match(server, /moveRoomBranchesToTrash/);
  assert.match(server, /restoreRoomBranches/);
  assert.match(server, /必须先验证新母会话/);
  assert.match(server, /所有窗口仍是 \+0/);
});

test("cleanup blocks only processes attached to the conversations being moved", () => {
  const server = fs.readFileSync(path.join(root, "server.mjs"), "utf8");
  assert.match(server, /activeAgyForConversations/);
  assert.match(server, /--conversation\\s\+/);
  assert.match(server, /上一代仍有/);
  assert.doesNotMatch(server, /function moveRoomBranchesToTrash[\s\S]{0,300}agyProcesses\(\)\.length/);
});

test("merge retries transient API failures without restarting the whole room", () => {
  const server = fs.readFileSync(path.join(root, "server.mjs"), "utf8");
  assert.match(server, /runAgyWithRetry/);
  assert.match(server, /"retryable"\\s\*:\\s\*true/);
  assert.match(server, /timeout waiting for cascade to start running/);
  assert.match(server, /\[5000, 10000, 15000, 30000, 30000\]/);
  assert.match(server, /options\.maxAttempts \|\| 6/);
  assert.match(server, /const MERGE_SHARD_CHARS = 700_000/);
});

test("successful shards do not depend on a fragile final consolidation turn", () => {
  const server = fs.readFileSync(path.join(root, "server.mjs"), "utf8");
  assert.match(server, /分片汇合完成/);
  assert.doesNotMatch(server, /现在完成多窗口汇合/);
  assert.doesNotMatch(server, /最终汇合网络中断/);
});

test("whole-room account handoff preserves branches without semantic merging", () => {
  const server = fs.readFileSync(path.join(root, "server.mjs"), "utf8");
  const app = fs.readFileSync(path.join(root, "dist/app.js"), "utf8");
  assert.match(server, /performRoomHandoff/);
  assert.match(server, /handoffSourceConversationId/);
  assert.match(server, /saveRoomsAtomic\(targetRoom, sourceRoom\)/);
  assert.match(server, /handoff_pending_verification/);
  assert.match(server, /handoff_failed_rolled_back/);
  assert.match(app, /整房间换号/);
  assert.match(app, /不会汇合或总结/);
});

test("parallel branches can be launched independently without duplicating active windows", () => {
  const server = fs.readFileSync(path.join(root, "server.mjs"), "utf8");
  const app = fs.readFileSync(path.join(root, "dist/app.js"), "utf8");
  assert.match(server, /runningConversationIds/);
  assert.match(server, /launchBranchMatch/);
  assert.match(server, /alreadyRunning/);
  assert.match(app, /data-action="launch-branch"/);
  assert.match(app, /打开其余/);
});

test("a stopped branch can be cloned into the same room with safe merge lineage", () => {
  const server = fs.readFileSync(path.join(root, "server.mjs"), "utf8");
  const app = fs.readFileSync(path.join(root, "dist/app.js"), "utf8");
  assert.match(server, /performBranchClone/);
  assert.match(server, /nextCloneLabel/);
  assert.match(server, /clonedFromLabel/);
  assert.match(server, /一个房间最多保留 6 个窗口/);
  assert.match(server, /复制的增量分支/);
  assert.match(app, /data-action="clone-branch"/);
  assert.match(app, /关闭后复制/);
});
