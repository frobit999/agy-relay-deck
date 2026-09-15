const $ = (selector) => document.querySelector(selector);
const token = document.querySelector('meta[name="panel-token"]').content;
const state = { data: null, selectedConversation: null, activeJob: null, poller: null };

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
  if (!domain) return email;
  return `${name.slice(0, 2)}•••@${domain}`;
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
  clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove("show"), 3600);
}

function setStatus(element, kind, text) { element.className = `status-pill ${kind}`; element.innerHTML = `<i></i>${escapeHtml(text)}`; }

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

  const select = $("#target-account");
  const previous = select.value;
  select.innerHTML = '<option value="">先选择一个有额度的账号</option>' + accounts.filter((a) => !a.disabled && !a.validationBlocked).map((account) => {
    const weekly = percent(account.quotas?.["gemini-weekly"]?.remaining);
    return `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)} · 周额度 ${weekly === null ? "未知" : `${weekly}%`}${account.current ? " · 当前" : ""}</option>`;
  }).join("");
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
}

function renderConversations() {
  const query = $("#conversation-search").value.trim().toLowerCase();
  const conversations = (state.data?.conversations || []).filter((item) => [item.title, item.preview, item.id, item.workspace].join(" ").toLowerCase().includes(query));
  $("#conversation-list").innerHTML = conversations.length ? conversations.map((item) => `
    <button type="button" class="conversation-item ${state.selectedConversation?.id === item.id ? "selected" : ""}" role="option" aria-selected="${state.selectedConversation?.id === item.id}" data-id="${escapeHtml(item.id)}">
      <span class="conversation-radio"></span><span class="conversation-copy"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.preview || item.workspace || item.id)}</small></span>
      <span class="conversation-meta">${item.stepCount === null ? "—" : Number(item.stepCount).toLocaleString()} steps<br>${escapeHtml(relativeTime(item.modifiedAt))}</span>
    </button>`).join("") : '<div class="history-empty"><strong>没有匹配的对话</strong>换个关键词试试。</div>';
  document.querySelectorAll(".conversation-item").forEach((button) => button.addEventListener("click", () => {
    state.selectedConversation = state.data.conversations.find((item) => item.id === button.dataset.id);
    renderConversations(); updateRelayButton();
  }));
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
    </article>`).join("") : '<div class="history-empty"><strong>还没有接力记录</strong>第一次成功后，这里会留下可回滚记录。</div>';
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
    try { await request(`/api/conversations/${button.dataset.id}/launch`, { method:"POST", body:JSON.stringify({ workspace:button.dataset.workspace }) }); toast("已在新终端打开接力后的对话"); }
    catch (error) { toast(error.message); }
  });
  document.querySelectorAll(".rollback").forEach((button) => button.onclick = async () => {
    if (!confirm("确认把这个目标对话恢复到接力前吗？源对话不会受影响。")) return;
    try { const job = await request(`/api/handoffs/${button.dataset.job}/rollback`, { method:"POST", body:"{}" }); state.activeJob = job; renderActiveJob(job); await loadStatus(false); toast("已恢复接力前状态"); }
    catch (error) { toast(error.message); }
  });
}

function updateRelayButton() {
  const hasSelection = Boolean(state.selectedConversation && $("#target-account").value);
  const safe = !state.data?.agy?.runningPids?.length && state.data?.manager?.online;
  $("#relay-button").disabled = !hasSelection || !safe || state.activeJob?.state === "running";
}

function render(data) {
  state.data = data;
  setStatus($("#manager-status"), data.manager.online ? "ok" : "bad", data.manager.online ? "Tools 已连接" : data.manager.installed ? "Tools 未启动" : "Tools 未找到");
  setStatus($("#agy-status"), data.agy.runningPids.length ? "warn" : data.agy.installed ? "ok" : "bad", data.agy.runningPids.length ? `Agy 运行中 ×${data.agy.runningPids.length}` : data.agy.installed ? "Agy 已就绪" : "Agy 未找到");
  renderAccounts(data.accounts); renderConversations(); renderHistory(data.history || []); updateRelayButton();
}

async function loadStatus(showToast = false) {
  $("#refresh").classList.add("loading");
  try { render(await request("/api/status")); if (showToast) toast("状态已刷新"); }
  catch (error) { toast(error.message); }
  finally { $("#refresh").classList.remove("loading"); }
}

async function pollJob(id) {
  clearInterval(state.poller);
  const poll = async () => {
    try {
      const job = await request(`/api/handoffs/${id}`); state.activeJob = job; renderActiveJob(job); updateRelayButton();
      if (job.state !== "running") { clearInterval(state.poller); await loadStatus(false); toast(job.state === "complete" ? "接力完成：上下文已安全转移" : `接力停止：${job.error || statusLabel(job.state)}`); }
    } catch (error) { clearInterval(state.poller); toast(error.message); }
  };
  await poll(); state.poller = setInterval(poll, 1400);
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
    state.activeJob = job; renderActiveJob(job); updateRelayButton(); await pollJob(job.id);
  } catch (error) { toast(error.message); await loadStatus(false); }
}

$("#conversation-search").addEventListener("input", renderConversations);
$("#target-account").addEventListener("change", updateRelayButton);
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
