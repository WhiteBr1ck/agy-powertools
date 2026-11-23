import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parsePorcelainV2Status, parseNumstat, readGitStatus, readGitFileDiff } from '../lib/git-status.mjs';

test('parsePorcelainV2Status and parseNumstat handle branches, detached HEAD, renames, and quoted UTF-8 paths', () => {
  const porcelain = [
    '# branch.oid 1234567890abcdef',
    '# branch.head feat/codex-ui',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 aaa bbb src/app.mjs',
    '? "docs/\\344\\270\\255\\346\\226\\207.md"'
  ].join('\n');
  const status = parsePorcelainV2Status(porcelain);
  assert.equal(status.branch, 'feat/codex-ui');
  assert.equal(status.ahead, 2);
  assert.equal(status.behind, 1);
  assert.deepEqual(status.files, [
    { path: 'src/app.mjs', status: 'M' },
    { path: 'docs/中文.md', status: '?' }
  ]);

  const detached = parsePorcelainV2Status('# branch.oid abcdef012345\n# branch.head (detached)\n');
  assert.equal(detached.branch, 'HEAD@abcdef0');

  const numstat = parseNumstat('12\t4\tsrc/app.mjs\n-\t-\tassets/logo.png\n');
  assert.deepEqual(numstat.get('src/app.mjs'), { additions: 12, deletions: 4, binary: false });
  assert.deepEqual(numstat.get('assets/logo.png'), { additions: 0, deletions: 0, binary: true });
});

test('readGitStatus and readGitFileDiff use --no-optional-locks, count untracked lines, preview diffs, and reject path traversal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-git-repo-'));
  try {
    const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    const init = git('init', '-b', 'main');
    if (init.status !== 0) git('init');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');

    writeFileSync(join(dir, 'hello.js'), 'const a = 1;\nconst b = 2;\n');
    git('add', 'hello.js');
    git('commit', '-m', 'init');

    writeFileSync(join(dir, 'hello.js'), 'const a = 1;\nconst b = 42;\nconst c = 3;\n');
    writeFileSync(join(dir, 'new-note.txt'), 'line1\nline2\nline3\n');

    const observedArgs = [];
    const trackingExec = (cmd, args, opts, cb) => {
      observedArgs.push(args);
      return execFile(cmd, args, opts, cb);
    };

    const uri = pathToFileURL(dir).href;
    const status = await readGitStatus(uri, { force: true, execGit: trackingExec });
    assert.equal(status.isRepo, true);
    assert.ok(observedArgs.every(args => args[0] === '--no-optional-locks'));
    assert.equal(status.changedCount, 2);
    assert.equal(status.additions, 5);
    assert.equal(status.deletions, 1);

    const modPatch = await readGitFileDiff(uri, 'hello.js', { status: 'M', execGit: trackingExec });
    assert.equal(modPatch.ok, true);
    assert.match(modPatch.patch, /\+const b = 42;/);
    assert.match(modPatch.patch, /-const b = 2;/);

    const untrackedPatch = await readGitFileDiff(uri, 'new-note.txt', { status: '?', execGit: trackingExec });
    assert.equal(untrackedPatch.ok, true);
    assert.match(untrackedPatch.patch, /\+line1/);

    await assert.rejects(() => readGitFileDiff(uri, '../outside.txt'), /越界/);
    await assert.rejects(() => readGitFileDiff(uri, '/etc/passwd'), /无效/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
