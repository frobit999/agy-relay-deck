import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("demo mode creates three branches and merges them without real account access", async (t) => {
  const port = 18000 + (process.pid % 1000);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-relay-room-test-"));
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: { ...process.env, PANEL_DEMO: "1", NO_OPEN: "1", PORT: String(port), AGY_RELAY_STATE: stateRoot },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { child.kill("SIGTERM"); fs.rmSync(stateRoot, { recursive: true, force: true }); });

  const base = `http://127.0.0.1:${port}`;
  let html = "";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { const response = await fetch(base); if (response.ok) { html = await response.text(); break; } } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(html, "server started");
  const token = html.match(/name="panel-token" content="([a-f0-9]+)"/)?.[1];
  assert.equal(token?.length, 48);
  const post = (url, body) => fetch(`${base}${url}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Panel-Token": token }, body: JSON.stringify(body) });
  const status = await (await fetch(`${base}/api/status`)).json();
  assert.equal(status.conversations[0].totalLocalBytes > 0, true);
  assert.equal(status.settings.dangerouslySkipPermissions, false);
  const settingResponse = await post("/api/settings", { dangerouslySkipPermissions: true });
  assert.equal(settingResponse.status, 200);
  const changedStatus = await (await fetch(`${base}/api/status`)).json();
  assert.equal(changedStatus.settings.dangerouslySkipPermissions, true);

  const createdResponse = await post("/api/rooms", {
    sourceConversationId: "11111111-1111-4111-8111-111111111111",
    accountId: "demo-b",
    branchCount: 3,
    workspace: stateRoot,
  });
  assert.equal(createdResponse.status, 202);
  let room = await createdResponse.json();
  if (room.state === "creating") {
    await new Promise((resolve) => setTimeout(resolve, 50));
    room = await (await fetch(`${base}/api/rooms/${room.id}`)).json();
  }
  assert.equal(room.state, "ready");
  assert.equal(room.branches.length, 3);

  const mergedResponse = await post(`/api/rooms/${room.id}/merge`, {
    targetAccountId: "demo-c",
    primaryBranchId: room.branches[0].conversationId,
  });
  assert.equal(mergedResponse.status, 202);
  await new Promise((resolve) => setTimeout(resolve, 50));
  room = await (await fetch(`${base}/api/rooms/${room.id}`)).json();
  assert.equal(room.state, "merged_pending_verification");
  assert.match(room.canonicalConversationId, /^[0-9a-f-]{36}$/i);

  let lifecycleResponse = await post(`/api/rooms/${room.id}/verify`, {});
  assert.equal(lifecycleResponse.status, 200);
  room = await lifecycleResponse.json();
  assert.equal(room.state, "verified");

  lifecycleResponse = await post(`/api/rooms/${room.id}/cleanup`, {});
  assert.equal(lifecycleResponse.status, 200);
  room = await lifecycleResponse.json();
  assert.equal(room.state, "cleaned");

  lifecycleResponse = await post(`/api/rooms/${room.id}/restore`, {});
  assert.equal(lifecycleResponse.status, 200);
  room = await lifecycleResponse.json();
  assert.equal(room.state, "verified");
});
