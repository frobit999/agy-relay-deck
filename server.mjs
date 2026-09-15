import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 7331);
const PANEL_TOKEN = crypto.randomBytes(24).toString("hex");
const HOME = os.homedir();
const AGY_ROOT = process.env.AGY_ROOT || path.join(HOME, ".gemini", "antigravity-cli");
const MANAGER_ROOT = process.env.ANTIGRAVITY_TOOLS_HOME || path.join(HOME, ".antigravity_tools");
const STATE_ROOT = process.env.AGY_RELAY_STATE || path.join(HOME, ".agy-relay-deck");
const HISTORY_FILE = path.join(STATE_ROOT, "history.json");
const TRANSPLANTER = path.join(__dirname, "tools", "agy_cli_transplant.py");
const DIST = path.join(__dirname, "dist");
const DEMO = process.env.PANEL_DEMO === "1";
const jobs = new Map();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function jsonFile(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}

function findExecutable(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = candidate.startsWith("~") ? path.join(HOME, candidate.slice(2)) : candidate;
    try { fs.accessSync(resolved, fs.constants.X_OK); return resolved; } catch { /* keep looking */ }
  }
  return null;
}

function agyBinary() {
  return findExecutable([
    process.env.AGY_BIN,
    "/opt/homebrew/bin/agy",
    "/usr/local/bin/agy",
    path.join(HOME, ".local", "bin", "agy"),
  ]);
}

function managerBinary() {
  const known = findExecutable([
    process.env.ANTIGRAVITY_TOOLS_BIN,
    "/Applications/Antigravity Tools.app/Contents/MacOS/antigravity-tools",
    path.join(HOME, "Applications", "Antigravity Tools.app", "Contents", "MacOS", "antigravity-tools"),
    path.join(HOME, "Downloads", "Antigravity Tools.app", "Contents", "MacOS", "antigravity-tools"),
  ]);
  if (known || process.platform !== "darwin") return known;
  const spotlight = spawnSync("/usr/bin/mdfind", ["kMDItemFSName == 'Antigravity Tools.app'c"], { encoding: "utf8", timeout: 2500 });
  const discovered = spotlight.status === 0
    ? spotlight.stdout.split(/\r?\n/).filter(Boolean).map((app) => path.join(app, "Contents", "MacOS", "antigravity-tools"))
    : [];
  // Development/download layouts often keep the app one directory below a
  // versioned folder. This bounded scan avoids searching the whole home dir.
  for (const parent of [path.resolve(__dirname, "..", "..", "work"), path.join(HOME, "Downloads")]) {
    try {
      for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        discovered.push(path.join(parent, entry.name, "Antigravity Tools.app", "Contents", "MacOS", "antigravity-tools"));
      }
    } catch { /* optional discovery location */ }
  }
  return findExecutable(discovered);
}

function managerConfig() {
  const config = jsonFile(path.join(MANAGER_ROOT, "gui_config.json"), {});
  const proxy = config?.proxy || {};
  return {
    port: Number(proxy.port || 8045),
    secret: proxy.admin_password || proxy.api_key || "",
  };
}

