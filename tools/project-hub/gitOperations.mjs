import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, lstat, realpath, mkdir } from 'node:fs/promises';
import path from 'node:path';

export const protectedPath = name => /(^|\/)(\.git|\.ssh|node_modules|storage|backups)(\/|$)|(^|\/)(\.npmrc|\.netrc|\.git-credentials)$|(^|\/)\.env(?!\.(?:example|production\.example)$)|\.(pem|p12|pfx|key|local\.txt)$|(^|\/)(id_rsa|id_ed25519|manjiao_git|manjiao_tencent)$/i.test(String(name).replaceAll('\\', '/'));
export const knownSecret = data => /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)/.test(data);
export function scrub(value, secrets = [], roots = []) {
  let result = String(value || '');
  for (const secret of secrets) if (secret) result = result.split(secret).join('[redacted]');
  for (const root of roots) if (root) { result = result.split(root).join('[workspace]'); result = result.split(root.replaceAll('\\', '/')).join('[workspace]'); }
  return result.replace(/(?:gh[pousr]_[\w]{20,}|github_pat_[\w]{20,}|sk-[\w-]{24,})/g, '[redacted]').replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/g, '$1[redacted]@').replace(/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----[\s\S]*?(?:-----END [^-]+-----|$)/g, '[redacted private key]');
}
export function normalizeGithubUrl(input) {
  if (typeof input !== 'string' || !/^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(input)) throw new Error('仅支持不含凭据的 github.com HTTPS 仓库地址。');
  const parsed = new URL(input), parts = parsed.pathname.split('/').filter(Boolean);
  const repo = parts[1].replace(/\.git$/, '');
  if (!repo || repo === '.' || repo === '..') throw new Error('仓库地址无效。');
  return `https://github.com/${parts[0]}/${repo}`;
}
export function createGitOperations(config, dependencies = {}) {
  const root = path.resolve(config.workspaceRoot);
  const cleanup = value => scrub(value, [], [root, config.dataDir]);
  const err = (message, status = 400) => Object.assign(new Error(message), { status });
  const gitOptions = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false', '-c', 'protocol.file.allow=never', '-c', 'protocol.ext.allow=never', '-c', 'credential.helper=', '-c', 'credential.https://github.com.helper=!gh auth git-credential'];
  async function execute(args, cwd, { network = false, log = () => {} } = {}) {
    if (dependencies.runGit) return dependencies.runGit(args, cwd, { network, log });
    let token = '';
    if (network && process.env.PROJECT_HUB_GITHUB_TOKEN_FILE) {
      try { token = (await readFile(process.env.PROJECT_HUB_GITHUB_TOKEN_FILE, 'utf8')).trim(); }
      catch { throw err('GitHub 凭据暂不可读，请联系工作台管理员检查服务挂载。'); }
      if (!token) throw err('GitHub 凭据为空，请联系工作台管理员检查配置。');
    }
    const sanitize = value => scrub(value, [token], [root, config.dataDir]);
    const env = {};
    for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'LANG', 'LC_ALL']) if (process.env[key]) env[key] = process.env[key];
    Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_LITERAL_PATHSPECS: '1', GH_PROMPT_DISABLED: '1' });
    if (token) env.GH_TOKEN = token;
    if (process.env.PROJECT_HUB_SSH_CONFIG_FILE) {
      const file = process.env.PROJECT_HUB_SSH_CONFIG_FILE;
      if (!/^\/[A-Za-z0-9_./-]+$/.test(file)) throw err('SSH 配置路径无效。');
      env.GIT_SSH_COMMAND = `ssh -F ${file} -o BatchMode=yes -o StrictHostKeyChecking=yes`;
    }
    return new Promise((resolve, reject) => {
      const child = spawn('git', [...gitOptions, ...args], { cwd, env, windowsHide: true, shell: false });
      let output = '', errors = '', ended = false;
      const finish = (error, data) => { if (ended) return; ended = true; clearTimeout(timer); error ? reject(error) : resolve(data); };
      const timer = setTimeout(() => { child.kill('SIGKILL'); finish(err('Git 操作超时，请检查任务状态后再继续。')); }, 600_000);
      child.stdout.on('data', chunk => { output += chunk; if (output.length > 8_000_000) { child.kill(); finish(err('Git 输出过大，请缩小操作范围。')); } });
      child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-100_000); });
      child.on('error', () => finish(err('无法启动 Git，请检查服务配置。')));
      child.on('close', code => { if (errors) log(sanitize(errors)); finish(code === 0 ? null : err(sanitize(errors || output || `Git 退出码 ${code}`)), output); });
    });
  }
  async function workspace(project, requireRepo = true) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(project.id)) throw err('项目标识无效。');
    await mkdir(root, { recursive: true, mode: 0o700 });
    const realRoot = await realpath(root), folder = path.join(realRoot, project.id);
    let stat;
    try { stat = await lstat(folder); } catch (error) { if (error.code !== 'ENOENT') throw error; if (requireRepo) throw err('项目尚未成功克隆，请重试克隆。', 409); return folder; }
    if (!stat.isDirectory() || stat.isSymbolicLink() || path.dirname(await realpath(folder)) !== realRoot) throw err('项目目录不安全。');
    if (requireRepo) {
      const metadata = await lstat(path.join(folder, '.git')).catch(() => null);
      if (!metadata?.isDirectory() || metadata.isSymbolicLink()) throw err('项目尚未成功克隆，请检查克隆任务。', 409);
      if (await realpath((await execute(['rev-parse', '--show-toplevel'], folder)).trim()) !== folder) throw err('Git 项目范围不匹配。');
    }
    return folder;
  }
  async function files(folder) {
    const entries = (await execute(['status', '--porcelain=v1', '-z', '--untracked-files=all'], folder)).split('\0'), result = [];
    for (let index = 0; index < entries.length; index++) {
      if (!entries[index]) continue;
      const code = entries[index].slice(0, 2), name = entries[index].slice(3), original = /[RC]/.test(code) ? entries[++index] : undefined;
      result.push({ code, name, ...(original ? { original } : {}), blocked: protectedPath(name) || Boolean(original && protectedPath(original)) });
    }
    return result;
  }
  const branch = async folder => (await execute(['branch', '--show-current'], folder)).trim();
  async function clean(folder) { if ((await files(folder)).length) throw err('工作区仍有改动，请先提交或在编辑器中处理。', 409); }
  async function feature(folder) { const name = await branch(folder); if (!name || /^(main|master)$/i.test(name)) throw err('请在功能分支提交和推送；主线通过 GitHub PR 合并。', 409); return name; }
  async function origin(project, folder) {
    const urls = (await execute(['config', '--get-all', 'remote.origin.url'], folder)).trim().split('\n');
    if (urls.length !== 1 || normalizeGithubUrl(urls[0]) !== project.githubUrl) throw err('origin 与注册的 GitHub 仓库不一致。');
    const pushUrls = await execute(['config', '--get-all', 'remote.origin.pushurl'], folder).catch(() => '');
    if (pushUrls.trim().split('\n').filter(Boolean).some(url => normalizeGithubUrl(url) !== project.githubUrl)) throw err('origin 推送地址与注册仓库不一致。');
  }
  async function content(folder, name) {
    if (typeof name !== 'string' || name.includes('\0') || protectedPath(name)) throw err('该文件属于受保护配置。');
    const destination = path.resolve(folder, name);
    if (!destination.startsWith(folder + path.sep)) throw err('文件不在项目范围内。');
    let stat;
    try { stat = await lstat(destination); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || !(await realpath(destination)).startsWith(folder + path.sep)) throw err('不允许读取或提交符号链接及项目外文件。');
    if (stat.size > 5 * 1024 * 1024) throw err('文件超过 5 MB，请通过 Git 客户端审查。');
    const buffer = await readFile(destination), text = buffer.toString('utf8');
    if (knownSecret(text)) throw err('文件疑似包含凭据，预览和提交已阻止。');
    return buffer.includes(0) ? '[二进制文件]' : text;
  }
  const lines = value => value.trim().split('\n').filter(Boolean);
  async function status(project) {
    const folder = await workspace(project), changed = await files(folder), current = await branch(folder);
    const head = (await execute(['rev-parse', 'HEAD'], folder).catch(() => '')).trim();
    const upstream = (await execute(['rev-parse', '--abbrev-ref', '@{upstream}'], folder).catch(() => '')).trim();
    const count = (await execute(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], folder).catch(() => '0 0')).trim().split(/\s+/).map(Number);
    const lastDeployment = project.lastDeployment && { deployment: project.lastDeployment.deployment, commit: project.lastDeployment.commit, verification: project.lastDeployment.verification };
    return { branch: current, head, upstream, ahead: count[0] || 0, behind: count[1] || 0, lastDeployment: lastDeployment || null, branches: lines(await execute(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], folder)), remoteBranches: lines(await execute(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'], folder)).filter(v => v !== 'origin/HEAD').map(v => v.replace(/^origin\//, '')), files: changed, clean: changed.length === 0, prUrl: current && !/^(main|master)$/i.test(current) ? `${project.githubUrl}/compare/main...${encodeURIComponent(current)}?expand=1` : '' };
  }
  async function diff(project, name) {
    const folder = await workspace(project), file = (await files(folder)).find(value => value.name === name);
    if (!file || file.blocked) throw err('文件不在可预览改动中。');
    const text = await content(folder, name);
    const value = file.code === '??' ? text : await execute(['diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--', name], folder);
    if (knownSecret(value)) throw err('差异疑似包含凭据，已隐藏。');
    return { diff: cleanup(value.slice(0, 120000)) || '没有文本差异。' };
  }
  const deployment = project => (config.deployments || []).find(item => normalizeGithubUrl(item.githubUrl) === project.githubUrl);
  async function serverRefs(target, folder, retryRef) {
    const refs = new Map();
    const output = await execute(['ls-remote', target.remote, 'refs/heads/main', 'refs/heads/deployed', ...(retryRef ? [retryRef] : [])], folder);
    for (const line of output.trim().split('\n').filter(Boolean)) {
      const match = /^([a-f0-9]{40})\s+(refs\/heads\/[^\s]+)$/.exec(line);
      if (!match) throw err('服务器 Git 版本响应无效，无法确认发布结果。', 409);
      refs.set(match[2], match[1]);
    }
    return { main: refs.get('refs/heads/main'), deployed: refs.get('refs/heads/deployed'), retryPending: Boolean(retryRef && refs.has(retryRef)) };
  }
  async function verify(project, commit, folder, retryRef) {
    const target = deployment(project);
    const accepted = verification => ({ deployment: 'accepted', commit, ...(retryRef ? { retryRef } : {}), verification });
    if (!target?.verifyUrl || !/^[a-f0-9]{40}$/.test(commit || '')) return accepted('尚无可核对的部署版本。');
    try {
      const refs = await serverRefs(target, folder, retryRef);
      if (refs.retryPending) return accepted('服务器尚未确认本次重试完成；请检查发布日志后再核验。');
      if (refs.main !== commit || refs.deployed !== commit) return accepted('服务器 deployed 版本尚未确认此次提交；请检查发布日志，修复后显式重试。');
      const response = await (dependencies.fetch || fetch)(target.verifyUrl, { redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json' } });
      const text = await response.text();
      if (!response.ok || text.length > 64000) throw new Error('健康检查未通过');
      const body = JSON.parse(text), version = body.revision || body.commit || body.gitCommit || body.version || body.build?.commit || body.deployment?.commit;
      if (body.ok === true && typeof version === 'string' && /^[a-f0-9]{40}$/.test(version) && version === commit) return { deployment: 'verified', commit, verification: '服务器 deployed 与健康端点均已确认此次提交。' };
      return accepted('推送已接受，服务版本或就绪状态尚未匹配；请稍后核验。');
    } catch { return accepted('推送已接受，服务器版本或健康端点暂时不可核验；请稍后核验。'); }
  }
  async function action(project, input, log = () => {}, previousDeployment = null) {
    const name = input.action;
    if (name === 'clone') {
      const folder = await workspace(project, false);
      try { await lstat(path.join(folder, '.git')); throw err('项目已存在，请刷新状态。', 409); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await execute(['clone', '--progress', '--', project.githubUrl, folder], await realpath(root), { network: true, log });
      await workspace(project); return { message: '克隆完成。' };
    }
    const folder = await workspace(project);
    if (name === 'fetch') { await origin(project, folder); await execute(['fetch', '--prune', 'origin'], folder, { network: true, log }); return { message: 'GitHub 分支已刷新。' }; }
    if (name === 'pull') { await clean(folder); await origin(project, folder); const current = await branch(folder); if (!current) throw err('请切换到命名分支。'); await execute(['pull', '--ff-only', 'origin', current], folder, { network: true, log }); return { message: '当前分支已快进更新。' }; }
    if (name === 'switch' || name === 'branch') {
      await clean(folder);
      if (typeof input.branch !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9/_.-]{0,100}$/.test(input.branch)) throw err('分支名无效。');
      await execute(['check-ref-format', '--branch', input.branch], folder);
      if (name === 'branch') { if (/^(main|master)$/i.test(input.branch)) throw err('请输入功能分支名称。'); await execute(['switch', '-c', input.branch], folder); }
      else {
        const state = await status(project);
        if (state.branches.includes(input.branch)) await execute(['switch', '--no-guess', input.branch], folder);
        else if (state.remoteBranches.includes(input.branch)) await execute(['switch', '--track', '-c', input.branch, 'origin/' + input.branch], folder);
        else throw err('请选择已存在的本地或远端分支。');
      }
      return { message: '已切换到 ' + input.branch };
    }
    if (name === 'commit') {
      await feature(folder); const changed = await files(folder), selected = input.files;
      if (changed.some(file => file.code[0] !== ' ' && file.code !== '??')) throw err('已有暂存或冲突，请先在 Git 客户端处理。', 409);
      if (!Array.isArray(selected) || !selected.length || selected.length > 200 || new Set(selected).size !== selected.length || selected.some(v => typeof v !== 'string')) throw err('请选择 1–200 个文件。');
      if (typeof input.message !== 'string' || !input.message.trim() || input.message.length > 1000) throw err('提交说明需为 1–1000 字符。');
      for (const item of selected) { const file = changed.find(v => v.name === item); if (!file || file.blocked) throw err('文件已变化或受保护，请刷新列表。'); await content(folder, item); }
      await execute(['add', '--', ...selected], folder);
      try {
        const staged = (await execute(['diff', '--cached', '--name-only', '-z'], folder)).split('\0').filter(Boolean);
        if (staged.some(item => !selected.includes(item))) throw err('暂存区出现非选中文件，提交已停止。');
        if (knownSecret(await execute(['diff', '--cached', '--no-ext-diff', '--no-textconv'], folder))) throw err('提交差异疑似包含凭据，已阻止。');
        await execute(['-c', `user.name=${config.gitIdentity.name}`, '-c', `user.email=${config.gitIdentity.email}`, 'commit', '-m', input.message.trim()], folder, { log });
      } catch (error) { await execute(['reset', 'HEAD', '--', ...selected], folder).catch(() => {}); throw error; }
      return { message: '选中文件已提交；可以推送功能分支。' };
    }
    if (name === 'push') { const current = await feature(folder); await origin(project, folder); await execute(['push', '-u', 'origin', 'HEAD:refs/heads/' + current], folder, { network: true, log }); return { message: '功能分支已推送，请在 GitHub 创建 PR。' }; }
    if (name === 'deploy' || name === 'retryDeploy') {
      const target = deployment(project); if (!target) throw err('此项目未配置发布目标。', 403);
      await clean(folder); if (await branch(folder) !== 'main') throw err('发布前请切换到 main。', 409);
      await origin(project, folder); await execute(['fetch', 'origin'], folder, { network: true, log });
      const head = (await execute(['rev-parse', 'HEAD'], folder)).trim(), remote = (await execute(['rev-parse', 'refs/remotes/origin/main'], folder)).trim();
      if (!/^[a-f0-9]{40}$/.test(head)) throw err('发布版本必须是完整的 Git 提交。', 409);
      if (head !== remote) throw err('main 与 GitHub origin/main 不一致，请先拉取并检查。', 409);
      if (input.expectedCommit !== undefined && input.expectedCommit !== head) throw err('项目提交已发生变化，请重新检查并确认发布版本。', 409);
      const refs = await serverRefs(target, folder);
      if (name === 'retryDeploy') {
        if (input.expectedCommit !== head || previousDeployment?.deployment !== 'accepted' || previousDeployment.commit !== head) throw err('只能显式确认并重试此工作台此前已接受的同一发布版本。', 409);
        if (refs.main !== head) throw err('服务器 main 已发生变化，请检查当前版本；不能重试旧提交。', 409);
        const retryRef = `refs/heads/deploy-requests/${Date.now()}-${randomUUID()}`;
        await execute(['push', target.remote, head + ':' + retryRef], folder, { log });
        return { message: '服务器 Git 已接受同版本重试请求。', ...await verify(project, head, folder, retryRef) };
      }
      if (refs.main === head && refs.deployed !== head) throw err('服务器已接受此提交但发布尚未确认。请检查发布日志，修复后使用“重试同一版本发布”。', 409);
      if (refs.main !== head) await execute(['push', target.remote, head + ':refs/heads/main'], folder, { log });
      return { message: '服务器 Git 已接受发布提交。', ...await verify(project, head, folder) };
    }
    if (name === 'verify') {
      if (!deployment(project)) throw err('此项目未配置发布目标。', 403);
      if (!previousDeployment?.commit) throw err('此工作台尚无已接受的发布记录。', 409);
      return { message: '已核验发布状态。', ...await verify(project, previousDeployment.commit, folder, previousDeployment.retryRef) };
    }
    throw err('不支持的操作。');
  }
  return { action, status, diff, deployment, cleanup };
}
