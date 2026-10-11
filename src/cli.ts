#!/usr/bin/env node
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { init, InitError } from './init.js';

const USAGE = `Usage:
  tgcloud-grammy init [--github-actions]                  set up TypeScript + grammY in this folder
                                                          (--github-actions: deploy on every push to main)
  tgcloud-grammy build [--src src] [--out tgcloud] [--minify]

Compiles a TypeScript bot into the plain-JS modules the tgcloud CLI deploys:
  src/handlers/<update_type>.ts  -> tgcloud/handlers/<update_type>.js
  src/endpoints/<name>.ts        -> tgcloud/endpoints/<name>.js
  src/schema.ts                  -> tgcloud/schema.js
  npm packages                   -> tgcloud/lib/vendor/<package>.js
  code shared by your modules    -> tgcloud/lib/chunks/*.js
Then deploy with \`npx tgcloud push\`.`;

const CODE_DIRS = ['handlers', 'endpoints', 'lib'];
const MANIFEST = '.tgcloud-grammy.json';
const SCHEMA_PLACEHOLDER = '__tgcloud_grammy_schema__';
const VENDOR_PLACEHOLDER = '__tgcloud_grammy_vendor__:';
const ENDPOINT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SOURCE_EXT = /\.(ts|mts|js|mjs)$/;

class BuildError extends Error {}

/**
 * The names each package is imported with, read from the first pass's output
 * (esbuild prints imports in a fixed form). `'all'` for `import * as ns`.
 */
function usedVendorNames(outputs: Map<string, string>, specs: string[]): Map<string, Set<string> | 'all'> {
  const used = new Map<string, Set<string> | 'all'>(specs.map((s) => [s, new Set<string>()]));
  for (const text of outputs.values()) {
    for (const spec of specs) {
      const from = JSON.stringify(VENDOR_PLACEHOLDER + spec).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  return ['schema.ts', 'schema.mts', 'schema.js', 'schema.mjs']
    .map((f) => path.join(srcDir, f))
    .find((f) => fs.existsSync(f));
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

  const entries = [
    ...listSources(path.join(srcDir, 'handlers')),
    ...listSources(path.join(srcDir, 'endpoints')),
  ];
  for (const file of listSources(path.join(srcDir, 'endpoints'))) {
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
    target: 'es2022',
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

  // The platform reads tables from schema.js itself, so it stays a standalone
  // module and code that imports it is pointed at that file, never a copy.
  const schemaPath = schema?.replace(SOURCE_EXT, '');
  const externalSchema: esbuild.Plugin = {
    name: 'external-schema',
    setup(b) {
      b.onResolve({ filter: /schema(\.(ts|mts|js|mjs))?$/ }, (args) => {
        if (!schemaPath || !args.path.startsWith('.')) return;
        return path.resolve(args.resolveDir, args.path).replace(SOURCE_EXT, '') === schemaPath
          ? { path: SCHEMA_PLACEHOLDER, external: true }
          : undefined;
      });
    },
  };

  // npm packages are built in their own pass into lib/vendor/, and your code
  // imports them from there. They stay out of handlers, and their files don't
  // change (or get re-uploaded) when only your code changes.
  const vendor = new Map<string, string>(); // import specifier -> resolved file
  const externalVendor: esbuild.Plugin = {
    name: 'external-vendor',
    setup(b) {
      b.onResolve({ filter: /^[^./]/ }, async (args) => {
        if (args.pluginData?.vendor || args.path === 'sdk' || args.path.startsWith('sdk/') || path.isAbsolute(args.path)) return;
        const r = await b.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, pluginData: { vendor: true } });
        if (r.errors.length) return { errors: r.errors };
        vendor.set(args.path, r.path);
        return { path: VENDOR_PLACEHOLDER + args.path, external: true };
      });
    },
  };
  // Module names on the platform: keep to letters, digits, `_`, `-` and `/`.
  const vendorFile = (spec: string) => `lib/vendor/${spec.replace(/^@/, '').replace(/[^A-Za-z0-9_/-]/g, '_')}.js`;

  try {
    if (entries.length) {
      collect(await esbuild.build({
        ...common,
        entryPoints: entries,
        outbase: srcDir,
        outdir: outDir,
        entryNames: '[dir]/[name]',
        splitting: true,
        chunkNames: 'lib/chunks/[name]-[hash]',
        plugins: [externalSchema, externalVendor],
      }));
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
      collect(await esbuild.build({
        ...common,
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
      collect(await esbuild.build({ ...common, entryPoints: [schema], outfile: path.join(outDir, 'schema.js') }));
    }
  } catch (e) {
    const errors = (e as esbuild.BuildFailure).errors;
    if (!errors) throw e;
    const text = (await esbuild.formatMessages(errors, { kind: 'error' })).join('\n');
    const hint = /Could not resolve "(node:|fs|path|crypto|buffer|stream|http)/.test(text)
      ? '\nThe tgcloud runtime has no Node.js built-ins; use a package that runs in browsers or Workers, or `fetch` from `sdk`.'
      : '';
    throw new BuildError(text + hint);
  }

  // Point placeholder imports at the real files, relative to each importer.
  const targets = new Map([[SCHEMA_PLACEHOLDER, 'schema.js']]);
  for (const spec of vendor.keys()) targets.set(VENDOR_PLACEHOLDER + spec, vendorFile(spec));
  for (const [rel, text] of outputs) {
    let out = text;
    for (const [placeholder, target] of targets) {
      let to = path.posix.relative(path.posix.dirname(rel), target);
      if (!to.startsWith('.')) to = `./${to}`;
      out = out.replaceAll(JSON.stringify(placeholder), JSON.stringify(to));
    }
    outputs.set(rel, out);
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
  if (values.help || !['build', 'init'].includes(positionals[0])) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 1);
  }
  try {
    if (positionals[0] === 'init') {
      for (const line of init({ githubActions: values['github-actions'] })) console.log(`  ${line}`);
      console.log('TypeScript project ready: write code in src/, deploy with `npm run deploy`.');
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
