const $ = (selector) => document.querySelector(selector);
const token = document.querySelector('meta[name="panel-token"]').content;
const state = { data: null, selectedConversation: null, activeJob: null, poller: null, roomPoller: null };

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[char]);
}

function relativeTime(value) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const seconds = Math.round((date - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return format.format(seconds, "second");
  const minutes = Math.round(seconds / 60); if (Math.abs(minutes) < 60) return format.format(minutes, "minute");
  const hours = Math.round(minutes / 60); if (Math.abs(hours) < 24) return format.format(hours, "hour");
  return format.format(Math.round(hours / 24), "day");
}

function percent(value) { return typeof value === "number" ? Math.max(0, Math.min(100, Math.round(value * 100))) : null; }
function quotaClass(value) { return value === null ? "unknown" : value >= 55 ? "good" : value >= 20 ? "mid" : "low"; }
function maskedEmail(email = "") {
  const [name, domain] = email.split("@");
  return domain ? `${name.slice(0, 2)}•••@${domain}` : email;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.method === "POST" ? { "Content-Type":"application/json", "X-Panel-Token":token } : {}), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `操作失败（${response.status}）`);
  return data;
}

let toastTimer;
function toast(message) {
  const element = $("#toast"); element.textContent = message; element.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove("show"), 4200);
}

function setStatus(element, kind, text) { element.className = `status-pill ${kind}`; element.innerHTML = `<i></i>${escapeHtml(text)}`; }

function accountOptions(accounts, placeholder) {
  return `<option value="">${escapeHtml(placeholder)}</option>` + accounts.filter((a) => !a.disabled && !a.validationBlocked).map((account) => {
    const weekly = percent(account.quotas?.["gemini-weekly"]?.remaining);
    return `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)} · 周额度 ${weekly === null ? "未知" : `${weekly}%`}${account.current ? " · 当前" : ""}</option>`;
  }).join("");
}

function fillSelect(select, html, preferred = null) {
  const previous = preferred ?? select.value;
  select.innerHTML = html;
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
}

function renderAccounts(accounts) {
  $("#account-count").textContent = accounts.length;
  $("#accounts").innerHTML = accounts.length ? accounts.map((account) => {
    const weekly = percent(account.quotas?.["gemini-weekly"]?.remaining);
    const fiveHour = percent(account.quotas?.["gemini-5h"]?.remaining);
    const thirdParty = percent(account.quotas?.["3p-weekly"]?.remaining);
    return `<article class="account-card ${account.current ? "current" : ""}">
      <div class="account-top"><div class="account-name"><strong>${escapeHtml(account.name)}</strong><small>${escapeHtml(maskedEmail(account.email))}</small></div>${account.current ? '<span class="current-flag">当前账号</span>' : ""}</div>
      <div class="quota-main"><span>Gemini 周额度剩余</span><strong class="${quotaClass(weekly)}">${weekly === null ? "未知" : `${weekly}%`}</strong></div>
      <div class="meter"><i style="width:${weekly || 0}%"></i></div>
      <div class="quota-sub"><span>5 小时 ${fiveHour === null ? "未知" : `${fiveHour}%`}</span><span>Claude / GPT 周 ${thirdParty === null ? "未知" : `${thirdParty}%`}</span></div>
    </article>`;
  }).join("") : '<div class="history-empty"><strong>还没有账号</strong>先在 Antigravity Tools 中导入账号。</div>';

  fillSelect($("#target-account"), accountOptions(accounts, "先选择一个有额度的账号"));
  const current = accounts.find((account) => account.current)?.id || "";
  fillSelect($("#room-account"), accountOptions(accounts, "选择窗口使用的账号"), $("#room-account").value || current);
}

