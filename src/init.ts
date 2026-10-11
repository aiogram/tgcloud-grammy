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
 *
 * With `githubActions`, also adds `.github/workflows/deploy.yml`, which deploys
 * the bot on every push to main.
 */
export function init(opts: { githubActions?: boolean } = {}): string[] {
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
  if (opts.githubActions) copy('github-deploy.yml', '.github/workflows/deploy.yml');

  // Scripts: tgcloud/ is gitignored build output, so every command that reads it
  // builds first. An existing script (e.g. "vite build && tgcloud push") keeps its
  // own steps, with the bot build put in front of the tgcloud command.
  const pkgText = fs.readFileSync('package.json', 'utf8');
  const pkg = JSON.parse(pkgText);
  const scripts: Record<string, string> = (pkg.scripts ??= {});
  const buildBefore = (name: string, command: string, build: string) => {
    const current = scripts[name] ?? command;
    if (current.includes('tgcloud-grammy build')) return;
    scripts[name] = current.includes(command) ? current.replace(command, `${build} && ${command}`) : `${current} && ${build} && ${command}`;
  };
  buildBefore('deploy', 'tgcloud push', 'tsc && tgcloud-grammy build');
  buildBefore('status', 'tgcloud status', 'tgcloud-grammy build');
  buildBefore('run', 'tgcloud run', 'tgcloud-grammy build');
  scripts.build ??= 'tgcloud-grammy build';
  scripts.typecheck ??= 'tsc';
  if (JSON.stringify(pkg) !== JSON.stringify(JSON.parse(pkgText))) {
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
    done.push('updated package.json scripts (build, typecheck, deploy, status, run)');
  }

  // tgcloud/ is generated from src/: keep it out of git, like dist/.
  const gitignore = fs.existsSync('.gitignore') ? fs.readFileSync('.gitignore', 'utf8') : '';
  if (!/^\/?tgcloud\/?$/m.test(gitignore)) {
    const sep = gitignore && !gitignore.endsWith('\n') ? '\n' : '';
    fs.writeFileSync('.gitignore', `${gitignore}${sep}# Generated from src/ by tgcloud-grammy build\n/tgcloud/\n`);
    done.push('added /tgcloud/ to .gitignore');
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

// Endpoint names become `POST /api/<name>`.
export const ENDPOINT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MODULE_DIRS = ['handlers', 'endpoints', 'lib'];
const SEGMENT = /^[A-Za-z0-9_-]+$/; // what `tgcloud add` allows per path segment

/** Update types the platform accepts: its cached descriptor, else grammY's list. */
async function updateTypes(): Promise<readonly string[] | undefined> {
  try {
    const caps = JSON.parse(fs.readFileSync('.tgcloud/capabilities.json', 'utf8'));
    const names = caps.directories?.find((d: { name?: string }) => d.name === 'handlers')?.allowed_names;
    if (Array.isArray(names) && names.length) return names;
  } catch {
    // Not fetched yet (`tgcloud` commands refresh it): fall back to grammY.
  }
  // The web build loads in Node without the Node build's warnings. Without
  // grammY, names aren't checked here, and tsc rejects a typo instead.
  return import('grammy/web').then((m) => m.API_CONSTANTS.ALL_UPDATE_TYPES, () => undefined);
}

/**
 * `tgcloud add` for `src/`: takes the same targets (`handlers/<update_type>`,
 * `endpoints/<name>`, `lib/<path>`) and writes the TypeScript starter instead.
 * A handler passes updates to the grammY bot when `src/lib/bot.ts` exists, and
 * is a `defineHandler` stub otherwise. Existing files are kept.
 */
export async function add(targets: string[], srcDir = 'src'): Promise<string[]> {
  if (!targets.length) throw new InitError('Name the module: tgcloud-grammy add handlers/<update_type> | endpoints/<name> | lib/<name>');
  const types = await updateTypes();
  const bot = fs.existsSync(path.join(srcDir, 'lib/bot.ts'));

  // Check every target before writing any.
  const modules = targets.map((target) => {
    const [dir, ...rest] = target.replace(/^(src|tgcloud)\//, '').replace(/\.(ts|js)$/, '').replace(/\/+$/, '').split('/');
    const name = rest.join('/');
    if (!MODULE_DIRS.includes(dir)) throw new InitError(`Unknown directory "${dir}" in ${target}. Add modules under handlers/, endpoints/ or lib/.`);
    if (!name) {
      const free = dir === 'handlers' ? types?.filter((t) => !fs.existsSync(path.join(srcDir, 'handlers', `${t}.ts`))) ?? [] : [];
      throw new InitError(`Specify a name, e.g. "${dir}/${free[0] ?? 'name'}".${free.length ? ` Available: ${free.join(', ')}.` : ''}`);
    }
    if (dir !== 'lib' && rest.length > 1) throw new InitError(`${dir}/ is flat: use a single name, not "${name}".`);
    if (!rest.every((s) => SEGMENT.test(s))) throw new InitError(`Invalid module name "${name}": use letters, digits, _ and -.`);
    if (dir === 'handlers' && types && !types.includes(name)) {
      throw new InitError(`"${name}" is not an update type. Allowed: ${types.join(', ')}.`);
    }
    if (dir === 'endpoints' && !ENDPOINT_NAME.test(name)) {
      throw new InitError(`Endpoint name "${name}" is invalid: use letters, digits and _, not starting with a digit.`);
    }
    return { dir, name, file: path.join(srcDir, dir, `${name}.ts`) };
  });

  const starter = (dir: string, name: string) => {
    if (dir === 'handlers') {
      return bot
        ? `import { toHandler } from '@aiogram/tgcloud-grammy/grammy';\nimport { bot } from '../lib/bot.js';\n\nexport default toHandler(bot, '${name}');\n`
        : `import { defineHandler } from '@aiogram/tgcloud-grammy';\n\nexport default defineHandler('${name}', async (payload, ctx) => {\n  // payload is update.${name}; ctx.update is the whole update.\n});\n`;
    }
    if (dir === 'endpoints') {
      return `import { defineEndpoint } from '@aiogram/tgcloud-grammy';\n\n` +
        `// POST /api/${name} from the Mini App. ctx.initData is verified by the platform;\n` +
        `// input comes from the client, so validate it. Refuse with \`throw new EndpointError(...)\` from 'sdk'.\n` +
        `export default defineEndpoint(async (input, ctx) => {\n  return {};\n});\n`;
    }
    return `// Shared code. Import it from a handler as '../lib/${name}.js'.\nexport {};\n`;
  };

  const done: string[] = [];
  for (const { dir, name, file } of modules) {
    if (fs.existsSync(file)) {
      done.push(`${file} exists, kept`);
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, starter(dir, name));
    done.push(`created ${file}`);
  }
  const handler = modules.find((m) => m.dir === 'handlers');
  if (bot && handler) done.push(`Handle it in ${path.join(srcDir, 'lib/bot.ts')}, e.g. bot.on('${handler.name}', (ctx) => …)`);
  return done;
}
