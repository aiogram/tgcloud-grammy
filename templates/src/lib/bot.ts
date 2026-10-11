// The bot. Each update type it handles needs a one-line file in src/handlers/.
import { createBot } from '@aiogram/tgcloud-grammy/grammy';

export const bot = createBot();

bot.command('start', (ctx) => ctx.reply('Hi! Send me any text.'));

bot.on('message:text', (ctx) => ctx.reply(`You said: ${ctx.message.text}`));
