import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));
const AGENTS_MARKER = '## This project is TypeScript';
const MANIFEST = 'tgcloud/.tgcloud-grammy.json';

export class InitError extends Error {}

/** `tgcloud/` modules: the files tgcloud-grammy init would have to replace. */
function moduleFiles(): string[] {
  if (!fs.existsSync('tgcloud')) return [];
  return (fs.readdirSync('tgcloud', { recursive: true }) as string[])
    .map((f) => path.posix.join('tgcloud', f.split(path.sep).join('/')))
    .filter((f) => f.endsWith('.js'));
}

/**
 * Turns the current folder into a TypeScript tgcloud project. Runs `tgcloud init`
 * first when the folder isn't a tgcloud project yet. Never overwrites a file and
 * never deletes code you wrote: only starter files `tgcloud init` created and
 * nobody edited since (it records their hashes) are removed.
 */
export function init(): string[] {
  if (!fs.existsSync('package.json')) throw new InitError('No package.json here. Run `npm init -y` first, or use `npm create @aiogram/tgcloud-grammy <dir>`.');
  if (!fs.existsSync('tgcloud.jsonc') && !fs.existsSync('tgcloud.json')) {
    if (!fs.existsSync('node_modules/.bin/tgcloud')) {
      throw new InitError('Install the tools first: npm i -D @tgcloud/cli typescript @aiogram/tgcloud-grammy && npm i grammy');
    }
    execSync('npx tgcloud init --no-git', { stdio: 'inherit', env: { ...process.env, TGCLOUD_INIT_QUIET_NEXT: '1' } });
  }

  // tgcloud/ becomes build output. Check everything before changing anything.
  const state = fs.existsSync('.tgcloud/state.json') ? JSON.parse(fs.readFileSync('.tgcloud/state.json', 'utf8')) : {};
  const starters: Record<string, string> = state.init_templates ?? {};
  const generated: string[] = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : [];
  const sha = (f: string) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const toDelete: string[] = [];
  const yours: string[] = [];
  for (const f of moduleFiles()) {
    if (generated.includes(f.slice('tgcloud/'.length))) continue;
    if (starters[f]?.replace(/^sha256:/, '') === sha(f)) toDelete.push(f);
    else yours.push(f);
  }
  if (yours.length) {
    throw new InitError(
      `tgcloud/ has code tgcloud-grammy would turn into build output:\n  ${yours.join('\n  ')}\n` +
      'Move it to src/ as TypeScript (e.g. tgcloud/lib/x.js → src/lib/x.ts), delete the .js files, then run init again.',
    );
  }

  const done: string[] = [];
  for (const f of toDelete) {
    fs.rmSync(f);
    done.push(`removed ${f} (starter file, replaced by src/)`);
  }

  const copy = (rel: string, to = rel) => {
    if (fs.existsSync(to)) return;
    fs.mkdirSync(path.dirname(to) || '.', { recursive: true });
    fs.copyFileSync(path.join(TEMPLATES, rel), to);
    done.push(`created ${to}`);
  };
  copy('tsconfig.json');
  // The starter bot only if there's no source yet: never mix it into existing code.
  if (!fs.existsSync('src/handlers') && !fs.existsSync('src/endpoints')) {
    copy('src/lib/bot.ts');
    copy('src/handlers/message.ts');
  }
  copy('src/schema.ts');

  // Scripts: build before every deploy. An existing deploy (e.g. "vite build && tgcloud push")
  // keeps its own steps, with the bot build put in front of the push.
  const pkgText = fs.readFileSync('package.json', 'utf8');
  const pkg = JSON.parse(pkgText);
  const scripts: Record<string, string> = (pkg.scripts ??= {});
  const deploy = scripts.deploy ?? 'tgcloud push';
  if (!deploy.includes('tgcloud-grammy build')) {
    scripts.deploy = deploy.includes('tgcloud push')
      ? deploy.replace('tgcloud push', 'tsc && tgcloud-grammy build && tgcloud push')
      : `${deploy} && tsc && tgcloud-grammy build && tgcloud push`;
  }
  scripts.build ??= 'tgcloud-grammy build';
  scripts.typecheck ??= 'tsc';
  if (JSON.stringify(pkg) !== JSON.stringify(JSON.parse(pkgText))) {
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
    done.push('updated package.json scripts (build, typecheck, deploy)');
  }

  // AGENTS.md is what coding agents read first: it must say to edit src/, not tgcloud/.
  if (fs.existsSync('AGENTS.md')) {
    const agents = fs.readFileSync('AGENTS.md', 'utf8');
    if (!agents.includes(AGENTS_MARKER)) {
      const section = fs.readFileSync(path.join(TEMPLATES, 'AGENTS.ts.md'), 'utf8');
      const at = agents.indexOf('\n## ');
      fs.writeFileSync('AGENTS.md', at < 0 ? `${agents}\n${section}` : `${agents.slice(0, at + 1)}${section}${agents.slice(at + 1)}`);
      done.push('updated AGENTS.md (TypeScript workflow)');
    }
  }

  // Leave tgcloud/ consistent with src/ right away.
  execSync(`"${process.execPath}" "${process.argv[1]}" build`, { stdio: 'inherit' });
  return done;
}
