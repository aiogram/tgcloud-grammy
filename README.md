# @aiogram/tgcloud-grammy

Write [Telegram Serverless](https://core.telegram.org/bots/serverless) (tgcloud) bots in **TypeScript**, with **npm packages** and **[grammY](https://grammy.dev)**.

The platform runs plain-JS ES modules from a `tgcloud/` folder and lets them import nothing except each other and the platform's `sdk`. This package gives you:

- **Typings for the platform's `sdk`**: `api` (every Bot API method typed), `db` (schema DSL and query builder with inferred row types), `fetch`, `InputFile`, `BotApiError`, `EndpointError`.
- **`tgcloud-grammy build`**: compiles `src/**/*.ts` and bundles your npm dependencies into `tgcloud/`, ready for `npx tgcloud push`.
- **`@aiogram/tgcloud-grammy/grammy`**: runs a grammY bot on the platform with no token and no HTTP, plus database-backed grammY sessions.
- **`defineHandler` / `defineEndpoint`**: typed entry points.

## Setup

New project:

```sh
npm create @aiogram/tgcloud-grammy my_bot
```

This creates the official tgcloud project (`tgcloud init`), installs TypeScript, `@aiogram/tgcloud-grammy` and grammY, and adds:
- a starter bot in `src/`
- `tsconfig.json`
- `build` / `typecheck` / `deploy` scripts
- a TypeScript section in `AGENTS.md`
- `/tgcloud/` in `.gitignore`: it's build output, and `npm run deploy` / `status` / `run` rebuild it before each tgcloud command

It also asks whether to add `.github/workflows/deploy.yml`, which deploys the bot on every push to `main`; without a terminal, pass `-- --github-actions`. It then makes an initial git commit (skip it with `-- --no-git`) and offers to run `tgcloud login`.

The workflow:
1. Runs `npm ci`.
2. Runs `tgcloud fetch`. A CI checkout has no `.tgcloud/` state, and the push still fails if someone deployed in between.
3. Runs `npm run deploy`.
4. Runs `tgcloud migrate --safe`, which applies only the changes the CLI classes as safe.

It needs the bot's CLI token as the `TGCLOUD_TOKEN` repository secret (`gh secret set TGCLOUD_TOKEN`). A commented line in it switches to deploying on `v*` tags instead.

Existing tgcloud project:

```sh
npm i -D typescript @aiogram/tgcloud-grammy && npm i grammy
npx tgcloud-grammy init                     # add --github-actions for the deploy workflow
```

`init` never overwrites a file. It deletes only the starter files `tgcloud init` created and nobody edited since; their hashes are in `.tgcloud/state.json`. If `tgcloud/` holds code you wrote, it stops and asks you to move that code to `src/` first. Afterwards `tgcloud/` is build output.

Deploy with `npm run deploy` (typecheck, `tgcloud-grammy build`, `tgcloud push`).

## Layout

| Source | Output | What it is |
|---|---|---|
| `src/handlers/<update_type>.ts` | `tgcloud/handlers/<update_type>.js` | One file per update type you handle: `message`, `callback_query`, `inline_query`, … The platform only sends you update types that have a file. |
| `src/endpoints/<name>.ts` | `tgcloud/endpoints/<name>.js` | Mini App backend: `POST /api/<name>`. |
| `src/schema.ts` | `tgcloud/schema.js` | Database tables as named exports. Built as its own module; code importing it imports the real `schema.js`. |
| `src/lib/**` | `tgcloud/lib/**.js` | Your shared code, one output file per source file, so stack traces name your files. Only files something imports are deployed. Code elsewhere (outside `src/handlers`, `src/endpoints`, `src/lib`) is bundled into each module that imports it. |
| npm packages | `tgcloud/lib/vendor/<package>.js` | Each package you import, built once in its own pass, keeping only the exports you import (tree-shaken) and minified (`--minify` minifies your code too). Never inlined into handlers, and unchanged when only your code changes. |

Each output file's default export is what the platform calls. `handlers/` and `endpoints/` are flat.

## Runtime rules

The runtime is a bare V8 isolate (ES2025-level JavaScript), not Node.js and not a browser. Measured on the platform:

- **Available:**
  - `console`, `TextEncoder`, `TextDecoder`
  - `crypto` (`subtle`, `getRandomValues`, `randomUUID`)
  - `WebAssembly`, `Intl`
- **Missing:**
  - `fetch` (import it from `sdk`)
  - timers (`setTimeout`, `setInterval`, `queueMicrotask`)
  - `structuredClone`, `URL`, `URLSearchParams`, `atob`/`btoa`
  - `AbortController`, `Blob`, `Headers`, `ReadableStream`
  - `process`, `Buffer`

  The typings declare only what exists, so using a missing global is a type error.
- **No dynamic `import()`.** The build rejects it.
- **No Node built-ins** (`fs`, `path`, …). A package that imports them fails at build time.
- **Network access only through `fetch` from `sdk`.**
- **No secrets/env API** is documented by the platform yet.

## Handlers without grammY

```ts
// src/handlers/message.ts
import { api } from 'sdk';
import { defineHandler } from '@aiogram/tgcloud-grammy';

export default defineHandler('message', async (message, ctx) => {
  // message: Message, ctx.update: the full Update
  await api.sendMessage({ chat_id: message.chat.id, text: `You said: ${message.text ?? ''}` });
});
```

`api.<method>(params)` returns the unwrapped result and throws `BotApiError` (`.code`, `.description`, `.parameters`) on failure.

## grammY

Write the bot as in the [grammY docs](https://grammy.dev/guide/); only its creation and the per-update-type entry files differ.

```ts
// src/lib/bot.ts
import { createBot } from '@aiogram/tgcloud-grammy/grammy';

export const bot = createBot();
bot.command('start', (ctx) => ctx.reply('Hi!'));
bot.on('message:text', (ctx) => ctx.reply(ctx.message.text));
bot.callbackQuery('ping', (ctx) => ctx.answerCallbackQuery('pong'));
```

```ts
// src/handlers/message.ts
import { toHandler } from '@aiogram/tgcloud-grammy/grammy';
import { bot } from '../lib/bot.js';

export default toHandler(bot, 'message');   // src/handlers/callback_query.ts: toHandler(bot, 'callback_query')
```

Each update type the bot handles needs its own one-line handler file: the platform sends only update types that have one. `npx tgcloud-grammy add handlers/callback_query` writes one. It takes the same targets as `tgcloud add` and writes TypeScript into `src/`: `handlers/<update_type>`, `endpoints/<name>`, `lib/<path>`. The build fails if a handler's type and its file name disagree.

- **API calls** go through the platform's `api`. Failures become grammY's usual `GrammyError`.
- **Files:**
  - `InputFile` works with bytes, streams and URLs. A URL is passed to Telegram, which downloads it.
  - File paths throw, because there is no filesystem.
- **Bot info:** `createBot({ botInfo })` skips the `getMe` call grammY makes once per cold start.
- **Errors:** without `bot.catch`, errors are logged and rethrown, as in grammY.

### Sessions

[grammY sessions](https://grammy.dev/plugins/session) stored in the bot's database:

```ts
// src/schema.ts
import { table, text, json } from 'sdk/db';
export const sessions = table('sessions', { key: text().primaryKey(), value: json().notNull() });
```

```ts
import { session, type Context, type SessionFlavor } from 'grammy';
import { createBot, dbStorage } from '@aiogram/tgcloud-grammy/grammy';
import { sessions } from '../schema.js';

const bot = createBot<Context & SessionFlavor<{ count: number }>>();
bot.use(session({ initial: () => ({ count: 0 }), storage: dbStorage(sessions) }));
```

Run `npx tgcloud migrate` after deploying a schema change.

## Database

```ts
// src/schema.ts
import { table, integer, text, boolean, index } from 'sdk/db';

export const todos = table('todos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  text: text('text').notNull(),
  done: boolean('done').default(false),
}, (t) => ({ byUser: index('idx_todos_user').on(t.userId) }));
```

```ts
import { db } from 'sdk';
import { eq, and, type InferSelect } from 'sdk/db';
import { todos } from '../schema.js';

type Todo = InferSelect<typeof todos>; // { id: number; userId: number; text: string; done: boolean | null }
await db.insert(todos).values({ userId: 1, text: 'Buy milk' });
const open: Todo[] = await db.select().from(todos).where(and(eq(todos.userId, 1), eq(todos.done, false)));
```

- **Every query is async.** Always `await` it.
- **No foreign keys.** The typings don't offer them.
- **Dropping** a column or table works only through `.deprecated('reason')`.

## Endpoints

```ts
// src/endpoints/getProfile.ts
import { EndpointError } from 'sdk';
import { defineEndpoint } from '@aiogram/tgcloud-grammy';

export default defineEndpoint<{ lang: string }, { hello: string }>(async (input, ctx) => {
  const user = ctx.initData.user; // verified by the platform
  if (!user) throw new EndpointError('Not allowed', { code: 'NO_USER' });
  return { hello: user.first_name };
});
```

`input` comes from the client, so validate it before trusting it; the type parameter does not check anything at runtime. Return plain JSON data: a `Date` (e.g. a `timestamp` column) arrives at the Mini App as `{}`, so send `date.getTime()`.

## Testing on the platform

`npx tgcloud run handlers/message '{ chat: { id: 1 }, text: "hi" }'` runs your built modules in the cloud without deploying. Run `tgcloud-grammy build` first.
