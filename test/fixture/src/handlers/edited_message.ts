import { api, db } from 'sdk';
import { defineHandler } from '@aiogram/tgcloud-grammy';
import { todos } from '../schema.js';

// Raw sdk, no grammY; imports the schema to check it is not inlined.
export default defineHandler('edited_message', async (message, ctx) => {
  await db.insert(todos).values({ userId: message.from!.id, text: message.text ?? '' });
  await api.sendMessage({ chat_id: message.chat.id, text: `edited #${ctx.update.update_id}` });
});
