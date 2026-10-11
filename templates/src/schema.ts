// Database tables as named exports. Builds to tgcloud/schema.js; after deploying
// a change, apply it with `npx tgcloud migrate`. Example:
//
//   export const users = table('users', {
//     id: integer('id').primaryKey(),
//     name: text('name').notNull(),
//   });
import { table, integer, text } from 'sdk/db';