function renderConversationPicker() {
  const query = $("#conversation-search").value.trim().toLowerCase();
  const conversations = (state.data?.conversations || []).filter((item) => [item.title, item.preview, item.id, item.workspace].join(" ").toLowerCase().includes(query));
  $("#conversation-list").innerHTML = conversations.length ? conversations.map((item) => `
    <button type="button" class="conversation-item ${state.selectedConversation?.id === item.id ? "selected" : ""}" role="option" aria-selected="${state.selectedConversation?.id === item.id}" data-id="${escapeHtml(item.id)}">
      <span class="conversation-radio"></span><span class="conversation-copy"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.preview || item.workspace || item.id)}</small></span>
      <span class="conversation-meta">${item.stepCount === null ? "—" : Number(item.stepCount).toLocaleString()} steps<br>${escapeHtml(relativeTime(item.modifiedAt))}</span>
    </button>`).join("") : '<div class="history-empty"><strong>没有匹配的对话</strong>换个关键词试试。</div>';
  document.querySelectorAll(".conversation-item").forEach((button) => button.addEventListener("click", () => {
    state.selectedConversation = state.data.conversations.find((item) => item.id === button.dataset.id);
    renderConversationPicker(); updateButtons();
  }));
}

function renderRoomSetup(conversations) {
  const html = '<option value="">选择最近对话</option>' + conversations.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)} · ${item.stepCount === null ? "—" : Number(item.stepCount).toLocaleString()} steps · ${escapeHtml(relativeTime(item.modifiedAt))}</option>`).join("");
  fillSelect($("#room-source"), html);
}

function roomStateLabel(value) {
  return ({ creating:"正在分裂", ready:"并行中", merging:"正在汇合", merged:"已成为新母会话", failed:"创建失败", merge_failed:"汇合失败", merge_failed_rolled_back:"失败但已回滚", merge_rollback_failed:"需要人工检查" })[value] || value;
}

function roomCanMerge(room) { return ["ready", "merge_failed", "merge_failed_rolled_back"].includes(room.state); }

function renderRooms(rooms) {
  const accounts = state.data?.accounts || [];
  const running = Boolean(state.data?.agy?.runningPids?.length);
  $("#rooms").innerHTML = rooms.length ? rooms.map((room) => {
    const active = ["creating", "merging"].includes(room.state);
    const steps = (room.steps || []).slice(-7);
    const primaryOptions = room.branches.map((branch, index) => `<option value="${escapeHtml(branch.conversationId)}" ${room.primaryBranchId === branch.conversationId || (!room.primaryBranchId && index === 0) ? "selected" : ""}>窗口 ${escapeHtml(branch.label)} · 完整保留</option>`).join("");
    const mergeAccounts = accountOptions(accounts, "汇合后使用哪个账号");
    return `<article class="room-card ${active ? "active" : ""}" data-room="${escapeHtml(room.id)}" data-workspace="${escapeHtml(room.workspace || "")}">
      <div class="room-card-head"><div class="room-card-title"><strong>${escapeHtml(room.sourceTitle)}</strong><small>ROOM ${escapeHtml(room.id.slice(0, 8))} · ${room.branches.length} 个窗口 · ${escapeHtml(relativeTime(room.updatedAt))}</small></div><span class="room-state ${escapeHtml(room.state)}">${escapeHtml(roomStateLabel(room.state))}</span></div>
      ${room.branches.length ? `<div class="branch-grid">${room.branches.map((branch) => `<div class="branch-card"><strong>窗口 ${escapeHtml(branch.label)}<span>${branch.addedSteps === null ? "增量未知" : `+${Number(branch.addedSteps).toLocaleString()}`}</span></strong><small>${escapeHtml(branch.conversationId.slice(0, 8))}… · 当前 ${branch.currentStepCount === null ? "—" : Number(branch.currentStepCount).toLocaleString()} steps</small></div>`).join("")}</div>` : ""}
      ${steps.length && (active || /failed/.test(room.state)) ? `<div class="room-progress">${steps.map((step) => `<div class="job-step ${escapeHtml(step.state)}"><i></i><span><strong>${escapeHtml(step.label)}</strong>${step.detail ? `<small>${escapeHtml(step.detail)}</small>` : ""}</span></div>`).join("")}${room.error ? `<div class="room-error">${escapeHtml(room.error)}</div>` : ""}</div>` : ""}
      ${roomCanMerge(room) ? `<div class="room-controls"><button class="secondary-button launch-room" data-action="launch-room" ${running ? "disabled" : ""}>${running ? "已有 agy 窗口运行" : "打开全部窗口"}</button><select data-role="primary">${primaryOptions}</select><select data-role="merge-account">${mergeAccounts}</select><button class="primary-button" data-action="merge-room" ${running ? "disabled" : ""}>汇合并换号</button></div>` : ""}
      ${room.state === "merged" && room.canonicalConversationId ? `<div class="room-canonical"><div><strong>新的唯一母会话已生成</strong><small>${escapeHtml(room.canonicalConversationId.slice(0, 8))}… · ${room.mergeShardCount || 0} 个记忆分片已吸收</small></div><div class="history-actions"><button class="mini-button" data-action="launch-canonical" data-id="${escapeHtml(room.canonicalConversationId)}">打开母会话</button><button class="mini-button" data-action="reseed" data-id="${escapeHtml(room.canonicalConversationId)}">再开一轮窗口</button></div></div>` : ""}
      ${room.error && !active && !/failed/.test(room.state) ? `<div class="room-error">${escapeHtml(room.error)}</div>` : ""}
    </article>`;
  }).join("") : '<div class="rooms-empty">还没有并行房间。选择一段母对话和窗口数量即可开始。</div>';
  bindRoomActions();
}

function statusLabel(status) { return ({ complete:"接力完成", failed:"接力失败", failed_rolled_back:"失败但已自动回滚", rollback_failed:"接力和回滚均需检查", rolled_back:"已回滚", running:"接力中" })[status] || status; }

function renderHistory(history) {
  const visible = history.filter((item) => item.id !== state.activeJob?.id);
  $("#history").innerHTML = visible.length ? visible.map((item) => `
    <article class="history-item ${item.state === "complete" ? "complete" : item.state === "rolled_back" || item.state === "failed_rolled_back" ? "rolled_back" : "failed"}">
      <strong>${escapeHtml(item.sourceTitle || item.sourceConversationId?.slice(0,8) || "接力任务")}</strong>
      <p>${escapeHtml(statusLabel(item.state))}${item.targetConversationId ? ` · 新对话 ${escapeHtml(item.targetConversationId.slice(0,8))}…` : ""}</p>
      <time>${escapeHtml(relativeTime(item.updatedAt))}</time>
      ${(item.state === "complete" || item.state === "failed") ? `<div class="history-actions">${item.targetConversationId && item.state === "complete" ? `<button class="mini-button launch" data-id="${item.targetConversationId}" data-workspace="${escapeHtml(item.workspace || "")}">打开新对话</button>` : ""}${item.backups?.database ? `<button class="mini-button danger rollback" data-job="${item.id}">回滚</button>` : ""}</div>` : ""}
    </article>`).join("") : '<div class="history-empty"><strong>还没有单线接力记录</strong>并行房间记录显示在上方。</div>';
  bindHistoryActions();
}

function renderActiveJob(job) {
  const box = $("#active-job");
  if (!job) { box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  box.innerHTML = `<h3>${job.state === "running" ? "正在接力，请勿打开 agy" : escapeHtml(statusLabel(job.state))}</h3>
    ${(job.steps || []).map((step) => `<div class="job-step ${escapeHtml(step.state)}"><i></i><span><strong>${escapeHtml(step.label)}</strong>${step.detail ? `<small>${escapeHtml(step.detail)}</small>` : ""}</span></div>`).join("")}
    ${job.error ? `<div class="job-error">${escapeHtml(job.error)}</div>` : ""}
    ${job.state === "complete" ? `<div class="history-actions"><button class="mini-button launch" data-id="${job.targetConversationId}" data-workspace="${escapeHtml(job.workspace || "")}">在终端打开新对话</button><button class="mini-button danger rollback" data-job="${job.id}">撤销这次接力</button></div>` : ""}`;
  bindHistoryActions();
}

function bindHistoryActions() {
  document.querySelectorAll(".launch").forEach((button) => button.onclick = async () => {
    try { await request(`/api/conversations/${button.dataset.id}/launch`, { method:"POST", body:JSON.stringify({ workspace:button.dataset.workspace }) }); toast("已在新终端打开对话"); }
    catch (error) { toast(error.message); }
  });
  document.querySelectorAll(".rollback").forEach((button) => button.onclick = async () => {
    if (!confirm("确认把这个目标对话恢复到接力前吗？源对话不会受影响。")) return;
    try { const job = await request(`/api/handoffs/${button.dataset.job}/rollback`, { method:"POST", body:"{}" }); state.activeJob = job; renderActiveJob(job); await loadStatus(false); toast("已恢复接力前状态"); }
    catch (error) { toast(error.message); }
  });
}

function bindRoomActions() {
  document.querySelectorAll('[data-action="launch-room"]').forEach((button) => button.onclick = async () => {
    const roomId = button.closest(".room-card").dataset.room;
    try { const result = await request(`/api/rooms/${roomId}/launch`, { method:"POST", body:"{}" }); toast(`已打开 ${result.opened} 个独立窗口`); setTimeout(() => loadStatus(false), 900); }
    catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-action="merge-room"]').forEach((button) => button.onclick = async () => {
    const card = button.closest(".room-card");
    const roomId = card.dataset.room;
    const primaryBranchId = card.querySelector('[data-role="primary"]').value;
    const targetAccountId = card.querySelector('[data-role="merge-account"]').value;
    if (!targetAccountId) return toast("先选择汇合后的账号");
    if (!confirm("确认所有并行窗口都已关闭吗？汇合会保留一条完整主干，并逐段吸收其他窗口的新记忆。")) return;
    try {
      const room = await request(`/api/rooms/${roomId}/merge`, { method:"POST", body:JSON.stringify({ targetAccountId, primaryBranchId }) });
      replaceRoom(room); renderRooms(state.data.rooms); updateButtons(); pollRoom(room.id);
    } catch (error) { toast(error.message); await loadStatus(false); }
  });
  document.querySelectorAll('[data-action="launch-canonical"]').forEach((button) => button.onclick = async () => {
    try { await request(`/api/conversations/${button.dataset.id}/launch`, { method:"POST", body:JSON.stringify({ workspace:button.closest(".room-card").dataset.workspace }) }); toast("已打开新的唯一母会话"); }
    catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-action="reseed"]').forEach((button) => button.onclick = () => {
    $("#room-source").value = button.dataset.id;
    $("#room-source").scrollIntoView({ behavior:"smooth", block:"center" });
    updateButtons(); toast("已选中新的母会话，可以再次分裂");
  });
}

function replaceRoom(room) {
  const rooms = state.data?.rooms || [];
  const index = rooms.findIndex((item) => item.id === room.id);
  if (index >= 0) rooms[index] = room; else rooms.unshift(room);
}

function updateButtons() {
  const safe = !state.data?.agy?.runningPids?.length && state.data?.manager?.online;
  $("#relay-button").disabled = !(state.selectedConversation && $("#target-account").value && safe && state.activeJob?.state !== "running");
  const count = Number($("#room-count").value);
  $("#room-create").disabled = !($("#room-source").value && $("#room-account").value && count >= 2 && count <= 6 && safe);
}

function render(data) {
  state.data = data;
  setStatus($("#manager-status"), data.manager.online ? "ok" : "bad", data.manager.online ? "Tools 已连接" : data.manager.installed ? "Tools 未启动" : "Tools 未找到");
  setStatus($("#agy-status"), data.agy.runningPids.length ? "warn" : data.agy.installed ? "ok" : "bad", data.agy.runningPids.length ? `Agy 运行中 ×${data.agy.runningPids.length}` : data.agy.installed ? "Agy 已就绪" : "Agy 未找到");
  renderAccounts(data.accounts); renderRoomSetup(data.conversations); renderConversationPicker(); renderRooms(data.rooms || []); renderHistory(data.history || []); updateButtons();
}

async function loadStatus(showToast = false) {
  $("#refresh").classList.add("loading");
  try { render(await request("/api/status")); if (showToast) toast("状态已刷新"); }
  catch (error) { toast(error.message); }
  finally { $("#refresh").classList.remove("loading"); }
}

async function pollRoom(id) {
  clearInterval(state.roomPoller);
  const poll = async () => {
    try {
      const room = await request(`/api/rooms/${id}`); replaceRoom(room); renderRooms(state.data.rooms); updateButtons();
      if (!["creating", "merging"].includes(room.state)) {
        clearInterval(state.roomPoller); await loadStatus(false);
        if (room.state === "ready") toast("并行房间已就绪，可以打开全部窗口");
        else if (room.state === "merged") toast("汇合完成：新的唯一母会话已生成");
        else toast(room.error || roomStateLabel(room.state));
      }
    } catch (error) { clearInterval(state.roomPoller); toast(error.message); }
  };
  await poll(); state.roomPoller = setInterval(poll, 1600);
}

async function pollJob(id) {
  clearInterval(state.poller);
  const poll = async () => {
    try {
      const job = await request(`/api/handoffs/${id}`); state.activeJob = job; renderActiveJob(job); updateButtons();
      if (job.state !== "running") { clearInterval(state.poller); await loadStatus(false); toast(job.state === "complete" ? "接力完成：上下文已安全转移" : `接力停止：${job.error || statusLabel(job.state)}`); }
    } catch (error) { clearInterval(state.poller); toast(error.message); }
  };
  await poll(); state.poller = setInterval(poll, 1400);
}

async function createRoom() {
  const sourceConversationId = $("#room-source").value;
  const source = state.data.conversations.find((item) => item.id === sourceConversationId);
  const accountId = $("#room-account").value;
  const branchCount = Number($("#room-count").value);
  if (!source || !accountId) return;
  if (!confirm(`从「${source.title}」创建 ${branchCount} 个独立窗口？创建期间请勿打开 agy。`)) return;
  try {
    const room = await request("/api/rooms", { method:"POST", body:JSON.stringify({ sourceConversationId, accountId, branchCount, workspace:source.workspace }) });
    replaceRoom(room); renderRooms(state.data.rooms); updateButtons(); pollRoom(room.id);
  } catch (error) { toast(error.message); await loadStatus(false); }
}

async function startRelay() {
  const target = state.data.accounts.find((account) => account.id === $("#target-account").value);
  const source = state.selectedConversation;
  if (!target || !source) return;
  const dialog = $("#confirm-dialog");
  $("#confirm-copy").innerHTML = `把「<strong>${escapeHtml(source.title)}</strong>」接到账号「<strong>${escapeHtml(target.name)}</strong>」。`;
  dialog.showModal();
  const outcome = await new Promise((resolve) => dialog.addEventListener("close", () => resolve(dialog.returnValue), { once:true }));
  if (outcome !== "confirm") return;
  try {
    const job = await request("/api/handoffs", { method:"POST", body:JSON.stringify({ sourceConversationId:source.id, targetAccountId:target.id, workspace:source.workspace }) });
    state.activeJob = job; renderActiveJob(job); updateButtons(); await pollJob(job.id);
  } catch (error) { toast(error.message); await loadStatus(false); }
}

$("#conversation-search").addEventListener("input", renderConversationPicker);
$("#target-account").addEventListener("change", updateButtons);
$("#room-source").addEventListener("change", updateButtons);
$("#room-account").addEventListener("change", updateButtons);
$("#room-count").addEventListener("input", updateButtons);
$("#room-create").addEventListener("click", createRoom);
$("#relay-form").addEventListener("submit", (event) => { event.preventDefault(); startRelay(); });
$("#refresh").addEventListener("click", () => loadStatus(true));
$("#refresh-quota").addEventListener("click", async () => {
  const button = $("#refresh-quota"); button.disabled = true; button.textContent = "刷新中…";
  try { await request("/api/accounts/refresh", { method:"POST", body:"{}" }); await loadStatus(false); toast("真实额度已刷新"); }
  catch (error) {
    if (/启动/.test(error.message) && state.data?.manager?.installed && confirm("Antigravity Tools 没有运行。现在启动吗？")) {
      await request("/api/manager/start", { method:"POST", body:"{}" }); toast("正在启动 Tools，请过几秒再刷新");
    } else toast(error.message);
  } finally { button.disabled = false; button.textContent = "刷新真实额度"; }
});

loadStatus(false);
