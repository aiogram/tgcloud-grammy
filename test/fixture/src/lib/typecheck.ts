// Type-level checks for the sdk typings; never built or run.
import { api, db, fetch, InputFile, BotApiError } from 'sdk';
import { eq, and, desc, count, type InferSelect, type InferInsert } from 'sdk/db';
import { session, type Context, type SessionFlavor } from 'grammy';
import { defineHandler } from '@aiogram/tgcloud-grammy';
import { createBot, dbStorage } from '@aiogram/tgcloud-grammy/grammy';
import { todos, sessions } from '../schema.js';

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const assertType = <T extends true>() => {};

assertType<Equals<InferSelect<typeof todos>, {
  id: number; userId: number; text: string; done: boolean | null; tags: string[] | null; created: Date | null;
}>>();
assertType<Equals<InferInsert<typeof todos>, {
  userId: number; text: string; id?: number; done?: boolean | null; tags?: string[] | null; created?: Date | null;
}>>();

export async function check() {
  const rows = await db.select().from(todos).where(and(eq(todos.userId, 1), eq(todos.done, false))).orderBy(desc(todos.id)).limit(5);
  rows[0]?.text.toUpperCase();
  const one = await db.select({ id: todos.id, n: count() }).from(todos).get();
  if (one) one.n.toFixed();
  const inserted = await db.insert(todos).values({ userId: 1, text: 'x' }).returning({ id: todos.id });
  inserted[0]?.id.toFixed();
  const res = await db.update(todos).set({ done: true }).where(eq(todos.id, 1));
  res.rowsAffected.toFixed();
  // @ts-expect-error text is NOT NULL without a default
  await db.insert(todos).values({ userId: 1 });
  // @ts-expect-error a deprecated column is not part of the row
  await db.insert(todos).values({ userId: 1, text: 'x', old: 'y' });
  // @ts-expect-error comparing a number column with a string
  eq(todos.userId, 'a');

  const me = await api.getMe();
  me.username.toUpperCase();
  await api.sendDocument({ chat_id: 1, document: new InputFile(new Uint8Array(1), 'a.bin') });
  // @ts-expect-error chat_id is required
  await api.sendMessage({ text: 'hi' });
  (await api.getFileContent('id')).byteLength.toFixed();

  const r = await fetch('https://example.com', { method: 'POST', body: fetch.body.json({ a: 1 }) });
  if (r.ok) (await r.json<{ a: number }>()).a.toFixed();

  try { await api.deleteMessage({ chat_id: 1, message_id: 1 }); } catch (e) { if (!(e instanceof BotApiError) || e.code !== 400) throw e; }

  const bot = createBot<Context & SessionFlavor<{ count: number }>>();
  bot.use(session({ initial: () => ({ count: 0 }), storage: dbStorage(sessions) }));
  defineHandler('callback_query', (q) => q.data?.toUpperCase());
  // @ts-expect-error a Message has no `data`
  defineHandler('message', (m) => m.data);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('x'));
  new TextDecoder().decode(digest).toUpperCase();
  crypto.randomUUID().toUpperCase();
  // @ts-expect-error the runtime has no timers
  setTimeout(() => {}, 1);
  // @ts-expect-error the runtime has no URL global
  new URL('https://example.com');
}
