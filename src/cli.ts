#!/usr/bin/env node
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { parseArgs } from 'node:util';
import { add, ENDPOINT_NAME, init, InitError } from './init.js';

const USAGE = `Usage:
  tgcloud-grammy init [--github-actions]                  set up TypeScript + grammY in this folder
                                                          (--github-actions: deploy on every push to main)
  tgcloud-grammy add <dir>/<name>... [--src src]         \`tgcloud add\` for src/: writes the TypeScript starter of
                                                          handlers/<update_type>, endpoints/<name> or lib/<path>
  tgcloud-grammy build [--src src] [--out tgcloud] [--minify]
                                                          (--minify: your code too; npm packages always are)

Compiles a TypeScript bot into the plain-JS modules the tgcloud CLI deploys:
  src/handlers/<update_type>.ts  -> tgcloud/handlers/<update_type>.js
  src/endpoints/<name>.ts        -> tgcloud/endpoints/<name>.js
  src/lib/**/*.ts                -> tgcloud/lib/**/*.js (the files your modules import)
  src/schema.ts                  -> tgcloud/schema.js
  npm packages                   -> tgcloud/lib/vendor/<package>.js
Then deploy with \`npx tgcloud push\`.`;

const CODE_DIRS = ['handlers', 'endpoints', 'lib'];
const MANIFEST = '.tgcloud-grammy.json';
// `import "__tgcloud_grammy__:lib/bot.js"`: an import of that output file, made
// relative to each importer once every output's location is known.
const PLACEHOLDER = '__tgcloud_grammy__:';
// The update type in `toHandler(bot, 'message')` or `defineHandler('message', …)`.
const HANDLER_TYPE = /(?:\btoHandler\s*\([^,()]*,|\bdefineHandler\s*\()\s*['"`](\w+)['"`]/g;
const EXTENSIONS = ['ts', 'mts', 'js', 'mjs'];
const SOURCE_EXT = new RegExp(`\\.(${EXTENSIONS.join('|')})$`);

class BuildError extends Error {}

/**
 * The names each package is imported with, read from the first pass's output
 * (esbuild prints imports in a fixed form). `'all'` for `import * as ns`.
 */
function usedVendorNames(outputs: Map<string, string>, specs: string[]): Map<string, Set<string> | 'all'> {
  const used = new Map<string, Set<string> | 'all'>(specs.map((s) => [s, new Set<string>()]));
  for (const text of outputs.values()) {
    for (const spec of specs) {
      const from = JSON.stringify(PLACEHOLDER + vendorFile(spec)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (const [, clause] of text.matchAll(new RegExp(`\\b(?:import|export)\\s*([^;"'\`]*?)\\s*from\\s*${from}`, 'g'))) {
        const names = used.get(spec);
        if (names === 'all') continue;
        if (clause.includes('*')) {
          used.set(spec, 'all');
          continue;
        }
        const braces = clause.match(/\{([^}]*)\}/);
        if (!clause.trimStart().startsWith('{')) names!.add('default'); // `import x` / `import x, { … }`
        for (const item of braces?.[1].split(',') ?? []) {
          const name = item.trim().split(/\s+as\s+/)[0];
          if (name) names!.add(name);
        }
      }
    }
  }
  return used;
}

function listSources(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && SOURCE_EXT.test(e.name) && !e.name.endsWith('.d.ts'))
    .map((e) => path.join(dir, e.name));
}

function findSchema(srcDir: string): string | undefined {
  return EXTENSIONS.map((ext) => path.join(srcDir, `schema.${ext}`)).find((f) => fs.existsSync(f));
}

/**
 * Where a source file is deployed (`src/lib/bot.ts` -> `lib/bot.js`), or
 * undefined for files outside the platform's layout, which are bundled into
 * the modules that import them.
 */
function outputPath(srcDir: string, file: string): string | undefined {
  const rel = path.relative(srcDir, file).split(path.sep).join('/');
  if (!SOURCE_EXT.test(rel) || rel.endsWith('.d.ts')) return;
  if (/^(handlers|endpoints)\/[^/]+$|^lib\/|^schema\.[^/]+$/.test(rel)) return rel.replace(SOURCE_EXT, '.js');
}

// Module names on the platform: keep to letters, digits, `_`, `-` and `/`.
function vendorFile(spec: string): string {
  return `lib/vendor/${spec.replace(/^@/, '').replace(/[^A-Za-z0-9_/-]/g, '_')}.js`;
}

/** `.js` files the build would overwrite or delete, relative to `outDir`. */
function existingOutputs(outDir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    const abs = path.join(outDir, rel);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = path.posix.join(rel, e.name);
      if (e.isDirectory()) walk(child);
      else if (e.name.endsWith('.js')) out.push(child);
    }
  };
  CODE_DIRS.forEach(walk);
  if (fs.existsSync(path.join(outDir, 'schema.js'))) out.push('schema.js');
  return out;
}

