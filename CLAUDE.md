# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project goal

A TypeScript SDK for the **Telegram Serverless Bot Platform**. The platform runs bots as plain JavaScript with no way to install packages. This library lets bot authors write in TypeScript and use third-party npm packages anyway, then ship the result to the platform.

Because the platform only accepts plain JS, everything a bot uses (this SDK plus its npm dependencies) must end up as self-contained JavaScript the platform can run. Keep that constraint in mind for every API and build decision.

The project is **AI-first**: most bots on this platform are written by AI agents. Optimize the public API for that reader. Prefer explicit, strongly typed, discoverable APIs and doc comments that say what a call does and what constraints apply, so an agent can use the SDK correctly from types and docs alone.

## Current state

The project is an empty scaffold: `src/index.ts` is a placeholder, there are no runtime dependencies, and there is no test runner, linter, or bundler yet. Check the platform's actual runtime contract before implementing against it (how a bot's entry point is invoked, which globals or APIs exist, how updates arrive). Don't assume it matches Node.js or a specific serverless provider.

## Commands

- `npm install`: install dependencies
- `npm run build`: compile `src/` to `dist/` with `tsc` (CommonJS, ES2016 target, `strict` on)

When you add tests or linting, add their scripts to `package.json` and list them here, including how to run a single test.
