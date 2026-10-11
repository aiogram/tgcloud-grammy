## This project is TypeScript + grammY: edit `src/`, never `tgcloud/`

The bot is written in TypeScript under `src/` and compiled by
[`@aiogram/tgcloud-grammy`](node_modules/@aiogram/tgcloud-grammy/README.md) into `tgcloud/`. Everything in
`tgcloud/` is **generated**: edits there are overwritten by the next build. The
rest of this file describes the platform and the generated `tgcloud/` layout;
its rules (no npm at runtime, no Node built-ins, relative imports with `.js`)
apply to `src/` too.

| Source | Builds to | What it is |
|---|---|---|
| `src/lib/bot.ts` | (bundled) | The grammY bot: commands and handlers. |
| `src/handlers/<type>.ts` | `tgcloud/handlers/<type>.js` | One line per update type the bot receives: `export default toHandler(bot, '<type>')`. To receive e.g. `callback_query`, add `src/handlers/callback_query.ts`. |
| `src/endpoints/<name>.ts` | `tgcloud/endpoints/<name>.js` | Mini App backend: `export default defineEndpoint(...)` from `@aiogram/tgcloud-grammy`. |
| `src/schema.ts` | `tgcloud/schema.js` | Database tables. |
| npm packages | `tgcloud/lib/vendor/` | Bundled at build time; only what you import. |

- Bot API: grammY's `ctx.reply(...)`, `ctx.api.*`, routed through the
  platform's `api` (no token needed). The platform `sdk` (`db`, `fetch`, …) is
  typed: `import { db, fetch } from 'sdk'`.
- Globals: only `console`, `TextEncoder`/`TextDecoder`, `crypto`. **No**
  `setTimeout`, `URL`, `atob`, `Buffer`, global `fetch`, or dynamic `import()`;
  `npm run typecheck` flags them.
- npm packages that need Node.js built-ins fail the build.

```
npm run typecheck   # tsc
npm run build       # src/ → tgcloud/
npx tgcloud run handlers/message '{ chat: { id: 1, type: "private" }, from: { id: 1, is_bot: false, first_name: "U" }, text: "hi", message_id: 1, date: 0 }'
npm run deploy      # typecheck + build + tgcloud push
```

