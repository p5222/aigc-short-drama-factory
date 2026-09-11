const API = "/ops/api";
const actionLabels = { clone: "克隆项目", fetch: "刷新远端", pull: "拉取分支", branch: "新建分支", switch: "切换分支", commit: "提交改动", push: "推送分支", deploy: "发布服务器", retryDeploy: "重试同一版本发布", verify: "核验线上版本" };
const deploymentActions = new Set(["deploy", "retryDeploy", "verify"]);
const statusLabels = { running: "执行中", succeeded: "已完成", failed: "失败", interrupted: "已中断" };

export function safeGithubUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password && !url.port ? url.href : "";
  } catch { return ""; }
}

export function actionReadiness(status, busy = false) {
  const branch = status?.branch || "";
  const mainline = /^(main|master)$/i.test(branch);
  const available = Boolean(status && branch && !busy);
  const clean = status?.clean === true;
  const staged = (status?.files || []).some((file) => file.code?.[0] && ![" ", "?"].includes(file.code[0]));
  const canDeploy = available && clean && branch === "main" && status.project?.deployEnabled === true && Number(status.ahead) === 0 && Number(status.behind) === 0;
  return {
    fetch: available,
    pull: available && clean,
    branch: available && clean,
    switch: available && clean,
    commit: available && !mainline && !staged,
    push: available && !mainline,
    deploy: canDeploy,
    retryDeploy: canDeploy && status.lastDeployment?.deployment === "accepted" && /^[a-f0-9]{40}$/i.test(status.head || "") && status.lastDeployment.commit === status.head,
    verify: available && status.project?.deployEnabled === true,
    staged, mainline
  };
}

export function deploymentSummary(job) {
  if (!job) return "尚无可核对的发布记录。";
  if (job.status === "running") return "正在执行发布或版本核验，请等待日志更新。";
  if (job.status === "failed" || job.status === "interrupted") return `${statusLabels[job.status]}：${job.result?.message || "请查看执行日志；尚未确认线上版本。"}`;
  const commit = job.result?.commit ? `（${String(job.result.commit).slice(0, 12)}）` : "";
  if (job.result?.deployment === "verified") return `线上版本已核验${commit}：健康端点报告的提交与发布提交一致。`;
  if (job.result?.deployment === "accepted") return `服务器已接收代码${commit}，线上版本尚未核验。请稍后点击“核验线上版本”。`;
  return job.result?.message || "任务已完成，尚无线上版本一致的核验结果。";
}

export function reconcileSelection(files, selected) {
  return new Set(files.filter((file) => !file.blocked && selected.has(file.name)).map((file) => file.name));
}

if (typeof document !== "undefined") initialize();

