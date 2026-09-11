import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHubServer } from './server.mjs';
import { createAuth, hashPassword } from './auth.mjs';
import { normalizeGithubUrl, protectedPath, scrub } from './gitOperations.mjs';

const exec = promisify(execFile);
const localGit = async (folder, args) => (await exec('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Hub Test', '-c', 'user.email=hub@example.test', ...args], { cwd: folder, windowsHide: true, maxBuffer: 8_000_000 })).stdout;
const githubUrl = 'https://github.com/example/hub-fixture';
const origin = 'https://hub.example.test';
const password = 'fixture-password-1234';

test('GitHub URL and log boundaries reject credentials and redact secrets', () => {
  assert.equal(normalizeGithubUrl(githubUrl + '.git'), githubUrl);
  for (const value of ['http://github.com/a/b', 'https://user:secret@github.com/a/b', 'https://github.com.evil.test/a/b', 'https://github.com/a/b?token=x', 'ssh://github.com/a/b', 'https://github.com/a/..']) assert.throws(() => normalizeGithubUrl(value));
  for (const name of ['.env', '.env.local', '.ssh/id_ed25519', '.git/config', '.npmrc', 'sub/.netrc', 'private.pem']) assert.equal(protectedPath(name), true);
  assert.equal(protectedPath('.env.example'), false);
  assert.equal(scrub('secret-value /workspaces/abc ghp_' + 'A'.repeat(30), ['secret-value'], ['/workspaces']).includes('secret-value'), false);
  assert.equal(scrub('ghp_' + 'A'.repeat(30)).includes('ghp_'), false);
});

