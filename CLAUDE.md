# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project goal

A TypeScript SDK for the **Telegram Serverless Bot Platform**. The platform runs bots as plain JavaScript with no way to install packages. This library lets bot authors write in TypeScript and use third-party npm packages anyway, then ship the result to the platform.

Because the platform only accepts plain JS, everything a bot uses (this SDK plus its npm dependencies) must end up as self-contained JavaScript the platform can run. Keep that constraint in mind for every API and build decision.

The project is **AI-first**: most bots on this platform are written by AI agents. Optimize the public API for that reader. Prefer explicit, strongly typed, discoverable APIs and doc comments that say what a call does and what constraints apply, so an agent can use the SDK correctly from types and docs alone.

## Platform contract

A tgcloud project deploys ES modules from `tgcloud/`:
- `handlers/<update_type>.js` and `endpoints/<name>.js`, both flat
- `lib/**`
- `schema.js`

Each module's `export default (payload, ctx)` is invoked by the platform. Modules can import only each other (relative `.js` paths) and the virtual `sdk`, `sdk/db`, `sdk/api` and `sdk/fetch`. The runtime is a bare V8 isolate (ES2025-level JavaScript). Globals beyond ECMAScript: `console`, `TextEncoder`, `TextDecoder`, `crypto` (incl. `subtle`), `WebAssembly`. It has no `fetch` (that comes from `sdk`), no timers, no `URL`, no `atob`/`btoa`, no `Buffer`/`process`, and no dynamic `import()`. This was probed on a real bot on 2026-10-11; the list is in `types/sdk.d.ts`. Deployment and execution go through the platform's `@tgcloud/cli` (`npx tgcloud push|run|migrate`); there is no local runtime. Reference: https://core.telegram.org/bots/serverless and the `docs/tgcloud-sdk.md` that `npm create @tgcloud/bot` scaffolds.

Verified on a real bot with `tgcloud run`: a grammY bundle built by this package loads and works there. Not yet verified: size, CPU and time limits; whether module state survives between invocations; whether a handler that throws makes Telegram redeliver the update, and whether `schema.js` is evaluated or parsed.

## Layout

- `types/sdk.d.ts`: hand-written ambient typings for the platform's `sdk` modules (exported as `@aiogram/tgcloud-grammy/sdk`). Declare only what the platform documents or what was probed on it.
- `src/index.ts`: `defineHandler`, `defineEndpoint` and context types.
- `src/grammy.ts`: grammY adapter (`createBot`, `toHandler`, `dbStorage`).
  - An API transformer sends every call through `sdk.api`.
  - grammY's global `fetch` is stubbed.
- `src/cli.ts`: `tgcloud-grammy build`.
  - esbuild bundles `src/{handlers,endpoints}`; shared user code is split into `lib/chunks`, and `sdk` stays external.
  - Bare imports (npm packages) become placeholders. A second pass builds them into `lib/vendor/<spec>.js` with shared chunks in `lib/vendor/chunks`, so grammY exists once. Each vendor entry is a virtual module re-exporting only the names the first pass's output imports (`usedVendorNames`), which keeps tree-shaking. Placeholders are then rewritten to relative paths.
  - `schema` is built as its own module and imported by path, never inlined.
  - Dynamic `import()` fails the build.
  - A manifest stops it deleting modules it didn't write.
- `src/init.ts`: `tgcloud-grammy init`. Runs `tgcloud init` if needed, then copies `templates/` (never overwriting). It deletes a `tgcloud/` module only if its sha256 matches `init_templates` in `.tgcloud/state.json`, and refuses if any other code is there. It also sets the scripts, adds the `templates/AGENTS.ts.md` section to `AGENTS.md`, and builds.
- `create/`: the separate `@aiogram/create-tgcloud-grammy` package behind `npm create @aiogram/tgcloud-grammy <dir>`. Node built-ins only. It installs the tools, then runs `tgcloud-grammy init`, makes a git commit and offers a login. Set `TGCLOUD_GRAMMY_PACKAGE=/path/to/aiogram-tgcloud-grammy-x.y.z.tgz` to test it against an unpublished build.
- `tsconfig.bot.json`: tsconfig preset for bot projects (exported as `@aiogram/tgcloud-grammy/tsconfig.json`).

## Commands

- `npm install`: install dependencies
- `npm run build`: compile `src/` to `dist/` (ESM, NodeNext). `tsconfig.json` checks runtime code against the platform's globals only (no Node, no DOM); `tsconfig.cli.json` builds `src/cli.ts` with Node types.
- `npm test`: build, then run `test/build.test.mjs`. It has three tests:
  - type-check `test/fixture` against the typings (`@ts-expect-error` lines assert rejections);
  - build the fixture with the CLI and run it through `test/run-bundle.mjs` against `test/mock-sdk`, with web globals deleted;
  - `init` on a fake `tgcloud init` project: starter files are replaced, hand-written modules are refused.
- Single test: `node --test --test-name-pattern "type-checks" test/build.test.mjs` (after `npm run build`)
