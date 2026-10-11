import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const fixture = path.join(repo, 'test/fixture');
const cli = path.join(repo, 'dist/cli.js');

// The fixture imports the package by name, as a real bot project would.
fs.mkdirSync(path.join(fixture, 'node_modules/@aiogram'), { recursive: true });
fs.rmSync(path.join(fixture, 'node_modules/@aiogram/tgcloud-grammy'), { force: true });
fs.symlinkSync(repo, path.join(fixture, 'node_modules/@aiogram/tgcloud-grammy'), 'dir');

test('fixture type-checks against the sdk typings', () => {
  execFileSync(process.execPath, [path.join(repo, 'node_modules/typescript/bin/tsc'), '-p', fixture], { stdio: 'inherit' });
});

test('built bot runs without web globals and keeps schema.js standalone', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tgcloud-grammy-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
  fs.cpSync(path.join(repo, 'test/mock-sdk'), path.join(tmp, 'node_modules/sdk'), { recursive: true });
  const out = path.join(tmp, 'tgcloud');
  const build = () => spawnSync(process.execPath, [cli, 'build', '--src', path.join(fixture, 'src'), '--out', out], { encoding: 'utf8' });

  const first = build();
  assert.equal(first.status, 0, first.stderr);
  const edited = fs.readFileSync(path.join(out, 'handlers/edited_message.js'), 'utf8');
  assert.match(edited, /from "\.\.\/schema\.js"/);
  assert.doesNotMatch(edited, /table\(/);
  // npm packages live in lib/vendor/, once: never inlined into handlers or duplicated.
  const message = fs.readFileSync(path.join(out, 'handlers/message.js'), 'utf8');
  assert.match(message, /from "\.\.\/lib\/vendor\/aiogram\/tgcloud-grammy\/grammy\.js"/);
  // Your modules keep their files, found through imports (lib/format.ts only through lib/bot.ts);
  // lib/typecheck.ts is imported by nothing, so it isn't deployed.
  assert.match(message, /from "\.\.\/lib\/bot\.js"/);
  assert.match(fs.readFileSync(path.join(out, 'lib/bot.js'), 'utf8'), /from "\.\/format\.js"/);
  assert.ok(fs.existsSync(path.join(out, 'lib/format.js')));
  assert.ok(!fs.existsSync(path.join(out, 'lib/typecheck.js')));
  const outputs = fs.readdirSync(out, { recursive: true }).filter((f) => f.endsWith('.js'));
  const withGrammy = outputs.filter((f) => fs.readFileSync(path.join(out, f), 'utf8').includes('grammy:core'));
  assert.equal(withGrammy.length, 1, `grammY is in: ${withGrammy.join(', ')}`);
  assert.match(withGrammy[0], /^lib\/vendor\//);
  // A vendor entry re-exports only what the bot imports (here: InputFile), so the rest is tree-shaken.
  const grammyEntry = fs.readFileSync(path.join(out, 'lib/vendor/grammy.js'), 'utf8');
  assert.match(grammyEntry, /InputFile/);
  assert.doesNotMatch(grammyEntry, /Composer/);

  const run = spawnSync(process.execPath, [path.join(repo, 'test/run-bundle.mjs'), tmp], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /OK/);

  // Rebuilds replace their own output but refuse to delete hand-written modules.
  assert.equal(build().status, 0);
  fs.writeFileSync(path.join(out, 'handlers/poll.js'), 'export default () => {}');
  const refused = build();
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /handlers\/poll\.js/);
  assert.ok(fs.existsSync(path.join(out, 'handlers/poll.js')));

  // A handler whose update type disagrees with its file name fails the build.
  const src = path.join(tmp, 'src');
  fs.mkdirSync(path.join(src, 'handlers'), { recursive: true });
  fs.writeFileSync(path.join(src, 'handlers/message.ts'), "export default toHandler(bot, 'callback_query');");
  const mismatch = spawnSync(process.execPath, [cli, 'build', '--src', src, '--out', path.join(tmp, 'out2')], { encoding: 'utf8' });
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stderr, /handlers\/message\.ts handles "callback_query"/);
});