test('server auth, real Git project isolation, selected commits and release verification', async t => {
  const base = await mkdtemp(path.join(process.cwd(), '.project-hub-test-'));
  const source = path.join(base, 'source'), bare = path.join(base, 'github.git'), deployed = path.join(base, 'deployed.git');
  let hub, cookie = '', csrf = '', revision = '0'.repeat(40), readinessOk = true, acknowledgeRetry = false, holdFetch, markFetch;
  const operations = [];
  try {
    await mkdir(source); await localGit(source, ['init', '-b', 'main']);
    await writeFile(path.join(source, 'README.md'), 'first\n');
    await localGit(source, ['add', '.']); await localGit(source, ['commit', '-m', 'initial']);
    await localGit(base, ['clone', '--bare', source, bare]); await localGit(base, ['init', '--bare', deployed]);
    await localGit(source, ['switch', '-c', 'feature/remote']); await writeFile(path.join(source, 'remote.txt'), 'remote branch\n'); await localGit(source, ['add', '.']); await localGit(source, ['commit', '-m', 'remote branch']); await localGit(source, ['push', bare, 'feature/remote']); await localGit(source, ['switch', 'main']);
    const config = { publicOrigin: origin, username: 'admin', passwordHash: await hashPassword(password), workspaceRoot: path.join(base, 'workspaces'), dataDir: path.join(base, 'data'), gitIdentity: { name: 'Hub Admin', email: 'hub@example.test' }, deployments: [{ githubUrl, remote: 'ssh://deployment-host/repository.git', verifyUrl: origin + '/ready' }] };
    const runGit = async (args, cwd, options) => {
      operations.push({ args, cwd, network: options.network });
      if (args[0] === 'clone') { await localGit(cwd, ['clone', '--', bare, args.at(-1)]); await localGit(args.at(-1), ['remote', 'set-url', 'origin', githubUrl]); return ''; }
      if (args[0] === 'fetch') { if (holdFetch) { markFetch?.(); await holdFetch; } return localGit(cwd, ['fetch', bare, '+refs/heads/*:refs/remotes/origin/*']); }
      if (args[0] === 'pull') return localGit(cwd, ['pull', '--ff-only', bare, args.at(-1)]);
      if (args[0] === 'ls-remote') return localGit(cwd, ['ls-remote', deployed, ...args.slice(2)]);
      if (args[0] === 'push') {
        const isDeployment = args.includes('ssh://deployment-host/repository.git');
        const output = await localGit(cwd, ['push', isDeployment ? deployed : bare, args.at(-1)]);
        const [commit, ref] = args.at(-1).split(':');
        if (isDeployment && acknowledgeRetry && ref.startsWith('refs/heads/deploy-requests/')) {
          await localGit(base, ['--git-dir=' + deployed, 'update-ref', 'refs/heads/deployed', commit]);
          await localGit(base, ['--git-dir=' + deployed, 'update-ref', '-d', ref, commit]);
        }
        return output;
      }
      return localGit(cwd, args);
    };
    const dependencies = { git: { runGit, fetch: async url => { assert.equal(url, origin + '/ready'); return new Response(JSON.stringify({ ok: readinessOk, revision }), { status: 200 }); } } };
    hub = await createHubServer(config, dependencies);
    await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve));
    let url = `http://127.0.0.1:${hub.server.address().port}/ops/api`;
    const request = async (route, input, extras = {}) => {
      const response = await fetch(url + route, { method: input === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(input === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }), ...extras }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
      return { status: response.status, body: await response.json(), headers: response.headers };
    };
    const waitJob = async id => {
      for (let attempt = 0; attempt < 200; attempt++) { const response = await request('/jobs/' + id); if (response.body.job.status !== 'running') return response.body.job; await new Promise(resolve => setTimeout(resolve, 20)); }
      throw new Error('job did not finish');
    };
    const action = async (project, input) => { const response = await request(`/projects/${project.id}/actions`, input); assert.equal(response.status, 202, JSON.stringify(response.body)); return waitJob(response.body.job.id); };
    const register = async name => { const response = await request('/projects', { name, githubUrl }); assert.equal(response.status, 202); assert.equal((await waitJob(response.body.job.id)).status, 'succeeded'); return response.body.project; };

    await t.test('unauthenticated requests disclose no project state; Origin and CSRF are mandatory', async () => {
      assert.deepEqual((await request('/auth/session')).body, { authenticated: false });
      for (const route of ['/projects', '/jobs/fake', '/projects/fake/status']) { const response = await request(route); assert.equal(response.status, 401); assert.equal(JSON.stringify(response.body).includes(base), false); }
      assert.equal((await request('/auth/login', { username: 'admin', password }, { Origin: 'https://evil.test' })).status, 403);
      assert.equal((await request('/auth/login', { username: 'admin', password: 'bad-password' })).status, 401);
      const login = await request('/auth/login', { username: 'admin', password }); assert.equal(login.status, 200); csrf = login.body.csrfToken;
      assert.match(login.headers.get('set-cookie'), /HttpOnly/); assert.match(login.headers.get('set-cookie'), /Secure/); assert.match(login.headers.get('set-cookie'), /SameSite=Strict/);
      cookie = login.headers.get('set-cookie').split(';')[0];
      assert.equal((await request('/projects', { name: 'missing CSRF', githubUrl }, { 'X-CSRF-Token': '' })).status, 403);
      assert.equal((await request('/projects', { name: 'missing Origin', githubUrl }, { Origin: '' })).status, 403);
    });
    let first, second;
    await t.test('two clones are UUID scoped and registered without exposing filesystem locations', async () => {
      first = await register('First'); second = await register('Second');
      assert.notEqual(first.id, second.id);
      const result = await request('/projects'); assert.equal(result.body.projects.length, 2); assert.equal(JSON.stringify(result.body).includes(base), false);
      assert.equal((await request(`/projects/${first.id}/status`)).body.branch, 'main');
      assert.equal((await request('/projects', { name: 'bad', githubUrl: 'https://token@github.com/owner/repo' })).status, 400);
      assert.equal((await request('/projects/not-a-uuid/status')).status, 404);
    });
    await t.test('main cannot push; remote branches track correctly; commits include selected files only', async () => {
      assert.equal((await action(first, { action: 'push' })).status, 'failed');
      assert.equal((await action(first, { action: 'switch', branch: 'feature/remote' })).status, 'succeeded');
      const tracked = await request(`/projects/${first.id}/status`); assert.equal(tracked.body.upstream, 'origin/feature/remote');
      assert.equal((await action(first, { action: 'branch', branch: 'codex/test-edit' })).status, 'succeeded');
      const folder = path.join(config.workspaceRoot, first.id);
      await writeFile(path.join(folder, 'selected.txt'), 'selected content\n'); await writeFile(path.join(folder, 'remain.txt'), 'remaining local edit\n');
      assert.equal((await action(first, { action: 'commit', files: ['selected.txt'], message: 'selected only' })).status, 'succeeded');
      assert.equal((await localGit(folder, ['show', '--format=', '--name-only', 'HEAD'])).trim(), 'selected.txt');
      assert.equal((await request(`/projects/${first.id}/status`)).body.files.some(file => file.name === 'remain.txt'), true);
      assert.equal((await request(`/projects/${second.id}/status`)).body.branch, 'main');
      assert.equal((await action(first, { action: 'push' })).status, 'succeeded');
      assert.ok((await localGit(base, ['--git-dir=' + bare, 'show-ref', 'refs/heads/codex/test-edit'])).trim());
      assert.equal((await action(first, { action: 'switch', branch: 'main' })).status, 'failed');
    });
    await t.test('sensitive files, secret-bearing diffs, traversal and arbitrary actions are rejected', async () => {
      const folder = path.join(config.workspaceRoot, first.id);
      await writeFile(path.join(folder, '.env'), 'MY_PASSWORD=secret'); await writeFile(path.join(folder, 'credentials.txt'), 'ghp_' + 'A'.repeat(35));
      assert.equal((await request(`/projects/${first.id}/diff?file=.env`)).status, 400);
      assert.equal((await request(`/projects/${first.id}/diff?file=credentials.txt`)).status, 400);
      assert.equal((await request(`/projects/${first.id}/diff?file=..%2Fdata%2Fregistry.json`)).status, 400);
      assert.equal((await action(first, { action: 'commit', files: ['credentials.txt'], message: 'blocked' })).status, 'failed');
      assert.equal((await request(`/projects/${first.id}/actions`, { action: 'shell', command: 'echo bad' })).status, 400);
      assert.equal((await action(second, { action: 'branch', branch: '--upload-pack=bad' })).status, 'failed');
    });
    await t.test('a busy project refuses another mutation while a different project proceeds', async () => {
      let release; holdFetch = new Promise(resolve => { release = resolve; }); const entered = new Promise(resolve => { markFetch = resolve; });
      const started = await request(`/projects/${first.id}/actions`, { action: 'fetch' }); assert.equal(started.status, 202); await entered;
      try {
        assert.equal((await request(`/projects/${first.id}/actions`, { action: 'fetch' })).status, 409);
        assert.equal((await action(second, { action: 'branch', branch: 'codex/independent' })).status, 'succeeded');
      } finally { release(); holdFetch = null; markFetch = null; }
      assert.equal((await waitJob(started.body.job.id)).status, 'succeeded');
    });
    await t.test('release requires clean exact origin/main; accepted differs from verified full revision', async () => {
      assert.equal((await action(second, { action: 'deploy' })).status, 'failed');
      assert.equal((await action(second, { action: 'switch', branch: 'main' })).status, 'succeeded');
      assert.equal((await action(second, { action: 'deploy', expectedCommit: 'f'.repeat(40) })).status, 'failed');
      const initial = await action(second, { action: 'deploy' }); assert.equal(initial.status, 'succeeded'); assert.equal(initial.result.deployment, 'accepted');
      assert.equal((await request(`/projects/${second.id}/status`)).body.lastDeployment.commit, initial.result.commit);
      const pushesBefore = operations.filter(call => call.args[0] === 'push').length;
      const duplicate = await action(second, { action: 'deploy' }); assert.equal(duplicate.status, 'failed'); assert.match(duplicate.log, /重试同一版本发布/);
      assert.equal(operations.filter(call => call.args[0] === 'push').length, pushesBefore);
      assert.equal((await action(second, { action: 'retryDeploy' })).status, 'failed');
      assert.equal((await action(second, { action: 'retryDeploy', expectedCommit: 'f'.repeat(40) })).status, 'failed');
      await localGit(base, ['--git-dir=' + deployed, 'update-ref', '-d', 'refs/heads/main']);
      assert.equal((await action(second, { action: 'retryDeploy', expectedCommit: initial.result.commit })).status, 'failed');
      await localGit(base, ['--git-dir=' + deployed, 'update-ref', 'refs/heads/main', initial.result.commit]);
      const unacknowledged = await action(second, { action: 'retryDeploy', expectedCommit: initial.result.commit });
      assert.equal(unacknowledged.status, 'succeeded'); assert.equal(unacknowledged.result.deployment, 'accepted');
      assert.match(unacknowledged.result.retryRef, /^refs\/heads\/deploy-requests\/[0-9]+-[0-9a-f-]{36}$/);
      revision = initial.result.commit;
      await localGit(base, ['--git-dir=' + deployed, 'update-ref', 'refs/heads/deployed', revision]);
      assert.equal((await action(second, { action: 'verify' })).result.deployment, 'accepted', 'matching prior revision cannot acknowledge a pending retry request');
      acknowledgeRetry = true; readinessOk = false;
      const retried = await action(second, { action: 'retryDeploy', expectedCommit: revision });
      assert.equal(retried.status, 'succeeded'); assert.equal(retried.result.deployment, 'accepted', 'HTTP 200 with ok:false must not verify');
      assert.notEqual(retried.result.retryRef, unacknowledged.result.retryRef);
      readinessOk = true;
      revision = initial.result.commit.slice(0, 7); assert.equal((await action(second, { action: 'verify' })).result.deployment, 'accepted');
      revision = initial.result.commit; assert.equal((await action(second, { action: 'verify' })).result.deployment, 'verified');
      assert.equal((await action(second, { action: 'retryDeploy', expectedCommit: revision })).status, 'failed', 'verified releases require a new explicit accepted state before retry');
      const folder = path.join(config.workspaceRoot, second.id); await writeFile(path.join(folder, 'local-only.txt'), 'ahead\n'); await localGit(folder, ['add', '.']); await localGit(folder, ['commit', '-m', 'unmerged local main']);
      assert.equal((await action(second, { action: 'deploy' })).status, 'failed');
      assert.ok(operations.some(call => call.args[0] === 'push' && call.args[1] === 'ssh://deployment-host/repository.git' && call.network === false));
    });
    await t.test('persisted audit excludes credentials and restart marks in-flight records interrupted', async () => {
      await hub.drain(); await hub.close();
      const filename = path.join(config.dataDir, 'registry.json'), state = JSON.parse(await readFile(filename, 'utf8'));
      assert.equal(JSON.stringify(state).includes(password), false); assert.equal(JSON.stringify(state).includes('ghp_' + 'A'.repeat(35)), false);
      const interrupted = { id: '9bfe8b64-93cc-4aa9-8a0c-dab994d3f1d2', projectId: first.id, action: 'push', status: 'running', createdAt: new Date().toISOString(), log: '' };
      state.jobs.push(interrupted); state.audit.push({ ...interrupted }); await writeFile(filename, JSON.stringify(state));
      hub = await createHubServer(config, dependencies); await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve)); url = `http://127.0.0.1:${hub.server.address().port}/ops/api`;
      assert.equal((await request('/projects')).status, 401);
      const login = await request('/auth/login', { username: 'admin', password }); cookie = login.headers.get('set-cookie').split(';')[0]; csrf = login.body.csrfToken;
      assert.equal((await request('/jobs/' + interrupted.id)).body.job.status, 'interrupted');
      assert.equal((await request('/projects')).body.projects.length, 2);
      assert.equal((await request('/auth/logout', {})).status, 200); assert.equal((await request('/projects')).status, 401);
    });
  } finally {
    if (hub) { await hub.drain(); await hub.close(); }
    if (path.dirname(base) === process.cwd() && path.basename(base).startsWith('.project-hub-test-')) await rm(base, { recursive: true, force: true });
  }
});

