import { toHandler } from '@aiogram/tgcloud-grammy/grammy';
import { bot } from '../lib/bot.js';

export default toHandler(bot, 'message');
