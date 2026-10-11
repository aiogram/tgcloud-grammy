import { table, text, integer, json, boolean, index, sql } from 'sdk/db';

export const sessions = table('sessions', {
  key: text().primaryKey(),
  value: json().notNull(),
});

export const todos = table('todos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  text: text('text').notNull(),
  done: boolean('done').default(false),
  tags: json<string[]>('tags'),
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  old: text('old').deprecated('unused'),
}, (t) => ({
  userDoneIdx: index('idx_todos_user_done').on(t.userId, t.done),
}));