async function managerRequest(route, options = {}) {
  const cfg = managerConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 2500);
  try {
    const response = await fetch(`http://127.0.0.1:${cfg.port}${route}`, {
      method: options.method || "GET",
      headers: {
        ...(cfg.secret ? { Authorization: `Bearer ${cfg.secret}` } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let data = text;
    try { data = text ? JSON.parse(text) : null; } catch { /* retain text */ }
    if (!response.ok) throw new Error(`Antigravity Tools 返回 ${response.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
    return data;
  } finally { clearTimeout(timeout); }
}

async function managerOnline() {
  try { await managerRequest("/api/health", { timeout: 1000 }); return true; } catch { return false; }
}

function quotaBuckets(accountData) {
  const result = {};
  const groups = accountData?.quota?.quota_groups;
  if (!Array.isArray(groups)) return result;
  for (const group of groups) {
    for (const bucket of group?.buckets || []) {
      result[bucket.bucket_id] = {
        remaining: typeof bucket.remaining_fraction === "number" ? bucket.remaining_fraction : null,
        resetTime: bucket.reset_time || null,
      };
    }
  }
  return result;
}

function readAccounts() {
  if (DEMO) return demoAccounts();
  const index = jsonFile(path.join(MANAGER_ROOT, "accounts.json"), {});
  const listed = Array.isArray(index?.accounts) ? index.accounts : [];
  const accountDir = path.join(MANAGER_ROOT, "accounts");
  const accounts = listed.map((item) => {
    const details = jsonFile(path.join(accountDir, `${item.id}.json`), {});
    return {
      id: item.id,
      name: details.name || item.name || "未命名账号",
      email: details.email || item.email || "",
      current: item.id === index.current_account_id,
      disabled: Boolean(details.disabled),
      validationBlocked: Boolean(details.validation_blocked),
      lastUsed: details.last_used || null,
      quotas: quotaBuckets(details),
    };
  });
  return accounts.sort((a, b) => {
    const av = a.quotas["gemini-weekly"]?.remaining;
    const bv = b.quotas["gemini-weekly"]?.remaining;
    return (bv ?? -1) - (av ?? -1);
  });
}

function demoAccounts() {
  return [
    { id: "demo-b", name: "主力 B", email: "b•••@gmail.com", current: true, disabled: false, validationBlocked: false, quotas: { "gemini-weekly": { remaining: .87, resetTime: new Date(Date.now()+5*864e5).toISOString() }, "gemini-5h": { remaining: .74, resetTime: new Date(Date.now()+3*36e5).toISOString() }, "3p-weekly": { remaining: .95 }, "3p-5h": { remaining: 1 } } },
    { id: "demo-c", name: "备用 C", email: "c•••@gmail.com", current: false, disabled: false, validationBlocked: false, quotas: { "gemini-weekly": { remaining: .63 }, "gemini-5h": { remaining: 1 }, "3p-weekly": { remaining: .71 } } },
    { id: "demo-a", name: "旧账号 A", email: "a•••@gmail.com", current: false, disabled: false, validationBlocked: false, quotas: { "gemini-weekly": { remaining: .08 }, "gemini-5h": { remaining: .21 }, "3p-weekly": { remaining: .16 } } },
    { id: "demo-d", name: "待刷新 D", email: "d•••@gmail.com", current: false, disabled: false, validationBlocked: false, quotas: {} },
  ];
}

function safeParseWorkspace(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    if (typeof first === "string" && first.startsWith("file://")) return decodeURIComponent(new URL(first).pathname);
  } catch { /* use regex fallback */ }
  const match = String(raw).match(/file:\/\/([^"',\]]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function queryConversations(limit = 30) {
  if (DEMO) return demoConversations();
  const db = path.join(AGY_ROOT, "conversation_summaries.db");
  const sqlite = findExecutable(["/usr/bin/sqlite3", "/opt/homebrew/bin/sqlite3", "/usr/local/bin/sqlite3"]);
  if (!sqlite || !fs.existsSync(db)) return scanConversations(limit);
  const sql = `SELECT conversation_id,title,preview,step_count,last_modified_time,workspace_uris,status,project_id FROM conversation_summaries ORDER BY last_modified_time DESC LIMIT ${Math.min(100, Math.max(1, limit))};`;
  // Query a disposable snapshot. SQLite can create lock/SHM files even for a
  // read; keeping those out of the live agy directory makes the picker work
  // reliably while the CLI or a sandbox is active.
  const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-relay-summary-"));
  const snapshotDb = path.join(snapshotDir, "summary.db");
  let result;
  try {
    fs.copyFileSync(db, snapshotDb);
    for (const suffix of ["-wal", "-shm"]) {
      if (fs.existsSync(`${db}${suffix}`)) fs.copyFileSync(`${db}${suffix}`, `${snapshotDb}${suffix}`);
    }
    result = spawnSync(sqlite, ["-json", snapshotDb, sql], { encoding: "utf8", timeout: 5000 });
  } catch {
    return scanConversations(limit);
  } finally {
    fs.rmSync(snapshotDir, { recursive: true, force: true });
  }
  if (result.status !== 0 || !result.stdout.trim()) return scanConversations(limit);
  try {
    return JSON.parse(result.stdout).map((row) => ({
      id: row.conversation_id,
      title: row.title || "未命名对话",
      preview: row.preview || "",
      stepCount: Number(row.step_count || 0),
      modifiedAt: row.last_modified_time,
      workspace: safeParseWorkspace(row.workspace_uris),
      status: row.status || "",
      projectId: row.project_id || "",
    }));
  } catch { return scanConversations(limit); }
}

function scanConversations(limit = 30) {
  const dir = path.join(AGY_ROOT, "conversations");
  try {
    return fs.readdirSync(dir).filter((file) => /^[0-9a-f-]{36}\.db$/i.test(file)).map((file) => {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      const id = file.slice(0, -3);
      const annotation = path.join(AGY_ROOT, "annotations", `${id}.pbtxt`);
      let title = `对话 ${id.slice(0, 8)}`;
      try {
        const match = fs.readFileSync(annotation, "utf8").match(/title\s*:\s*"((?:\\.|[^"\\])*)"/);
        if (match) title = match[1].replaceAll('\\"', '"').replaceAll("\\\\", "\\");
      } catch { /* annotation is optional */ }
      return { id, title, preview: "摘要库暂时不可读", stepCount: null, modifiedAt: stat.mtime.toISOString(), workspace: null, status: "", projectId: "" };
    }).sort((a,b) => new Date(b.modifiedAt)-new Date(a.modifiedAt)).slice(0, limit);
  } catch { return []; }
}

function demoConversations() {
  return [
    { id: "11111111-1111-4111-8111-111111111111", title: "重构支付系统 · 长对话", preview: "继续完成迁移后的接口验证与回归测试…", stepCount: 22872, modifiedAt: new Date().toISOString(), workspace: path.join(HOME, "Projects", "payments"), status: "", projectId: "default-cli-project" },
    { id: "22222222-2222-4222-8222-222222222222", title: "数据看板样式调整", preview: "统一图表色彩和移动端布局", stepCount: 1842, modifiedAt: new Date(Date.now()-65*60e3).toISOString(), workspace: path.join(HOME, "Projects", "dashboard"), status: "", projectId: "default-cli-project" },
    { id: "33333333-3333-4333-8333-333333333333", title: "API 日志排障", preview: "定位间歇性 502 的上游原因", stepCount: 906, modifiedAt: new Date(Date.now()-864e5).toISOString(), workspace: path.join(HOME, "Projects", "api"), status: "", projectId: "default-cli-project" },
  ];
}

function agyProcesses() {
  const result = spawnSync("/usr/bin/pgrep", ["-x", "agy"], { encoding: "utf8" });
  if (result.status !== 0) return [];
  return result.stdout.trim().split(/\s+/).filter(Boolean).map(Number);
}

function loadHistory() {
  const value = jsonFile(HISTORY_FILE, []);
  return Array.isArray(value) ? value.slice(0, 30) : [];
}

function saveJob(job) {
  const safe = {
    id: job.id, state: job.state, createdAt: job.createdAt, updatedAt: job.updatedAt,
    sourceConversationId: job.sourceConversationId, targetConversationId: job.targetConversationId || null,
    targetAccountId: job.targetAccountId, sourceTitle: job.sourceTitle,
    workspace: job.workspace, error: job.error || null, steps: job.steps,
    backups: job.backups || null,
  };
  const history = loadHistory().filter((item) => item.id !== safe.id);
  writeJsonAtomic(HISTORY_FILE, [safe, ...history].slice(0, 30));
}

function publicJob(job) {
  if (!job) return null;
  return { ...job, report: undefined };
}

function updateJob(job, patch) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  saveJob(job);
}

function addStep(job, label, state = "done", detail = "") {
  job.steps.push({ label, state, detail, at: new Date().toISOString() });
  updateJob(job, {});
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, ...(options.env || {}) }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`${path.basename(command)} 操作超时`)); }, options.timeout || 120000);
    child.stdout.on("data", (chunk) => { stdout += chunk; if (stdout.length > 8_000_000) stdout = stdout.slice(-8_000_000); });
    child.stderr.on("data", (chunk) => { stderr += chunk; if (stderr.length > 2_000_000) stderr = stderr.slice(-2_000_000); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error((stderr || stdout || `${path.basename(command)} 退出码 ${code}`).trim().slice(-1200)));
    });
  });
}

function findConversationId(output) {
  const candidates = [];
  for (const line of output.split(/\r?\n/)) {
    try { candidates.push(JSON.parse(line)); } catch { /* non-json progress */ }
  }
  try { candidates.push(JSON.parse(output)); } catch { /* json-lines */ }
  const visit = (value) => {
    if (!value || typeof value !== "object") return null;
    for (const key of ["conversation_id", "conversationId", "session_id", "sessionId"]) {
      if (typeof value[key] === "string" && /^[0-9a-f-]{36}$/i.test(value[key])) return value[key];
    }
    for (const child of Object.values(value)) {
      const found = visit(child); if (found) return found;
    }
    return null;
  };
  for (const value of candidates) { const found = visit(value); if (found) return found; }
  const match = output.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match?.[0] || null;
}

async function performHandoff(job) {
  try {
    if (agyProcesses().length) throw new Error("检测到 agy 仍在运行。请先退出所有 agy 窗口，再重试。");
    if (!(await managerOnline())) throw new Error("Antigravity Tools 没有运行。请先点“启动 Tools”。");
    const accounts = readAccounts();
    const target = accounts.find((account) => account.id === job.targetAccountId);
    if (!target) throw new Error("目标账号不存在，可能刚被删除或尚未导入。");
    if (target.disabled || target.validationBlocked) throw new Error("目标账号当前被禁用或需要重新验证。");
    const source = queryConversations(100).find((conversation) => conversation.id === job.sourceConversationId);
    if (!source && !fs.existsSync(path.join(AGY_ROOT, "conversations", `${job.sourceConversationId}.db`))) throw new Error("找不到源对话数据库。");
    addStep(job, "安全检查完成", "done", "agy 已关闭，源对话和目标账号可用");

    await managerRequest("/api/accounts/switch", { method: "POST", body: { accountId: job.targetAccountId, targetIde: "agy" }, timeout: 15000 });
    addStep(job, "切换额度账号", "done", `已切换到 ${target.name}`);

    const agy = agyBinary();
    if (!agy) throw new Error("找不到 agy。请确认 Antigravity CLI 已安装。");
    const workspace = job.workspace && fs.existsSync(job.workspace) ? job.workspace : HOME;
    addStep(job, "创建接力空壳", "running", "正在让新账号创建安全的身份绑定…");
    const placeholder = await runProcess(agy, ["--mode", "plan", "--output-format", "json", "--print", "Reply with exactly: HANDOFF_READY"], { cwd: workspace, timeout: 180000 });
    const targetConversationId = findConversationId(`${placeholder.stdout}\n${placeholder.stderr}`);
    if (!targetConversationId) throw new Error("新账号响应成功，但未能识别新对话编号。没有改动旧对话。");
    job.steps[job.steps.length - 1] = { label: "创建接力空壳", state: "done", detail: `新对话 ${targetConversationId.slice(0, 8)}…`, at: new Date().toISOString() };
    updateJob(job, { targetConversationId });

    addStep(job, "移植完整上下文", "running", "复制轨迹、工具记录和 brain；保留新账号绑定");
    const transplant = await runProcess("/usr/bin/python3", [TRANSPLANTER, "--source-root", AGY_ROOT, "--source-id", job.sourceConversationId, "--target-root", AGY_ROOT, "--target-id", targetConversationId, "--title", job.sourceTitle || source?.title || "接力对话", "--apply", "--yes", "--json"], { timeout: 15 * 60_000 });
    let report;
    try { report = JSON.parse(transplant.stdout); } catch { throw new Error("移植工具完成但验证报告不可读，请不要打开目标对话。"); }
    job.steps[job.steps.length - 1] = { label: "移植完整上下文", state: "done", detail: `${report.copied_rows?.steps?.toLocaleString?.() || report.copied_rows?.steps || 0} 条轨迹已复制`, at: new Date().toISOString() };
    job.report = report;
    updateJob(job, { backups: report.automatic_backups || null });

    if (report?.verification?.destination_integrity !== "ok" || !report?.verification?.row_counts_match || !report?.verification?.binding_tables_unchanged) throw new Error("完整性验证未通过，目标对话已被锁定，请执行回滚。");
    addStep(job, "三重验证通过", "done", "数据库完整、轨迹数量一致、账号绑定未变");
    updateJob(job, { state: "complete" });
  } catch (error) {
    if (job.steps.at(-1)?.state === "running") job.steps[job.steps.length - 1].state = "failed";
    const originalError = error.message || String(error);
    if (job.backups?.database && job.targetConversationId) {
      try {
        restoreBackupFiles(job);
        addStep(job, "已自动回滚", "done", "目标空壳已恢复，源对话从未改动");
        updateJob(job, { state: "failed_rolled_back", error: originalError });
        return;
      } catch (rollbackError) {
        updateJob(job, { state: "rollback_failed", error: `${originalError}；自动回滚也失败：${rollbackError.message}` });
        return;
      }
    }
    updateJob(job, { state: "failed", error: originalError });
  }
}

function restoreBackupFiles(job) {
  if (!job?.backups?.database || !job.targetConversationId) throw new Error("这个接力没有可用的自动备份。");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(job.targetConversationId)) throw new Error("备份记录中的目标对话编号不合法。");
  if (agyProcesses().length) throw new Error("请先退出所有 agy 窗口再回滚。");
  const targetDb = path.join(AGY_ROOT, "conversations", `${job.targetConversationId}.db`);
  if (!fs.existsSync(job.backups.database)) throw new Error("数据库备份已不存在。");
  fs.copyFileSync(job.backups.database, targetDb);
  const targetBrain = path.join(AGY_ROOT, "brain", job.targetConversationId);
  fs.rmSync(targetBrain, { recursive: true, force: true });
  if (job.backups.brain && fs.existsSync(job.backups.brain)) {
    fs.cpSync(job.backups.brain, targetBrain, { recursive: true });
  }
  const targetAnnotation = path.join(AGY_ROOT, "annotations", `${job.targetConversationId}.pbtxt`);
  if (job.backups.annotation && fs.existsSync(job.backups.annotation)) fs.copyFileSync(job.backups.annotation, targetAnnotation);
  else fs.rmSync(targetAnnotation, { force: true });
}

function restoreBackup(job) {
  restoreBackupFiles(job);
  updateJob(job, { state: "rolled_back", error: null });
  addStep(job, "已恢复接力前状态", "done", "旧对话没有受到影响");
}

function launchConversation(conversationId, workspace) {
  const agy = agyBinary();
  if (!agy) throw new Error("找不到 agy 可执行文件。");
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) throw new Error("对话编号不合法。");
  const cwd = workspace && fs.existsSync(workspace) ? workspace : HOME;
  fs.mkdirSync(STATE_ROOT, { recursive: true, mode: 0o700 });
  const commandFile = path.join(STATE_ROOT, `open-${conversationId}.command`);
  const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
  fs.writeFileSync(commandFile, `#!/bin/zsh\ncd ${shellQuote(cwd)}\nexec ${shellQuote(agy)} --conversation ${shellQuote(conversationId)}\n`, { mode: 0o700 });
  const opened = spawnSync("/usr/bin/open", [commandFile], { encoding: "utf8" });
  if (opened.status !== 0) throw new Error(opened.stderr || "无法打开终端。");
}

async function statusPayload() {
  const online = DEMO ? true : await managerOnline();
  return {
    demo: DEMO,
    manager: { online, installed: Boolean(managerBinary()), accountCount: readAccounts().length },
    agy: { installed: Boolean(agyBinary()), runningPids: DEMO ? [] : agyProcesses() },
    accounts: readAccounts(),
    conversations: queryConversations(30),
    history: loadHistory(),
  };
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; if (data.length > 64_000) { reject(new Error("请求太大")); req.destroy(); } });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error("请求格式不正确")); } });
    req.on("error", reject);
  });
}

