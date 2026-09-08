import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const source = path.dirname(fileURLToPath(import.meta.url));
test('portable workbench: real Git clone/branch/commit/push/pull and safeguards', { timeout: 90000 }, async () => {
  const base = path.resolve(source, '../../tmp');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'git-workbench-test-'));
  const bare = path.join(root, 'remote.git'), seed = path.join(root, 'seed'), clone = path.join(root, 'clone');
  await mkdir(seed);
  const config = path.join(root, 'gitconfig');
  await writeFile(config, '[user]\n name = Workbench Test\n email = test@example.invalid\n');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'url.' + pathToFileURL(bare).href + '.insteadOf', GIT_CONFIG_VALUE_0: 'https://github.com/workbench/test.git',
    PORT: '4319' };
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true, stdio: ['ignore','pipe','pipe'] }).trim();
  git(root, 'init', '--bare', '--initial-branch=main', bare);
  git(seed, 'init', '--initial-branch=main');
  await writeFile(path.join(seed, 'README.md'), 'baseline\n');
  git(seed, 'add', 'README.md'); git(seed, 'commit', '-m', 'baseline');
  git(seed, 'remote', 'add', 'origin', bare); git(seed, 'push', '-u', 'origin', 'main');
  const child = spawn(process.execPath, [path.join(source, 'server.mjs')], { env, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  let errorLog = ''; child.stderr.on('data', d => errorLog += d);
  const origin = 'http://127.0.0.1:4319';
  try {
    let html;
    for(let i=0;i<60;i++){ try { html=await (await fetch(origin)).text(); break; } catch { await new Promise(r=>setTimeout(r,100)); } }
    assert.ok(html, errorLog);
    const token = /name="workbench-token" content="([^"]+)"/.exec(html)[1];
    const headers = { 'X-Workbench-Token': token, 'Content-Type': 'application/json' };
    assert.equal((await fetch(origin+'/api/state')).status,403);
    assert.equal((await fetch(origin+'/api/state',{headers:{...headers,Origin:'https://untrusted.invalid'}})).status,403);
    async function state(){ return (await fetch(origin+'/api/state',{headers})).json(); }
    async function action(body, expected='done'){
      const response=await fetch(origin+'/api/action',{method:'POST',headers,body:JSON.stringify(body)});
      assert.equal(response.status,202);
      let job;
      for(let i=0;i<300;i++){
        job=(await (await fetch(origin+'/api/job',{headers})).json()).job;
        if(job.status!=='running') break;
        await new Promise(r=>setTimeout(r,50));
      }
      assert.equal(job.status,expected,job.log); return job;
    }
    await action({action:'clone',url:'https://github.com/workbench/test.git',path:clone});
    assert.equal((await state()).branch,'main');
    await action({action:'push'},'failed');
    await action({action:'branch',branch:'codex/portable-test'});
    const chosen='中文 [one].txt';
    await writeFile(path.join(clone,chosen),'selected\n');
    await writeFile(path.join(clone,'untouched.txt'),'keep me\n');
    await writeFile(path.join(clone,'.env'),'PRIVATE=local\n');
    assert.equal((await state()).files.find(f=>f.name==='.env').blocked,true);
    await action({action:'commit',files:['.env'],message:'reject env'},'failed');
    await action({action:'branch',branch:'codex/dirty'},'failed');
    await action({action:'commit',files:[chosen],message:'feat: selected file'});
    assert.equal(git(clone,'show','--format=','--name-only','HEAD'),'"\\344\\270\\255\\346\\226\\207 [one].txt"');
    assert.equal(await readFile(path.join(clone,'untouched.txt'),'utf8'),'keep me\n');
    await action({action:'commit',files:['untouched.txt'],message:'feat: second file'});
    await unlink(path.join(clone,'.env'));
    await action({action:'push'});
    assert.equal(git(root,'--git-dir='+bare,'rev-parse','refs/heads/codex/portable-test'),git(clone,'rev-parse','HEAD'));
    git(seed,'fetch','origin'); git(seed,'switch','--track','origin/codex/portable-test');
    await writeFile(path.join(seed,'README.md'),'updated from second computer\n');
    git(seed,'add','README.md'); git(seed,'commit','-m','second device'); git(seed,'push');
    await action({action:'fetch'}); await action({action:'pull'});
    assert.equal(await readFile(path.join(clone,'README.md'),'utf8'),'updated from second computer\n');
    await writeFile(path.join(clone,'credential.txt'),'ghp_'+'A'.repeat(40));
    await action({action:'commit',files:['credential.txt'],message:'reject key'},'failed');
    const diff=await fetch(origin+'/api/diff?file=credential.txt',{headers}); assert.equal(diff.status,400);
    await unlink(path.join(clone,'credential.txt'));
    await action({action:'switch',branch:'main'});
    assert.equal((await state()).branch,'main');
    console.log('Verified offline fixture:',root);
  } finally { child.kill(); await new Promise(resolve=>child.once('close',resolve)); }
});