test('init replaces untouched starter files and refuses to touch your code', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgcloud-grammy-init-'));
  const starter = "import { api } from 'sdk';\nexport default async () => {};\n";
  const write = (f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
  // What `tgcloud init` leaves behind, with the starter's hash recorded.
  write('package.json', JSON.stringify({ name: 'bot', scripts: { deploy: 'tgcloud push', status: 'tgcloud status' } }));
  write('.gitignore', '.tgcloud/\nnode_modules/');
  write('tgcloud.jsonc', '{}');
  write('AGENTS.md', '# AGENTS.md\n\nIntro.\n\n## What this project is\n');
  write('tgcloud/handlers/message.js', starter);
  const hash = createHash('sha256').update(starter).digest('hex');
  write('.tgcloud/state.json', JSON.stringify({ init_templates: { 'tgcloud/handlers/message.js': `sha256:${hash}` } }));
  fs.mkdirSync(path.join(dir, 'node_modules/@aiogram'), { recursive: true });
  fs.symlinkSync(repo, path.join(dir, 'node_modules/@aiogram/tgcloud-grammy'), 'dir');
  fs.symlinkSync(path.join(repo, 'node_modules/grammy'), path.join(dir, 'node_modules/grammy'), 'dir');
  const init = (...args) => spawnSync(process.execPath, [cli, 'init', ...args], { cwd: dir, encoding: 'utf8' });

  const first = init('--github-actions');
  assert.equal(first.status, 0, first.stderr + first.stdout);
  assert.ok(fs.existsSync(path.join(dir, 'src/lib/bot.ts')));
  assert.match(fs.readFileSync(path.join(dir, '.github/workflows/deploy.yml'), 'utf8'), /tgcloud fetch[\s\S]*npm run deploy/);
  assert.match(fs.readFileSync(path.join(dir, 'tgcloud/handlers/message.js'), 'utf8'), /toHandler/); // built from src/
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.deploy, 'tsc && tgcloud-grammy build && tgcloud push');
  assert.equal(pkg.scripts.status, 'tgcloud-grammy build && tgcloud status');
  assert.equal(pkg.scripts.run, 'tgcloud-grammy build && tgcloud run');
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), '.tgcloud/\nnode_modules/\n# Generated from src/ by tgcloud-grammy build\n/tgcloud/\n');
  assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /Intro\.\n\n## This project is TypeScript[\s\S]*## What this project is/);

  // `add` takes `tgcloud add` targets, writes TypeScript starters, keeps existing files and rejects typos.
  const add = (...args) => spawnSync(process.execPath, [cli, 'add', ...args], { cwd: dir, encoding: 'utf8' });
  const added = add('handlers/callback_query', 'handlers/message', 'endpoints/getUser', 'lib/util/math');
  assert.equal(added.status, 0, added.stderr);
  assert.match(fs.readFileSync(path.join(dir, 'src/handlers/callback_query.ts'), 'utf8'), /toHandler\(bot, 'callback_query'\)/);
  assert.match(fs.readFileSync(path.join(dir, 'src/endpoints/getUser.ts'), 'utf8'), /defineEndpoint/);
  assert.ok(fs.existsSync(path.join(dir, 'src/lib/util/math.ts')));
  assert.match(added.stdout, /message\.ts exists, kept/);
  const typo = add('handlers/inline_query', 'handlers/callback_querry');
  assert.equal(typo.status, 1);
  assert.match(typo.stderr, /"callback_querry" is not an update type/);
  assert.ok(!fs.existsSync(path.join(dir, 'src/handlers/inline_query.ts'))); // nothing written
  assert.match(add('handlers').stderr, /Available: .*inline_query/);
  assert.equal(spawnSync(process.execPath, [cli, 'build'], { cwd: dir }).status, 0);

  // Hand-written code in tgcloud/ is never deleted.
  write('tgcloud/lib/mine.js', 'export const x = 1;');
  const refused = init();
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /tgcloud\/lib\/mine\.js/);
  assert.ok(fs.existsSync(path.join(dir, 'tgcloud/lib/mine.js')));
});
