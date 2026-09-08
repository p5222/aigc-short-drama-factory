const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="workbench-token"]').content;
let state = {}, selected = new Set(), timer;
async function api(url, body) {
  const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'X-Workbench-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作失败');
  return result;
}
function toast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(timer); timer = setTimeout(() => $('toast').classList.remove('visible'), 6500); }
function busy(value) { document.querySelectorAll('button:not(.file-name)').forEach(button => button.disabled = value); $('job-state').textContent = value ? '执行中…' : '就绪'; }
function render() {
  $('project-name').textContent = state.repo ? state.repo.split(/[\\/]/).pop() : '尚未连接';
  $('repo-path').textContent = state.repo || '打开项目后显示文件路径';
  $('branch-name').textContent = state.branch || '—';
  $('head').textContent = state.head ? '最近提交 ' + state.head : '功能独立，主线稳定';
  const counts = (state.counts || '').split(/\s+/);
  $('sync-state').textContent = state.counts ? '领先 ' + counts[0] + ' / 落后 ' + counts[1] : '尚无上游分支';
  $('connection-label').textContent = state.repo ? '已连接 · 本机 Git' : '从已有文件夹或 GitHub 开始';
  if (state.repo) $('project-path').value = state.repo;
  $('branches').replaceChildren(...(state.branches || []).map(name => { const option = document.createElement('option'); option.textContent = name; option.value = name; option.selected = name === state.branch; return option; }));
  const files = state.files || [];
  selected = new Set([...selected].filter(name => files.some(file => file.name === name && !file.blocked)));
  $('file-count').textContent = files.length + ' 个文件'; $('selected-count').textContent = selected.size;
  $('file-list').replaceChildren();
  if (!files.length) {
    const empty = document.createElement('div'); empty.className = 'empty';
    const title = document.createElement('h3'); title.textContent = state.repo ? '工作区很干净' : '先连接一个项目';
    const desc = document.createElement('p'); desc.textContent = state.repo ? '去编辑器完成修改，再回来刷新。' : '改动文件与差异会显示在这里。';
    empty.append(title, desc); $('file-list').append(empty);
  }
  for (const file of files) {
    const row = document.createElement('div'); row.className = 'file-row';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.disabled = file.blocked; checkbox.checked = selected.has(file.name); checkbox.setAttribute('aria-label', '提交 ' + file.name);
    checkbox.onchange = () => { checkbox.checked ? selected.add(file.name) : selected.delete(file.name); $('selected-count').textContent = selected.size; };
    const badge = document.createElement('span'); badge.className = 'file-status'; badge.textContent = file.code.trim();
    const button = document.createElement('button'); button.className = 'file-name'; button.textContent = file.name; button.disabled = file.blocked; button.title = file.blocked ? '环境配置或密钥文件不会在工具中提交' : file.name;
    button.onclick = async () => { try { const result = await api('/api/diff?file=' + encodeURIComponent(file.name)); $('diff-name').textContent = file.name; $('diff').textContent = result.diff; } catch (error) { toast(error.message); } };
    row.append(checkbox, badge, button); if (file.blocked) { const lock = document.createElement('span'); lock.textContent = '已保护'; row.append(lock); } $('file-list').append(row);
  }
  const pr = $('pr');
  if (state.github && state.branch) { pr.href = state.github + '/compare/' + encodeURIComponent(state.branch) + '?expand=1'; pr.setAttribute('aria-disabled', 'false'); }
  else { pr.removeAttribute('href'); pr.setAttribute('aria-disabled', 'true'); }
  if (state.job) { $('log').textContent = state.job.log || '操作正在执行…'; $('job-state').textContent = state.job.status === 'running' ? '执行中…' : state.job.status === 'done' ? '已完成' : '需要处理'; }
}
async function refresh() { state = await api('/api/state'); render(); }
async function action(body) {
  busy(true);
  try {
    await api('/api/action', body);
    while (true) {
      const { job } = await api('/api/job'); $('log').textContent = job.log || '操作正在执行…';
      if (job.status !== 'running') { toast(job.status === 'done' ? '操作完成' : '操作未完成，请查看记录'); break; }
      await new Promise(resolve => setTimeout(resolve, 900));
    }
    await refresh();
  } catch (error) { toast(error.message); }
  finally { busy(false); if (state.job) $('job-state').textContent = state.job.status === 'done' ? '已完成' : state.job.status === 'failed' ? '需要处理' : '就绪'; }
}
$('open').onclick = () => action({ action: 'open', path: $('project-path').value.trim() });
$('clone').onclick = () => action({ action: 'clone', path: $('project-path').value.trim(), url: $('clone-url').value.trim() });
$('branch').onclick = () => action({ action: 'branch', branch: $('new-branch').value.trim() });
$('switch').onclick = () => action({ action: 'switch', branch: $('branches').value });
$('commit').onclick = () => action({ action: 'commit', files: [...selected], message: $('message').value });
$('refresh').onclick = () => refresh().catch(error => toast(error.message));
document.querySelectorAll('[data-action]').forEach(button => button.onclick = () => action({ action: button.dataset.action }));
refresh().catch(error => toast(error.message));