function validMutation(req) {
  const origin = req.headers.origin;
  const validOrigins = new Set([`http://${HOST}:${PORT}`, `http://localhost:${PORT}`]);
  return req.headers["x-panel-token"] === PANEL_TOKEN && (!origin || validOrigins.has(origin));
}

async function api(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/status") return sendJson(res, 200, await statusPayload());
  if (req.method === "GET" && url.pathname.startsWith("/api/handoffs/")) {
    const id = url.pathname.split("/").at(-1);
    const job = jobs.get(id) || loadHistory().find((item) => item.id === id);
    return job ? sendJson(res, 200, publicJob(job)) : sendJson(res, 404, { error: "找不到这个接力任务" });
  }
  if (req.method !== "POST") return sendJson(res, 405, { error: "不支持这个操作" });
  if (!validMutation(req)) return sendJson(res, 403, { error: "本地安全校验失败，请刷新页面" });
  const body = await readBody(req);
  if (url.pathname === "/api/manager/start") {
    const binary = managerBinary();
    if (!binary) return sendJson(res, 404, { error: "未找到 Antigravity Tools.app" });
    const child = spawn(binary, [], { detached: true, stdio: "ignore" }); child.unref();
    return sendJson(res, 202, { ok: true });
  }
  if (url.pathname === "/api/accounts/refresh") {
    if (!(await managerOnline())) return sendJson(res, 409, { error: "请先启动 Antigravity Tools" });
    await managerRequest("/api/accounts/refresh", { method: "POST", body: {}, timeout: 120000 });
    return sendJson(res, 200, { ok: true });
  }
  if (url.pathname === "/api/handoffs") {
    if (!/^[0-9a-f-]{36}$/i.test(body.sourceConversationId || "")) return sendJson(res, 400, { error: "请选择源对话" });
    if (!body.targetAccountId) return sendJson(res, 400, { error: "请选择目标账号" });
    if (jobs.size && [...jobs.values()].some((job) => job.state === "running")) return sendJson(res, 409, { error: "已有一个接力正在进行" });
    const source = queryConversations(100).find((item) => item.id === body.sourceConversationId);
    const job = {
      id: crypto.randomUUID(), state: "running", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      sourceConversationId: body.sourceConversationId, sourceTitle: source?.title || "未命名对话",
      targetAccountId: body.targetAccountId, workspace: body.workspace || source?.workspace || HOME,
      steps: [], error: null,
    };
    jobs.set(job.id, job); saveJob(job); performHandoff(job);
    return sendJson(res, 202, publicJob(job));
  }
  const rollbackMatch = url.pathname.match(/^\/api\/handoffs\/([0-9a-f-]+)\/rollback$/i);
  if (rollbackMatch) {
    const job = jobs.get(rollbackMatch[1]) || loadHistory().find((item) => item.id === rollbackMatch[1]);
    if (!job) return sendJson(res, 404, { error: "找不到这个接力任务" });
    restoreBackup(job); jobs.set(job.id, job);
    return sendJson(res, 200, publicJob(job));
  }
  const launchMatch = url.pathname.match(/^\/api\/conversations\/([0-9a-f-]+)\/launch$/i);
  if (launchMatch) { launchConversation(launchMatch[1], body.workspace); return sendJson(res, 200, { ok: true }); }
  return sendJson(res, 404, { error: "接口不存在" });
}

function serveStatic(req, res, url) {
  let relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!/^[a-zA-Z0-9._/-]+$/.test(relative) || relative.includes("..")) { res.writeHead(404); return res.end(); }
  const file = path.join(DIST, relative);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
  let body = fs.readFileSync(file);
  if (relative === "index.html") body = Buffer.from(body.toString("utf8").replace("__PANEL_TOKEN_VALUE__", PANEL_TOKEN));
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
    "Content-Length": body.length,
    "Cache-Control": relative === "index.html" ? "no-store" : "public, max-age=300",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  try {
    if (url.pathname.startsWith("/api/")) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (error) { sendJson(res, 500, { error: error.message || "本地面板发生错误" }); }
});

server.listen(PORT, HOST, () => {
  console.log(`Agy Relay Deck: http://${HOST}:${PORT}`);
  console.log("仅监听本机；关闭此终端即可停止面板。");
  if (process.env.NO_OPEN !== "1") spawn("/usr/bin/open", [`http://${HOST}:${PORT}`], { detached: true, stdio: "ignore" }).unref();
});