function initialize() {
  const $ = (id) => document.getElementById(id);
  const state = { authenticated: false, csrf: "", username: "", epoch: 0, projects: [], jobs: [], projectId: "", status: null, selected: new Set(), activeFile: "", selectedJob: "", busy: false, statusLoading: false, pollTimer: null, loadSequence: 0, diffSequence: 0, drafts: new Map(), deploymentSnapshot: null };

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }
  function message(id, text) { $(id).textContent = text || ""; $(id).hidden = !text; }
  function project() { return state.projects.find((item) => item.id === state.projectId); }
  function projectRunning() { return state.jobs.some((job) => job.projectId === state.projectId && job.status === "running"); }
  function currentJobs() { return state.jobs.filter((job) => job.projectId === state.projectId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); }
  function when(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value || "") : date.toLocaleString("zh-CN", { hour12: false }); }
  function setLink(id, value) {
    const link = $(id), safe = safeGithubUrl(value);
    if (safe) { link.href = safe; link.removeAttribute("aria-disabled"); link.removeAttribute("tabindex"); }
    else { link.removeAttribute("href"); link.setAttribute("aria-disabled", "true"); link.tabIndex = -1; }
  }

  async function request(path, { method = "GET", body } = {}) {
    const epoch = state.epoch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`${API}${path}`, {
        method, credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { Accept: "application/json", ...(method !== "GET" ? { "Content-Type": "application/json", "X-CSRF-Token": state.csrf } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      });
      const data = await response.json().catch(() => null);
      if (state.epoch !== epoch) throw new Error("登录状态已改变，请重新操作。");
      if (!response.ok) {
        if (response.status === 401 && path !== "/auth/login") showLogin("登录已过期，请重新登录。未提交的编辑器文件仍需在原工作副本中确认。");
        const error = new Error(typeof data?.error === "string" ? data.error : `请求失败（HTTP ${response.status}）`);
        error.status = response.status;
        throw error;
      }
      if (!data || typeof data !== "object") throw new Error("服务器返回了无法识别的响应，请刷新后重试。");
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("请求超时，结果可能仍在服务器执行。请先刷新项目和任务记录，再决定是否重试。");
      throw error;
    } finally { clearTimeout(timer); }
  }

  function showLogin(error = "") {
    state.epoch += 1; state.authenticated = false; state.csrf = ""; state.username = "";
    state.projects = []; state.jobs = []; state.projectId = ""; state.status = null; state.selected.clear(); state.drafts.clear(); state.selectedJob = ""; state.activeFile = "";
    state.loadSequence += 1; state.diffSequence += 1; clearTimeout(state.pollTimer);
    $("app-view").hidden = true; $("boot").hidden = true; $("login-view").hidden = false;
    for (const id of ["project-list", "file-list", "audit-list", "job-log", "diff", "diff-name", "project-name", "head", "repo-link", "job-result", "signed-in-as", "branches", "jobs", "branch-name", "upstream", "sync-state", "confirm-project", "confirm-repo", "confirm-head", "deployment-status"]) $(id).replaceChildren();
    setLink("repo-link", ""); setLink("pr", ""); message("notice", ""); message("page-error", "");
    for (const id of ["add-dialog", "deploy-dialog"]) if ($(id).open) $(id).close();
    $("password").value = ""; $("commit-message").value = ""; $("add-form").reset(); $("deploy-form").reset();
    message("login-error", error);
  }

  async function authenticated(session) {
    state.authenticated = true; state.csrf = session.csrfToken; state.username = session.username || "";
    $("login-view").hidden = true; $("boot").hidden = true; $("app-view").hidden = false;
    $("signed-in-as").textContent = `已登录：${state.username}`; $("password").value = "";
    await loadProjects(); schedulePoll();
  }

  async function runUi(work, errorId = "page-error") {
    if (state.busy) return;
    state.busy = true; message(errorId, ""); updateControls();
    try { await work(); }
    catch (error) { if (state.authenticated || errorId === "login-error") message(errorId === "login-error" && state.authenticated ? "page-error" : errorId, error.message || "操作失败，请重试。"); }
    finally { state.busy = false; updateControls(); }
  }

  function updateControls() {
    const busy = state.busy || state.statusLoading || projectRunning();
    const ready = actionReadiness(state.status, busy);
    $("login-submit").disabled = state.busy; $("login-submit").textContent = state.busy ? "正在登录…" : "登录工作台";
    $("add-submit").disabled = state.busy; $("add-submit").textContent = state.busy ? "正在提交…" : "添加并克隆到服务器";
    $("add-project").disabled = state.busy; $("reload-projects").disabled = state.busy; $("empty-add").disabled = state.busy; $("logout").disabled = state.busy;
    document.querySelectorAll(".project-button").forEach((button) => { button.disabled = state.busy; });
    document.querySelectorAll("[data-action]").forEach((button) => { button.disabled = !ready[button.dataset.action]; });
    for (const id of ["branches", "new-branch", "switch", "create-branch"]) $(id).disabled = !ready[id === "create-branch" || id === "new-branch" ? "branch" : "switch"];
    $("commit").disabled = !ready.commit || !state.selected.size || state.selected.size > 200 || !$("commit-message").value.trim();
    $("commit-message").disabled = busy;
    $("select-all").disabled = busy || !(state.status?.files || []).some((file) => !file.blocked);
    document.querySelectorAll(".file-row input").forEach((input) => { input.disabled = busy || input.dataset.blocked === "true"; });
    $("refresh").disabled = state.busy || state.statusLoading;
    $("retry-status").disabled = state.busy || state.statusLoading; $("retry-clone").disabled = busy;
    $("refresh-log").disabled = state.busy;
    $("deploy").disabled = !ready.deploy;
    $("retry-deploy").disabled = !ready.retryDeploy;
    $("deploy-submit").disabled = state.busy || !state.deploymentSnapshot || $("confirm-name").value !== state.deploymentSnapshot.name;
    $("deploy-submit").textContent = state.busy ? "正在提交…" : state.deploymentSnapshot?.action === "retryDeploy" ? "重试发布此提交" : "发布此提交";
    document.querySelectorAll("[data-close]").forEach((button) => { button.disabled = state.busy; });
    $("selected-count").textContent = `已选 ${state.selected.size}`;
    const selectable = (state.status?.files || []).filter((file) => !file.blocked);
    $("select-all").checked = selectable.length > 0 && state.selected.size === selectable.length;
    $("select-all").indeterminate = state.selected.size > 0 && state.selected.size < selectable.length;
    $("commit-hint").textContent = ready.mainline ? "当前在主线，请先新建或切换功能分支，再提交和推送。" : ready.staged ? "存在已暂存文件或冲突。请在编辑器或终端确认并处理现有暂存区，再使用选择提交。" : state.selected.size > 200 ? "一次最多提交 200 个文件，请分批选择。" : "仅提交勾选文件；提交保存在服务器工作副本，推送后其他电脑才能拉取。";
    if (state.status) $("working-state").textContent = projectRunning() ? "此项目正在执行任务，完成后可继续操作。" : state.status.clean ? "工作区干净。编辑发生在本机或 Remote SSH 工作副本中。" : "工作区有未提交改动。请先审查提交；平台不会丢弃你的修改。";
    if (state.status && !ready.mainline) setLink("pr", state.status.prUrl); else setLink("pr", "");
  }

  function renderProjects() {
    const list = $("project-list"); list.replaceChildren();
    if (!state.projects.length) list.append(element("p", "尚未添加项目", "muted"));
    for (const item of state.projects) {
      const button = element("button", undefined, `project-button${item.id === state.projectId ? " active" : ""}`);
      button.type = "button"; button.setAttribute("aria-pressed", String(item.id === state.projectId));
      button.append(element("strong", item.name), element("small", safeGithubUrl(item.githubUrl) ? new URL(item.githubUrl).pathname.replace(/^\//, "") : "仓库地址待确认"));
      button.addEventListener("click", () => { if (!state.busy && state.projectId !== item.id) void selectProject(item.id); }); list.append(button);
    }
    $("empty-project").hidden = state.projects.length > 0;
    $("project-workspace").hidden = !state.projectId;
  }

  async function loadProjects() {
    const data = await request("/projects");
    state.projects = Array.isArray(data.projects) ? data.projects : [];
    for (const job of data.jobs || []) mergeJob(job);
    renderProjects();
    const id = state.projects.some((item) => item.id === state.projectId) ? state.projectId : state.projects[0]?.id;
    if (id) await selectProject(id, true);
  }

  function saveDraft() {
    if (state.projectId) state.drafts.set(state.projectId, { message: $("commit-message").value, branch: $("new-branch").value, selected: new Set(state.selected) });
  }

  async function selectProject(id, refresh = false) {
    if (!state.authenticated) return;
    saveDraft();
    const changed = id !== state.projectId;
    state.projectId = id;
    if (changed) {
      const draft = state.drafts.get(id);
      state.selected = new Set(draft?.selected || []); $("commit-message").value = draft?.message || ""; $("new-branch").value = draft?.branch || "";
      state.activeFile = ""; state.selectedJob = ""; state.diffSequence += 1;
      $("diff").textContent = "选择文件查看差异。"; $("diff-name").textContent = "选择文件查看差异";
      message("page-error", ""); message("notice", "");
    }
    if (changed || refresh) { state.status = null; $("git-panels").hidden = true; }
    const selected = project();
    $("project-name").textContent = selected?.name || "未命名项目";
    $("repo-link").textContent = selected?.githubUrl || ""; setLink("repo-link", selected?.githubUrl);
    $("branch-name").textContent = "读取中…"; $("head").textContent = "正在读取服务器工作副本"; $("sync-state").textContent = "—";
    $("status-unavailable").hidden = true; renderProjects(); renderJobs();
    await refreshStatus();
    await loadAudit().catch((error) => { if (state.projectId === id && state.authenticated) $("audit-list").replaceChildren(element("li", `记录读取失败：${error.message}`)); });
    schedulePoll();
  }

  async function refreshStatus() {
    const id = state.projectId, sequence = ++state.loadSequence;
    if (!id) return;
    state.statusLoading = true; updateControls();
    try {
      const status = await request(`/projects/${encodeURIComponent(id)}/status`);
      if (id !== state.projectId || sequence !== state.loadSequence || !state.authenticated) return;
      state.status = status;
      if (status.job) mergeJob(status.job);
      state.selected = reconcileSelection(status.files || [], state.selected);
      $("status-unavailable").hidden = true; $("git-panels").hidden = false;
      renderStatus(); renderFiles(); renderJobs();
    } catch (error) {
      if (id !== state.projectId || sequence !== state.loadSequence || !state.authenticated) return;
      state.status = null; $("git-panels").hidden = true; $("status-unavailable").hidden = false;
      $("branch-name").textContent = "暂不可用"; $("head").textContent = "请查看任务日志或重新读取状态";
      $("status-error").textContent = error.message;
      $("retry-clone").hidden = error.status !== 409;
    } finally { if (sequence === state.loadSequence) { state.statusLoading = false; updateControls(); } }
  }

  function renderStatus() {
    const s = state.status;
    $("branch-name").textContent = s.branch || "未识别分支"; $("head").textContent = s.head ? `提交 ${String(s.head).slice(0, 12)}` : "尚无提交";
    $("sync-state").textContent = s.upstream ? `领先 ${s.ahead ?? "—"} · 落后 ${s.behind ?? "—"}` : "尚无上游分支";
    $("upstream").textContent = s.upstream ? `${s.upstream} · 以最后一次刷新远端为准` : "首次推送功能分支后建立上游关联";
    const select = $("branches"), previous = select.value;
    select.replaceChildren();
    const local = new Set(s.branches || []);
    const localGroup = element("optgroup"); localGroup.label = "本地分支";
    for (const branch of local) { const option = element("option", branch); option.value = branch; localGroup.append(option); }
    if (local.size) select.append(localGroup);
    const remoteGroup = element("optgroup"); remoteGroup.label = "GitHub 远端分支（切换时建立跟踪）";
    for (const branch of s.remoteBranches || []) { if (local.has(branch)) continue; const option = element("option", branch); option.value = branch; remoteGroup.append(option); }
    if (remoteGroup.childElementCount) select.append(remoteGroup);
    const values = [...select.options].map((option) => option.value);
    select.value = values.includes(previous) ? previous : s.branch;
    $("deploy-help").textContent = s.project?.deployEnabled ? "目标由管理员为本仓库预先配置。需干净 main 与 GitHub main 一致；点击后会再次确认项目与提交。" : "本项目尚未配置发布目标。可以正常提交与推送 GitHub；服务器发布请联系管理员配置。";
    updateControls();
  }

  function renderFiles() {
    const files = state.status?.files || [], list = $("file-list"); list.replaceChildren();
    $("file-count").textContent = `${files.length} 个改动文件`;
    if (!files.length) list.append(element("p", "暂无文件改动。在本机提交并推送后，这里拉取；使用 Remote SSH 时，请确认编辑的是此项目工作副本。", "empty"));
    for (const file of files) {
      const row = element("div", undefined, `file-row${state.activeFile === file.name ? " active" : ""}`);
      const checkbox = element("input"); checkbox.type = "checkbox"; checkbox.checked = state.selected.has(file.name); checkbox.dataset.blocked = String(Boolean(file.blocked)); checkbox.setAttribute("aria-label", `选择 ${file.name}`);
      checkbox.addEventListener("change", () => { if (checkbox.checked) state.selected.add(file.name); else state.selected.delete(file.name); updateControls(); });
      const name = element("button", file.name, "file-name"); name.type = "button"; name.disabled = Boolean(file.blocked); name.title = file.original ? `原文件：${file.original}` : file.name;
      name.addEventListener("click", () => void showDiff(file.name));
      row.append(checkbox, element("span", file.code || "?", "file-status"), name);
      if (file.blocked) row.append(element("span", "受保护", "file-blocked"));
      list.append(row);
    }
    if (state.activeFile && !files.some((file) => file.name === state.activeFile && !file.blocked)) { state.activeFile = ""; $("diff-name").textContent = "文件状态已变化"; $("diff").textContent = "请重新选择当前改动文件。"; }
    updateControls();
  }

  async function showDiff(name) {
    const id = state.projectId, sequence = ++state.diffSequence;
    state.activeFile = name; $("diff-name").textContent = name; $("diff").textContent = "正在读取差异…"; renderFiles();
    try {
      const { diff } = await request(`/projects/${encodeURIComponent(id)}/diff?file=${encodeURIComponent(name)}`);
      if (!state.authenticated || id !== state.projectId || sequence !== state.diffSequence) return;
      $("diff").replaceChildren();
      for (const line of String(diff || "此文件没有可显示的文本差异（可能为二进制文件）。").split("\n")) $("diff").append(element("span", `${line}\n`, line.startsWith("+") ? "diff-added" : line.startsWith("-") ? "diff-deleted" : ""));
    } catch (error) { if (state.authenticated && id === state.projectId && sequence === state.diffSequence) $("diff").textContent = `差异读取失败：${error.message}`; }
  }

  function mergeJob(job) {
    if (!job?.id) return;
    const index = state.jobs.findIndex((item) => item.id === job.id);
    if (index < 0) state.jobs.push(job); else state.jobs[index] = job;
  }

  function renderJobs() {
    const jobs = currentJobs(), select = $("jobs");
    if (!jobs.some((job) => job.id === state.selectedJob)) state.selectedJob = jobs[0]?.id || "";
    select.replaceChildren();
    if (!jobs.length) { const option = element("option", "尚无任务"); option.value = ""; select.append(option); }
    for (const job of jobs) { const option = element("option", `${when(job.createdAt)} · ${actionLabels[job.action] || job.action} · ${statusLabels[job.status] || job.status}`); option.value = job.id; select.append(option); }
    select.value = state.selectedJob;
    const job = jobs.find((item) => item.id === state.selectedJob);
    $("job-state").textContent = job ? `${actionLabels[job.action] || job.action} · ${statusLabels[job.status] || job.status}` : "等待操作";
    $("job-state").className = `pill ${job ? `status-${job.status}` : ""}`;
    $("job-log").textContent = job ? (Array.isArray(job.log) ? job.log.join("\n") : String(job.log || "任务已登记，等待执行日志。")) : "本项目暂无执行任务。";
    $("job-result").textContent = job ? deploymentActions.has(job.action) ? deploymentSummary(job) : job.result?.message || (job.status === "interrupted" ? "执行因服务重启中断，请先刷新工作区和 GitHub 状态，再决定下一步。" : "") : "";
    $("deployment-status").textContent = deploymentSummary(jobs.find((item) => deploymentActions.has(item.action)) || (state.status?.lastDeployment ? { status: "succeeded", result: state.status.lastDeployment } : null));
    updateControls();
  }

  async function loadAudit() {
    const id = state.projectId;
    if (!id) return;
    const { entries } = await request(`/projects/${encodeURIComponent(id)}/audit`);
    if (!state.authenticated || id !== state.projectId) return;
    $("audit-list").replaceChildren();
    for (const entry of entries || []) $("audit-list").append(element("li", `${when(entry.createdAt)} · ${actionLabels[entry.action] || entry.action} · ${statusLabels[entry.status] || entry.status}${entry.message ? ` · ${entry.message}` : ""}`));
    if (!entries?.length) $("audit-list").append(element("li", "尚无操作记录。"));
  }

  async function perform(action, extra = {}) {
    const id = state.projectId;
    if (!id) throw new Error("请先选择项目。");
    if (projectRunning()) throw new Error("本项目仍有任务执行中，请等待完成。");
    const { job } = await request(`/projects/${encodeURIComponent(id)}/actions`, { method: "POST", body: { action, ...extra } });
    mergeJob(job); state.selectedJob = job.id; renderJobs();
    message("notice", `已登记“${actionLabels[action]}”任务。完成情况请以下方执行日志为准。`);
    schedulePoll(250);
  }

  function schedulePoll(delay = 1500) {
    clearTimeout(state.pollTimer);
    if (!state.authenticated || !state.jobs.some((job) => job.status === "running")) return;
    state.pollTimer = setTimeout(() => void pollJobs(), delay);
  }

  async function pollJobs() {
    const epoch = state.epoch, running = state.jobs.filter((job) => job.status === "running");
    let finishedCurrent = false, failedRequest = false;
    for (const previous of running) {
      if (!state.authenticated || epoch !== state.epoch) return;
      try {
        const { job } = await request(`/jobs/${encodeURIComponent(previous.id)}`);
        mergeJob(job);
        if (job.projectId === state.projectId && job.status !== "running") {
          finishedCurrent = true;
          if (job.status === "succeeded") {
            if (job.action === "commit") { $("commit-message").value = ""; state.selected.clear(); }
            if (job.action === "branch") $("new-branch").value = "";
            message("notice", deploymentActions.has(job.action) ? deploymentSummary(job) : job.result?.message || `${actionLabels[job.action]}已完成。`);
          } else message("page-error", `${actionLabels[job.action] || job.action}${statusLabels[job.status] || "未完成"}，请查看执行日志。`);
        }
      } catch (error) {
        failedRequest = true;
        if (state.authenticated && previous.projectId === state.projectId) message("page-error", `任务状态读取失败：${error.message} 页面将继续核对，请勿重复提交。`);
      }
    }
    if (!state.authenticated || epoch !== state.epoch) return;
    renderJobs();
    if (finishedCurrent) { await refreshStatus(); await loadAudit().catch(() => undefined); }
    schedulePoll(failedRequest ? 6000 : 1500);
  }

  function showAdd() { message("add-error", ""); $("add-dialog").showModal(); }
  $("add-project").addEventListener("click", showAdd); $("empty-add").addEventListener("click", showAdd);
  $("reload-projects").addEventListener("click", () => void runUi(loadProjects));
  for (const dialog of document.querySelectorAll("dialog")) dialog.addEventListener("cancel", (event) => { if (state.busy) event.preventDefault(); });
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => { if (!state.busy) $(button.dataset.close).close(); }));
  $("login-form").addEventListener("submit", (event) => { event.preventDefault(); void runUi(async () => {
    const session = await request("/auth/login", { method: "POST", body: { username: $("username").value.trim(), password: $("password").value } });
    if (!session.authenticated || !session.csrfToken) throw new Error("登录响应不完整，请联系管理员。");
    await authenticated(session);
  }, "login-error"); });
  $("logout").addEventListener("click", () => void runUi(async () => { await request("/auth/logout", { method: "POST", body: {} }); showLogin(); }));
  $("add-form").addEventListener("submit", (event) => { event.preventDefault(); void runUi(async () => {
    const githubUrl = safeGithubUrl($("github-url").value.trim());
    if (!githubUrl || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(new URL(githubUrl).pathname) || new URL(githubUrl).search || new URL(githubUrl).hash) throw new Error("请输入完整 GitHub 仓库 HTTPS 地址，不含登录信息、查询参数或页面路径。");
    const name = $("add-name").value.trim(); if (!name) throw new Error("请填写便于识别的项目名称。");
    const data = await request("/projects", { method: "POST", body: { name, githubUrl } });
    state.projects.push(data.project); mergeJob(data.job); $("add-dialog").close(); $("add-form").reset();
    await selectProject(data.project.id); state.selectedJob = data.job.id; renderJobs(); schedulePoll(250);
    message("notice", "项目已添加，正在服务器克隆。请查看任务日志。");
  }, "add-error"); });
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => void runUi(() => perform(button.dataset.action))));
  $("retry-clone").addEventListener("click", () => void runUi(() => perform("clone")));
  $("refresh").addEventListener("click", () => void runUi(() => selectProject(state.projectId, true)));
  $("retry-status").addEventListener("click", () => void runUi(() => selectProject(state.projectId, true)));
  $("branch-form").addEventListener("submit", (event) => { event.preventDefault(); void runUi(() => perform("branch", { branch: $("new-branch").value.trim() })); });
  $("switch").addEventListener("click", () => void runUi(() => perform("switch", { branch: $("branches").value })));
  $("commit-message").addEventListener("input", updateControls);
  $("commit-form").addEventListener("submit", (event) => { event.preventDefault(); void runUi(async () => {
    if (!actionReadiness(state.status, projectRunning()).commit || !state.selected.size || state.selected.size > 200) throw new Error("请在功能分支选择 1–200 个可提交文件，并先处理已有暂存区或冲突。");
    await perform("commit", { files: [...state.selected], message: $("commit-message").value.trim() });
  }); });
  $("select-all").addEventListener("change", () => { state.selected = $("select-all").checked ? new Set((state.status?.files || []).filter((file) => !file.blocked).map((file) => file.name)) : new Set(); renderFiles(); });
  $("jobs").addEventListener("change", () => { state.selectedJob = $("jobs").value; renderJobs(); });
  $("refresh-log").addEventListener("click", () => void runUi(async () => { await loadProjects(); if (state.selectedJob) { const { job } = await request(`/jobs/${encodeURIComponent(state.selectedJob)}`); mergeJob(job); renderJobs(); } await loadAudit(); schedulePoll(); }));
  async function openDeployment(action) {
    await refreshStatus();
    if (!actionReadiness(state.status, projectRunning())[action]) throw new Error(action === "retryDeploy" ? "重试条件已变化。只有此前已接收但尚未核验的同一提交可重试，请刷新发布记录。" : "发布条件已变化。请确认工作区干净，当前 main 与刷新后的 GitHub main 完全一致。");
    const s = state.status;
    state.deploymentSnapshot = { id: state.projectId, name: project().name, head: s.head, action };
    $("confirm-project").textContent = project().name; $("confirm-repo").textContent = project().githubUrl; $("confirm-head").textContent = s.head || "未知提交";
    $("deploy-title").textContent = action === "retryDeploy" ? "确认重试同一版本发布" : "确认发布服务器项目";
    $("deploy-description").textContent = action === "retryDeploy" ? "此前服务器已接收此提交，但线上版本尚未核验。此次将明确触发同一提交的发布重试，不改变发布版本。请先确认日志中失败的原因已处理。" : "此次操作会将已合并的 main 推送到管理员为本仓库配置的发布目标。";
    $("confirm-name").value = ""; message("deploy-error", ""); $("deploy-dialog").showModal();
  }
  $("deploy").addEventListener("click", () => void runUi(() => openDeployment("deploy")));
  $("retry-deploy").addEventListener("click", () => void runUi(() => openDeployment("retryDeploy")));
  $("confirm-name").addEventListener("input", updateControls);
  $("deploy-form").addEventListener("submit", (event) => { event.preventDefault(); void runUi(async () => {
    const confirmed = state.deploymentSnapshot;
    if (!confirmed || confirmed.id !== state.projectId || $("confirm-name").value !== confirmed.name) throw new Error("项目确认信息不一致，请重新打开发布确认。");
    await refreshStatus();
    if (state.status?.head !== confirmed.head || !actionReadiness(state.status, projectRunning())[confirmed.action]) throw new Error("提交或工作区状态已改变，请取消后重新确认发布版本。");
    await perform(confirmed.action, { expectedCommit: confirmed.head }); $("deploy-dialog").close();
  }, "deploy-error"); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) schedulePoll(250); });
  void request("/auth/session").then((session) => session.authenticated ? authenticated(session) : showLogin()).catch((error) => { if (state.authenticated) message("page-error", `项目加载失败：${error.message} 请刷新页面重试。`); else showLogin(`暂时无法检查登录状态：${error.message}`); });
}