async function build(opts: { src: string; out: string; minify?: boolean }): Promise<string[]> {
  const srcDir = path.resolve(opts.src);
  const outDir = path.resolve(opts.out);

  const handlers = listSources(path.join(srcDir, 'handlers'));
  const endpoints = listSources(path.join(srcDir, 'endpoints'));
  const entries = [...handlers, ...endpoints];
  // The platform routes by file name, so handlers/message.ts with toHandler(bot, 'callback_query')
  // would get messages typed as callback queries. ponytail: a source regex, misses aliased imports.
  for (const file of handlers) {
    const name = path.basename(file).replace(SOURCE_EXT, '');
    for (const [, type] of fs.readFileSync(file, 'utf8').matchAll(HANDLER_TYPE)) {
      if (type !== name) {
        throw new BuildError(`${opts.src}/handlers/${path.basename(file)} handles "${type}", but the platform calls it for "${name}" (its file name). Rename the file or change the type.`);
      }
    }
  }
  for (const file of endpoints) {
    const name = path.basename(file).replace(SOURCE_EXT, '');
    if (!ENDPOINT_NAME.test(name)) {
      throw new BuildError(`Endpoint name "${name}" is invalid: use letters, digits and _, not starting with a digit.`);
    }
  }
  const schema = findSchema(srcDir);
  if (!entries.length && !schema) {
    throw new BuildError(`Nothing to build: no ${opts.src}/handlers/*.ts, ${opts.src}/endpoints/*.ts or ${opts.src}/schema.ts.`);
  }

  const common: esbuild.BuildOptions = {
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'es2025',
    // Prefer builds made for V8 isolates (Cloudflare Workers), then browsers.
    conditions: ['workerd', 'worker', 'browser'],
    mainFields: ['module', 'main'],
    external: ['sdk', 'sdk/*'],
    minify: opts.minify,
    metafile: true,
    logLevel: 'silent',
  };

  const outputs = new Map<string, string>(); // path relative to outDir -> contents
  const collect = (result: esbuild.BuildResult) => {
    // The runtime rejects `import()` ("Not supported"), including the chunks
    // esbuild would emit for it, so fail here instead of on the first call.
    const dynamic = Object.entries(result.metafile!.inputs).flatMap(([input, info]) =>
      info.imports.filter((i) => i.kind === 'dynamic-import').map((i) => `  ${input} -> import(${JSON.stringify(i.original ?? i.path)})`));
    if (dynamic.length) {
      throw new BuildError(`The tgcloud runtime does not support dynamic import(). Use static imports instead:\n${dynamic.join('\n')}`);
    }
    for (const f of result.outputFiles ?? []) outputs.set(path.relative(outDir, f.path).split(path.sep).join('/'), f.text);
  };

  // Your modules keep their own files (src/lib/bot.ts -> lib/bot.js) and import
  // each other, so a stack trace names your file and an edit changes only it.
  // npm packages are built in their own pass into lib/vendor/, so they stay out
  // of your files and don't change (or get re-uploaded) when only your code does.
  const sources = new Set(entries); // grows with the lib/ files your modules import
  const vendor = new Map<string, string>(); // import specifier -> resolved file
  const modules: esbuild.Plugin = {
    name: 'modules',
    setup(b) {
      b.onResolve({ filter: /.*/ }, async (args) => {
        if (args.kind === 'entry-point' || args.pluginData?.resolving || args.path === 'sdk' || args.path.startsWith('sdk/')) return;
        const r = await b.resolve(args.path, { kind: args.kind, importer: args.importer, resolveDir: args.resolveDir, pluginData: { resolving: true } });
        if (r.errors.length) return { errors: r.errors };
        if (r.external) return;
        const target = outputPath(srcDir, r.path);
        if (target) {
          // The platform reads tables from schema.js itself, so it is built on its own below.
          if (r.path !== schema) sources.add(r.path);
          return { path: PLACEHOLDER + target, external: true };
        }
        if (/^[^./]/.test(args.path) && !path.isAbsolute(args.path)) {
          vendor.set(args.path, r.path);
          return { path: PLACEHOLDER + vendorFile(args.path), external: true };
        }
        // ponytail: other files (outside src/{handlers,endpoints,lib}) are copied into each
        // importer, so one imported by two modules exists twice; move it into src/lib/ if that matters.
      });
    },
  };

  try {
    if (entries.length) {
      // A build can find more of your lib/ files; build again until it finds none.
      let result: esbuild.BuildResult;
      let found: number;
      do {
        found = sources.size;
        result = await esbuild.build({
          ...common,
          entryPoints: [...sources],
          outbase: srcDir,
          outdir: outDir,
          entryNames: '[dir]/[name]',
          plugins: [modules],
        });
      } while (sources.size > found);
      collect(result);
    }
    if (vendor.size) {
      const used = usedVendorNames(outputs, [...vendor.keys()]);
      const files = new Map<string, string>();
      for (const spec of vendor.keys()) {
        const clash = files.get(vendorFile(spec));
        if (clash) throw new BuildError(`Packages "${clash}" and "${spec}" would both be written to ${vendorFile(spec)}.`);
        files.set(vendorFile(spec), spec);
      }
      // One pass for all packages, so code they share (grammY, used by both
      // \`grammy\` and \`@aiogram/tgcloud-grammy/grammy\`) exists once: one copy, one instanceof.
      // Each entry re-exports only the names your code imports, so the rest of
      // the package is tree-shaken away (an entry would otherwise keep every export).
      // Always minified: nobody reads it, and grammY shrinks by about 40%.
      collect(await esbuild.build({
        ...common,
        minify: true,
        entryPoints: [...vendor.keys()].map((spec) => ({ in: `vendor-entry:${spec}`, out: vendorFile(spec).replace(/\.js$/, '') })),
        outdir: outDir,
        splitting: true,
        chunkNames: 'lib/vendor/chunks/[name]-[hash]',
        plugins: [{
          name: 'vendor-entry',
          setup(b) {
            b.onResolve({ filter: /^vendor-entry:/ }, (args) => ({ path: args.path.slice('vendor-entry:'.length), namespace: 'vendor-entry' }));
            b.onLoad({ filter: /.*/, namespace: 'vendor-entry' }, (args) => {
              const file = JSON.stringify(vendor.get(args.path)!);
              const names = used.get(args.path)!;
              const contents = names === 'all' ? `export * from ${file};\nimport * as m from ${file};\nexport default m.default;`
                : names.size ? `export { ${[...names].join(', ')} } from ${file};` : `import ${file};`;
              return { contents, resolveDir: srcDir, loader: 'js' };
            });
          },
        }],
      }));
    }
    if (schema) {
      // Self-contained: anything it imports besides sdk/db is bundled into it.
      collect(await esbuild.build({ ...common, entryPoints: [schema], outfile: path.join(outDir, 'schema.js') }));
    }
  } catch (e) {
    const errors = (e as esbuild.BuildFailure).errors;
    if (!errors) throw e;
    const text = (await esbuild.formatMessages(errors, { kind: 'error' })).join('\n');
    const builtin = new RegExp(`Could not resolve "(node:|(${builtinModules.join('|')})["/])`);
    const hint = builtin.test(text)
      ? '\nThe tgcloud runtime has no Node.js built-ins; use a package that runs in browsers or Workers, or `fetch` from `sdk`.'
      : '';
    throw new BuildError(text + hint);
  }

  // Point placeholder imports at the real files, relative to each importer.
  const placeholder = new RegExp(`"${PLACEHOLDER}([^"]+)"`, 'g');
  for (const [rel, text] of outputs) {
    outputs.set(rel, text.replace(placeholder, (_, target: string) => {
      const to = path.posix.relative(path.posix.dirname(rel), target);
      return JSON.stringify(to.startsWith('.') ? to : `./${to}`);
    }));
  }

  // Never delete files this tool did not write: `push` mirrors tgcloud/ to the
  // cloud, so a stray hand-written module would silently disappear there too.
  const manifestPath = path.join(outDir, MANIFEST);
  const previous: string[] = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : [];
  const foreign = existingOutputs(outDir).filter((f) => !previous.includes(f));
  if (foreign.length) {
    throw new BuildError(
      `${opts.out}/ has modules tgcloud-grammy did not generate:\n  ${foreign.join('\n  ')}\n` +
      `Move their code into ${opts.src}/ (as .ts) or delete them, then build again.`,
    );
  }
  for (const f of previous) {
    fs.rmSync(path.join(outDir, f), { force: true });
    // Drop folders that became empty (e.g. lib/vendor/<package>/ after a package is removed).
    for (let dir = path.dirname(path.join(outDir, f)); dir.startsWith(outDir + path.sep); dir = path.dirname(dir)) {
      if (fs.readdirSync(dir).length) break;
      fs.rmdirSync(dir);
    }
  }
  for (const [rel, text] of outputs) {
    fs.mkdirSync(path.dirname(path.join(outDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(outDir, rel), text);
  }
  const written = [...outputs.keys()].sort();
  fs.writeFileSync(manifestPath, JSON.stringify(written, null, 2) + '\n');
  return written;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      src: { type: 'string', default: 'src' },
      out: { type: 'string', default: 'tgcloud' },
      minify: { type: 'boolean', default: false },
      'github-actions': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || !['build', 'init', 'add'].includes(positionals[0])) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 1);
  }
  try {
    if (positionals[0] === 'init') {
      for (const line of init({ githubActions: values['github-actions'] })) console.log(`  ${line}`);
      console.log('TypeScript project ready: write code in src/, deploy with `npm run deploy`.');
      return;
    }
    if (positionals[0] === 'add') {
      for (const line of await add(positionals.slice(1), values.src)) console.log(`  ${line}`);
      return;
    }
    const written = await build({ src: values.src!, out: values.out!, minify: values.minify });
    for (const f of written) console.log(`  ${path.posix.join(values.out!, f)}`);
    console.log(`Built ${written.length} module${written.length === 1 ? '' : 's'}. Deploy with: npx tgcloud push`);
  } catch (e) {
    if (!(e instanceof BuildError || e instanceof InitError)) throw e;
    console.error(e.message);
    process.exit(1);
  }
}

await main();
