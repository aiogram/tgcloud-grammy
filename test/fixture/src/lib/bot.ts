import { InputFile } from 'grammy';
import { createBot } from '@aiogram/tgcloud-grammy/grammy';

export const bot = createBot();
bot.command('start', (ctx) => ctx.reply(`Hi, I am @${ctx.me.username}`));
bot.command('file', (ctx) => ctx.replyWithDocument(new InputFile(Uint8Array.of(104, 105), 'a.txt')));
bot.on('message:text', (ctx) => ctx.reply(`echo: ${ctx.message.text}`));
bot.callbackQuery('ping', (ctx) => ctx.answerCallbackQuery('pong'));
