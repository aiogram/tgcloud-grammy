import { Bot, InputFile as GrammyInputFile, type BotConfig, type Context, type StorageAdapter, type Transformer } from 'grammy';
import type { Update } from '@grammyjs/types';
import type { UpdatePayload, UpdateType } from './index.js';
import { api, BotApiError, InputFile, db } from 'sdk';
import { eq, type Column, type Table } from 'sdk/db';

/**
 * Routes every grammY API call through the platform's `sdk.api` instead of
 * HTTP. Platform errors become grammY's `GrammyError`, as with a real request.
 */
export const tgcloudTransformer: Transformer = async (_prev, method, payload) => {
  try {
    const call = (api as unknown as Record<string, (params: unknown) => Promise<unknown>>)[method];
    const result = await call(await convertFiles(payload));
    return { ok: true, result } as never;
  } catch (e) {
    if (e instanceof BotApiError) {
      return { ok: false, error_code: e.code, description: e.description, parameters: e.parameters ?? {} };
    }
    throw e;
  }
};

/** Replaces grammY `InputFile`s (at any depth) with the platform's. */
async function convertFiles(value: unknown): Promise<unknown> {
  if (value instanceof GrammyInputFile) return toSdkFile(value);
  if (Array.isArray(value)) return Promise.all(value.map(convertFiles));
  if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = await convertFiles(v);
    return out;
  }
  return value;
}

async function toSdkFile(file: GrammyInputFile): Promise<InputFile | string> {
  const data = (file as unknown as { fileData: unknown }).fileData;
  const name = file.filename ?? 'file';
  if (data instanceof Uint8Array) return new InputFile(data, name);
  if (typeof data === 'string') {
    throw new Error(`InputFile('${data}'): file paths are not supported, there is no filesystem. Pass bytes instead.`);
  }
  if (data && typeof data === 'object') {
    // URL or { url }: send the link, Telegram downloads it. `URL` may not exist as a global.
    if ('href' in data) return String(data.href);
    if ('url' in data) return String(data.url);
    if ('arrayBuffer' in data && typeof data.arrayBuffer === 'function') {
      return new InputFile(new Uint8Array(await data.arrayBuffer()), name);
    }
    if (Symbol.asyncIterator in data || Symbol.iterator in data) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of data as AsyncIterable<Uint8Array>) chunks.push(chunk);
      const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
      }
      return new InputFile(bytes, name);
    }
  }
  throw new Error('InputFile: unsupported data source');
}

/**
 * Creates a grammY `Bot` wired to the platform. No token is needed: calls go
 * through `sdk.api`. Pass `botInfo` (the result of `getMe`) to skip the
 * `getMe` call grammY otherwise makes once per cold start.
 */
export function createBot<C extends Context = Context>(config?: BotConfig<C>): Bot<C> {
  // grammY reads the global `fetch` when it builds its client. The transformer
  // means it is never called; this stub only keeps construction working.
  const fetch = () => {
    throw new Error('grammY HTTP is disabled on tgcloud; API calls go through sdk.api');
  };
  const bot = new Bot<C>('tgcloud', { ...config, client: { ...config?.client, fetch: fetch as never } });
  bot.api.config.use(tgcloudTransformer);
  return bot;
}

/**
 * Turns a bot into a platform handler. Export it from every
 * `src/handlers/<type>.ts` the bot should receive, naming that type:
 *
 * ```ts
 * // src/handlers/message.ts
 * import { toHandler } from '@aiogram/tgcloud-grammy/grammy';
 * import { bot } from '../lib/bot.js';
 * export default toHandler(bot, 'message');
 * ```
 *
 * The type rebuilds the update when only a payload is given, as in
 * `npx tgcloud run handlers/message '{ chat: { id: 1 }, text: "/start" }'`.
 *
 * Errors follow grammY: without `bot.catch`, they are logged and rethrown.
 */
export function toHandler<C extends Context, T extends UpdateType>(bot: Bot<C>, type: T) {
  return async (payload: UpdatePayload<T>, ctx: { update?: Update }): Promise<void> => {
    if (!bot.isInited()) await bot.init();
    await bot.handleUpdate(ctx.update ?? ({ update_id: 0, [type]: payload } as Update));
  };
}

/** Shape of the table `dbStorage` needs. Declare it in `src/schema.ts`. */
export type SessionTable = Table<string, {
  key: Column<string, true, boolean>;
  value: Column<unknown, true, boolean>;
}>;

/**
 * grammY session storage in the bot's database. Declare and export the table
 * in `src/schema.ts`, run `tgcloud migrate`, then:
 *
 * ```ts
 * // src/schema.ts
 * export const sessions = table('sessions', {
 *   key: text().primaryKey(),
 *   value: json().notNull(),
 * });
 * // bot code
 * bot.use(session({ initial: () => ({ count: 0 }), storage: dbStorage(sessions) }));
 * ```
 */
export function dbStorage<T>(table: SessionTable): StorageAdapter<T> {
  return {
    async read(key) {
      const row = await db.select({ value: table.value }).from(table).where(eq(table.key, key)).get();
      return (row?.value ?? undefined) as T | undefined;
    },
    async write(key, value) {
      await db.insert(table).values({ key, value }).onConflictDoUpdate({ target: table.key, set: { value } });
    },
    async delete(key) {
      await db.delete(table).where(eq(table.key, key));
    },
  };
}