test('login is rate limited before unlimited scrypt work', async () => {
  const base = await mkdtemp(path.join(process.cwd(), '.project-hub-test-'));
  let hub;
  try {
    hub = await createHubServer({ publicOrigin: origin, username: 'admin', passwordHash: await hashPassword(password), workspaceRoot: path.join(base, 'workspaces'), dataDir: path.join(base, 'data'), gitIdentity: { name: 'Test', email: 'test@example.test' } });
    await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${hub.server.address().port}/ops/api/auth/login`;
    for (let index = 0; index < 10; index++) assert.equal((await fetch(url, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'incorrect' }) })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password }) })).status, 429);
  } finally { if (hub) await hub.close(); if (path.dirname(base) === process.cwd() && path.basename(base).startsWith('.project-hub-test-')) await rm(base, { recursive: true, force: true }); }
});

test('trusted proxy login limits isolate clients and never trust an arbitrary forwarded header', async () => {
  const config = { publicOrigin: origin, username: 'admin', passwordHash: await hashPassword(password), trustedProxyAddresses: ['127.0.0.1'] };
  const auth = createAuth(config), response = { setHeader() {} };
  const request = (client, peer = '::ffff:127.0.0.1') => ({ socket: { remoteAddress: peer }, headers: { 'x-project-hub-client-ip': client } });
  for (let index = 0; index < 10; index++) await assert.rejects(auth.login(request('203.0.113.1'), response, { username: 'admin', password: 'incorrect' }), { status: 401 });
  await assert.rejects(auth.login(request('203.0.113.1'), response, { username: 'admin', password }), { status: 429 });
  assert.equal((await auth.login(request('203.0.113.2'), response, { username: 'admin', password })).authenticated, true);
  await assert.rejects(auth.login(request('203.0.113.2, 203.0.113.3'), response, { username: 'admin', password }), { status: 403 });
  for (let index = 0; index < 10; index++) await assert.rejects(auth.login(request('198.51.100.' + index, '192.0.2.20'), response, { username: 'admin', password: 'incorrect' }), { status: 401 });
  await assert.rejects(auth.login(request('198.51.100.99', '192.0.2.20'), response, { username: 'admin', password }), { status: 429 });
  // The previous global 100-attempt window let unauthenticated traffic lock every administrator out.
  for (let index = 0; index < 100; index++) await assert.rejects(auth.login(request('198.51.100.' + (index + 1)), response, { username: 'admin', password: 'incorrect' }), { status: 401 });
  assert.equal((await auth.login(request('203.0.113.3'), response, { username: 'admin', password })).authenticated, true);
});
