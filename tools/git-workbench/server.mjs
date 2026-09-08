import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const home = path.dirname(fileURLToPath(import.meta.url));
const token = randomBytes(32).toString('hex');
const port = Number(process.env.PORT || 4318);
let repo = '', job = null;
const scrub = text => String(text).replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[redacted]@').replace(/(?:gh[pousr]_[\w]{20,}|github_pat_[\w]{20,}|sk-[\w-]{24,})/g, '[redacted]');
const protectedPath = name => /(^|\/)(\.git|\.ssh|node_modules|storage|backups)(\/|$)|(^|\/)\.env(?!\.(?:example|production\.example)$)|\.(pem|p12|pfx|key|local\.txt)$|(^|\/)(id_rsa|id_ed25519|manjiao_git|manjiao_tencent)$/.test(name.replaceAll('\\', '/'));
const knownSecret = data => /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)/.test(data);
function run(command, args, cwd = repo || home, log = false) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_LITERAL_PATHSPECS: '1' };
    const child = spawn(command, args, { cwd, env, windowsHide: true, shell: false });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('操作超时；请检查网络或在终端完成登录。')); }, 600000);
    child.stdout.on('data', chunk => { out += chunk; if (log && job) job.log = scrub((job.log + chunk).slice(-60000)); });
    child.stderr.on('data', chunk => { err += chunk; if (log && job) job.log = scrub((job.log + chunk).slice(-60000)); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code !== 0 ? reject(new Error(scrub(err || out || command + ' 退出码 ' + code))) : resolve(out); });
  });
}
const git = (...args) => run('git', args);
async function openRepo(candidate) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) throw new Error('请输入项目文件夹的绝对路径。');
  const folder = await realpath(candidate);
  const root = (await run('git', ['rev-parse', '--show-toplevel'], folder)).trim();
  repo = await realpath(root);
}
async function changedFiles() {
  const entries = (await git('status', '--porcelain=v1', '-z', '--untracked-files=all')).split('\0'), files = [];
  for (let i = 0; i < entries.length; i++) {
    if (!entries[i]) continue;
    const code = entries[i].slice(0, 2), name = entries[i].slice(3);
    const original = /[RC]/.test(code) ? entries[++i] : undefined;
    files.push({ code, name, original, blocked: protectedPath(name) || Boolean(original && protectedPath(original)) });
  }
  return files;
}
function githubURL(remote) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(remote);
  return match ? 'https://github.com/' + match[1] : '';
}
async function getState() {
  if (!repo) return { repo, job };
  const branch = (await git('branch', '--show-current')).trim(), files = await changedFiles();
  const branches = (await git('for-each-ref', '--format=%(refname:short)', 'refs/heads')).trim().split('\n').filter(Boolean);
  let remote = '', counts = '', head = '';
  try { remote = (await git('config', '--get', 'remote.origin.url')).trim(); } catch {}
  try { counts = (await git('rev-list', '--left-right', '--count', 'HEAD...@{upstream}')).trim(); } catch {}
  try { head = (await git('rev-parse', '--short', 'HEAD')).trim(); } catch {}
  return { repo, branch, branches, files, remote: scrub(remote), github: githubURL(remote), counts, head, job };
}
async function githubOrigin() {
  if (!githubURL((await git('config', '--get', 'remote.origin.url')).trim())) throw new Error('此版本仅操作 github.com 的 HTTPS / SSH origin 仓库。');
}
async function clean() {
  if ((await changedFiles()).length) throw new Error('当前还有改动，请先提交或在编辑器中处理后再切换 / 拉取。工具不会自动丢弃文件。');
}
async function featureBranch() {
  const branch = (await git('branch', '--show-current')).trim();
  if (!branch || /^(main|master)$/.test(branch)) throw new Error('请先创建或切换到功能分支；主分支通过 PR 合并。');
  return branch;
}
async function fileContent(name) {
  const destination = path.resolve(repo, name);
  if (!destination.startsWith(repo + path.sep)) throw new Error('文件不在项目内。');
  let stat;
  try { stat = await lstat(destination); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('此版本不直接预览或提交符号链接。');
  if (!(await realpath(destination)).startsWith(repo + path.sep)) throw new Error('文件路径指向项目外。');
  if (stat.size > 5 * 1024 * 1024) throw new Error('文件超过 5 MB，请在 Git 客户端审查后提交。');
  const data = await readFile(destination);
  if (knownSecret(data.toString('utf8'))) throw new Error('文件疑似包含凭据，请先移到本地环境配置。');
  return data.includes(0) ? '[二进制文件，无法显示文本预览]' : data.toString('utf8');
}
async function act(body) {
  const { action } = body;
  if (action === 'open') { await openRepo(body.path); return '已打开项目。'; }
  if (action === 'clone') {
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(body.url || '')) throw new Error('请输入 GitHub HTTPS 仓库地址，不要在 URL 中放令牌。');
    if (typeof body.path !== 'string' || !path.isAbsolute(body.path)) throw new Error('请输入新文件夹的绝对路径。');
    await run('git', ['clone', '--progress', '--', body.url, body.path], home, true);
    await openRepo(body.path); return '克隆完成。';
  }
  if (!repo) throw new Error('请先打开或克隆一个项目。');
  if (action === 'fetch') { await githubOrigin(); await run('git', ['fetch', 'origin'], repo, true); return '已刷新 GitHub 远端分支。'; }
  if (action === 'pull') {
    await clean(); await githubOrigin();
    const branch = (await git('branch', '--show-current')).trim();
    if (!branch) throw new Error('请先切换到命名分支。');
    await run('git', ['pull', '--ff-only', 'origin', branch], repo, true); return '已拉取当前分支。';
  }
  if (action === 'branch') {
    await clean();
    const name = body.branch;
    if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9/_.-]{0,100}$/.test(name) || /^(main|master)$/.test(name)) throw new Error('请输入功能分支名，例如 codex/login-page。');
    await git('check-ref-format', '--branch', name); await git('switch', '-c', name);
    return '已基于当前提交创建 ' + name;
  }
  if (action === 'switch') {
    await clean();
    const branches = (await git('for-each-ref', '--format=%(refname:short)', 'refs/heads')).trim().split('\n');
    if (!branches.includes(body.branch)) throw new Error('请选择已有本地分支。');
    await git('switch', body.branch); return '分支已切换。';
  }
  if (action === 'commit') {
    await featureBranch();
    const files = await changedFiles();
    if (files.some(file => file.code[0] !== ' ' && file.code !== '??')) throw new Error('检测到已有暂存或冲突，请先在 Git 客户端处理。');
    const selected = body.files, message = body.message;
    if (!Array.isArray(selected) || !selected.length || selected.length > 200 || new Set(selected).size !== selected.length) throw new Error('请选择 1–200 个文件。');
    if (typeof message !== 'string' || !message.trim() || message.length > 1000) throw new Error('请填写 1–1000 字的提交说明。');
    for (const name of selected) {
      const file = files.find(file => file.name === name);
      if (!file || file.blocked) throw new Error('文件已变化或属于环境配置 / 密钥目录，请刷新并重新选择。');
      await fileContent(name);
    }
    await git('add', '--', ...selected);
    const staged = (await git('diff', '--cached', '--name-only', '-z')).split('\0').filter(Boolean);
    if (staged.some(name => !selected.includes(name))) throw new Error('暂存区出现其他文件，请在 Git 客户端检查。');
    await run('git', ['commit', '-m', message.trim()], repo, true); return '本地提交完成，可以推送到 GitHub。';
  }
  if (action === 'push') {
    const branch = await featureBranch(); await githubOrigin();
    await run('git', ['push', '-u', 'origin', 'HEAD:refs/heads/' + branch], repo, true); return '已推送当前分支，可以打开 PR 页面。';
  }
  throw new Error('不支持的操作。');
}
function reply(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
async function bodyJSON(req) {
  let data = '';
  for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 64000) throw new Error('请求过大。'); }
  return JSON.parse(data);
}
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const origin = 'http://127.0.0.1:' + port;
  if (req.headers.host !== '127.0.0.1:' + port) return reply(res, 403, { error: '仅允许本机地址访问。' });
  try {
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/api/')) {
      const supplied = Buffer.from(String(req.headers['x-workbench-token'] || ''));
      if (supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) return reply(res, 403, { error: '请刷新本机工作台。' });
      if (req.headers.origin && req.headers.origin !== origin) return reply(res, 403, { error: '拒绝跨站请求。' });
      if (req.method === 'GET' && url.pathname === '/api/job') return reply(res, 200, { job });
      if (req.method === 'GET' && url.pathname === '/api/state') return reply(res, 200, await getState());
      if (req.method === 'GET' && url.pathname === '/api/diff') {
        if (job?.status === 'running') throw new Error('操作进行中，请稍后预览。');
        const name = url.searchParams.get('file'), file = (await changedFiles()).find(item => item.name === name);
        if (!file || file.blocked) throw new Error('文件不在可预览的改动列表中。');
        const content = await fileContent(name);
        const diff = file.code === '??' ? content : await git('diff', 'HEAD', '--', name);
        if (knownSecret(diff)) throw new Error('差异疑似包含凭据，已隐藏。');
        return reply(res, 200, { diff: scrub(diff.slice(0, 120000)) || '没有文本差异。' });
      }
      if (req.method === 'POST' && url.pathname === '/api/action') {
        if (req.headers['content-type'] !== 'application/json') return reply(res, 415, { error: '需要 JSON。' });
        if (job?.status === 'running') return reply(res, 409, { error: '上一项操作仍在执行。' });
        const body = await bodyJSON(req);
        if (job?.status === 'running') return reply(res, 409, { error: '上一项操作仍在执行。' });
        job = { id: randomBytes(8).toString('hex'), action: body.action, status: 'running', log: '' };
        reply(res, 202, { job });
        act(body).then(message => { job.status = 'done'; job.log += '\n' + message; }).catch(error => { job.status = 'failed'; job.log += '\n' + scrub(error.message); });
        return;
      }
      return reply(res, 404, { error: '接口不存在。' });
    }
    const routes = { '/manual': ['handbook.html', 'text/html; charset=utf-8'], '/handbook.css': ['handbook.css', 'text/css; charset=utf-8'], '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
    if (req.method !== 'GET' || !routes[url.pathname]) return reply(res, 404, { error: '页面不存在。' });
    const [file, type] = routes[url.pathname], data = (await readFile(path.join(home, 'public', file), 'utf8')).replace('__WORKBENCH_TOKEN__', token);
    res.writeHead(200, { 'Content-Type': type }); res.end(data);
  } catch (error) { reply(res, 400, { error: scrub(error.message) }); }
});
if (process.argv[2]) { try { await openRepo(path.resolve(process.argv[2])); } catch (error) { console.error(scrub(error.message)); } }
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? '端口已使用，请打开已有工作台或设置 PORT。' : error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log('Git Workbench: http://127.0.0.1:' + port + '\n只在本机运行。按 Ctrl+C 停止。'));
