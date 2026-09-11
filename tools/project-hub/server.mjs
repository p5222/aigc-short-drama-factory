import http from 'node:http';
import { isIP } from 'node:net';
import { readFile, writeFile, rename, mkdir, open, chmod } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth } from './auth.mjs';
import { createGitOperations, normalizeGithubUrl, scrub } from './gitOperations.mjs';

const home = path.dirname(fileURLToPath(import.meta.url));
const actions = new Set(['clone', 'fetch', 'pull', 'branch', 'switch', 'commit', 'push', 'deploy', 'retryDeploy', 'verify']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function failure(message, status = 400) { return Object.assign(new Error(message), { status }); }
export function validateConfig(input) {
  const config = { ...input };
  config.trustedProxyAddresses = config.trustedProxyAddresses || [];
  if (!Array.isArray(config.trustedProxyAddresses) || config.trustedProxyAddresses.length > 8 || config.trustedProxyAddresses.some(value => typeof value !== 'string' || !isIP(value))) throw new Error('trustedProxyAddresses 仅接受明确的代理 IPv4/IPv6 地址。');
  const origin = new URL(config.publicOrigin);
  if (origin.origin !== config.publicOrigin || origin.username || origin.password || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) throw new Error('publicOrigin 必须为 HTTPS 站点或本机 HTTP 地址。');
  if (process.env.NODE_ENV === 'production' && origin.protocol !== 'https:') throw new Error('生产环境必须使用 HTTPS。');
  if (typeof config.username !== 'string' || !/^[A-Za-z0-9_.@-]{1,100}$/.test(config.username)) throw new Error('管理员账号配置无效。');
  if (!path.isAbsolute(config.workspaceRoot || '') || !path.isAbsolute(config.dataDir || '') || path.resolve(config.workspaceRoot) === path.resolve(config.dataDir)) throw new Error('workspaceRoot 和 dataDir 必须是不同的绝对目录。');
  if (!config.gitIdentity || typeof config.gitIdentity.name !== 'string' || !config.gitIdentity.name.trim() || /[\r\n\0]/.test(config.gitIdentity.name) || config.gitIdentity.name.length > 100 || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(config.gitIdentity.email || '')) throw new Error('Git 作者身份配置无效。');
  config.deployments = (config.deployments || []).map(value => {
    const item = { ...value, githubUrl: normalizeGithubUrl(value.githubUrl) };
    const remote = new URL(item.remote);
    if (remote.protocol !== 'ssh:' || remote.password || !remote.hostname || /[\s\0]/.test(item.remote) || !remote.pathname || remote.search || remote.hash) throw new Error('发布 remote 必须是私有配置内的 SSH Git URL。');
    if (item.verifyUrl) { const verify = new URL(item.verifyUrl); if (verify.protocol !== 'https:' || verify.username || verify.password || verify.hash) throw new Error('发布验证地址必须是固定 HTTPS URL。'); }
    return item;
  });
  return config;
}

async function createStore(config) {
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  await chmod(config.dataDir, 0o700).catch(() => {});
  const filename = path.join(config.dataDir, 'registry.json');
  let state;
  try { state = JSON.parse(await readFile(filename, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('项目登记文件无法读取，请检查服务数据。'); state = { version: 1, projects: [], jobs: [], audit: [] }; }
  if (state.version !== 1 || !Array.isArray(state.projects) || !Array.isArray(state.jobs) || !Array.isArray(state.audit)) throw new Error('项目登记文件格式错误。');
  for (const project of state.projects) { if (!uuid.test(project.id)) throw new Error('项目登记标识无效。'); project.githubUrl = normalizeGithubUrl(project.githubUrl); }
  let tail = Promise.resolve();
  function save() {
    const operation = tail.then(async () => {
      const temporary = `${filename}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
      const handle = await open(temporary, 'r+'); try { await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, filename);
    });
    tail = operation.catch(() => {}); return operation;
  }
  let recovered = false;
  for (const item of [...state.jobs, ...state.audit]) if (item.status === 'running') { item.status = 'interrupted'; item.finishedAt = new Date().toISOString(); item.message = '服务已重启，请先检查项目状态再继续。'; if ('log' in item) item.log = item.message; recovered = true; }
  if (recovered) await save();
  return { state, save, flush: () => tail };
}
function reply(res, status, data) { if (res.writableEnded) return; res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
async function readJSON(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) throw failure('请求需要 JSON 格式。', 415);
  let data = '';
  for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 64000) throw failure('请求过大。', 413); }
  try { const result = JSON.parse(data); if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(); return result; } catch { throw failure('JSON 请求无效。'); }
}
export async function createHubServer(rawConfig, dependencies = {}) {
  const config = validateConfig(rawConfig), auth = createAuth(config), store = await createStore(config);
  const git = createGitOperations(config, dependencies.git || {}), locks = new Map(), pending = new Set();
  const publicJob = job => job && ({ ...job, status: job.status !== 'interrupted' && locks.get(job.projectId) === job.id ? 'running' : job.status });
  const publicProject = project => ({ id: project.id, name: project.name, githubUrl: project.githubUrl, createdAt: project.createdAt, deployEnabled: Boolean(git.deployment(project)) });
  const find = id => { const project = store.state.projects.find(item => item.id === id); if (!project) throw failure('项目不存在。', 404); return project; };
  const sanitize = value => git.cleanup(scrub(value));
  async function enqueue(project, input) {
    if (!actions.has(input.action)) throw failure('不支持的操作。');
    if (locks.has(project.id)) throw failure('此项目上一项操作仍在进行。', 409);
    const job = { id: randomUUID(), projectId: project.id, action: input.action, status: 'running', createdAt: new Date().toISOString(), log: '' };
    const audit = { id: job.id, projectId: project.id, action: input.action, status: 'running', createdAt: job.createdAt };
    locks.set(project.id, job.id); store.state.jobs.push(job); store.state.audit.push(audit);
    try { await store.save(); } catch { locks.delete(project.id); store.state.jobs = store.state.jobs.filter(item => item.id !== job.id); store.state.audit = store.state.audit.filter(item => item.id !== job.id); throw failure('操作审计无法持久化，本次操作未执行。', 503); }
    const task = (async () => {
      try {
        job.result = await git.action(project, input, text => { job.log = sanitize((job.log + '\n' + text).slice(-60000)); }, project.lastDeployment);
        if (job.result?.deployment) project.lastDeployment = job.result;
        job.status = 'succeeded'; audit.status = 'succeeded'; audit.message = sanitize(job.result?.message || '操作完成。');
      } catch (error) { job.status = 'failed'; audit.status = 'failed'; audit.message = sanitize(error.message); job.log = sanitize((job.log + '\n' + error.message).slice(-60000)); }
      job.finishedAt = new Date().toISOString(); audit.finishedAt = job.finishedAt;
      try { await store.save(); } catch { job.status = 'interrupted'; job.log = '操作结果无法持久化，请核对 Git 状态；此项目已锁定，请恢复数据存储后重启服务。'; return; }
      locks.delete(project.id);
    })();
    pending.add(task); void task.finally(() => pending.delete(task));
    return job;
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; connect-src 'self'");
    try {
      const url = new URL(req.url, config.publicOrigin);
      if (url.pathname === '/ops') { res.writeHead(308, { Location: '/ops/' }); res.end(); return; }
      if (url.pathname.startsWith('/ops/api/')) {
        const route = url.pathname.slice('/ops/api'.length), session = auth.getSession(req);
        if (req.method === 'POST') auth.requireOrigin(req);
        if (req.method === 'GET' && route === '/auth/session') return reply(res, 200, session ? { authenticated: true, username: session.username, csrfToken: session.csrfToken } : { authenticated: false });
        if (req.method === 'POST' && route === '/auth/login') return reply(res, 200, await auth.login(req, res, await readJSON(req)));
        if (!session) throw failure('请先登录项目工作台。', 401);
        if (req.method === 'POST') auth.requireCsrf(req, session);
        if (req.method === 'POST' && route === '/auth/logout') { await readJSON(req); return reply(res, 200, auth.logout(req, res)); }
        if (req.method === 'GET' && route === '/projects') return reply(res, 200, { projects: store.state.projects.map(publicProject), jobs: store.state.jobs.slice(-30).reverse().map(publicJob) });
        if (req.method === 'POST' && route === '/projects') {
          const input = await readJSON(req);
          if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80 || /[\r\n\0]/.test(input.name)) throw failure('项目名称需为 1–80 字符。');
          const project = { id: randomUUID(), name: input.name.trim(), githubUrl: normalizeGithubUrl(input.githubUrl), createdAt: new Date().toISOString() };
          store.state.projects.push(project);
          try { const job = await enqueue(project, { action: 'clone' }); return reply(res, 202, { project: publicProject(project), job: publicJob(job) }); }
          catch (error) { store.state.projects = store.state.projects.filter(item => item.id !== project.id); throw error; }
        }
        const projectMatch = /^\/projects\/([0-9a-f-]+)\/(status|diff|actions|audit)$/.exec(route);
        if (projectMatch) {
          const project = find(projectMatch[1]), operation = projectMatch[2];
          if (req.method === 'GET' && operation === 'audit') return reply(res, 200, { entries: store.state.audit.filter(item => item.projectId === project.id).slice(-100).reverse() });
          if (req.method === 'GET' && operation === 'status') {
            if (locks.has(project.id)) throw failure('项目操作进行中，请稍后刷新状态。', 409);
            return reply(res, 200, { project: publicProject(project), ...await git.status(project), job: publicJob(store.state.jobs.findLast(item => item.projectId === project.id)) || null });
          }
          if (req.method === 'GET' && operation === 'diff') { if (locks.has(project.id)) throw failure('项目操作进行中，请稍后预览。', 409); return reply(res, 200, await git.diff(project, url.searchParams.get('file'))); }
          if (req.method === 'POST' && operation === 'actions') return reply(res, 202, { job: publicJob(await enqueue(project, await readJSON(req))) });
        }
        const jobMatch = /^\/jobs\/([0-9a-f-]+)$/.exec(route);
        if (req.method === 'GET' && jobMatch) { const job = store.state.jobs.find(item => item.id === jobMatch[1]); if (!job) throw failure('任务不存在。', 404); return reply(res, 200, { job: publicJob(job) }); }
        throw failure('接口不存在。', 404);
      }
      const routes = { '/ops/': ['index.html', 'text/html; charset=utf-8'], '/ops/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/ops/style.css': ['style.css', 'text/css; charset=utf-8'], '/ops/manual': ['handbook.html', 'text/html; charset=utf-8'], '/ops/handbook.html': ['handbook.html', 'text/html; charset=utf-8'] };
      if (req.method !== 'GET' || !routes[url.pathname]) throw failure('页面不存在。', 404);
      const [file, type] = routes[url.pathname], data = await readFile(path.join(home, 'public', file));
      res.writeHead(200, { 'Content-Type': type }); res.end(data);
    } catch (error) { reply(res, error.status || 400, { error: sanitize(error.code === 'ENOENT' ? '资源暂不可用。' : error.message) }); }
  });
  server.requestTimeout = 20000; server.headersTimeout = 15000;
  return { server, config, async drain() { await Promise.allSettled([...pending]); await store.flush(); }, close() { return new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = JSON.parse(await readFile(process.env.PROJECT_HUB_CONFIG_FILE || '/config/config.json', 'utf8'));
    const hub = await createHubServer(config), port = Number(process.env.PORT || 4319), bind = process.env.BIND_HOST || '127.0.0.1';
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口配置无效。');
    hub.server.on('error', () => { console.error('Project Hub 服务无法监听，请检查端口配置。'); process.exitCode = 1; });
    hub.server.listen(port, bind, () => console.log('Project Hub 已启动。'));
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { const timer = setTimeout(() => process.exit(1), 15000); timer.unref(); await hub.close(); await hub.drain(); process.exit(0); });
  } catch { console.error('Project Hub 无法启动，请检查私有配置及数据目录权限。'); process.exitCode = 1; }
}
