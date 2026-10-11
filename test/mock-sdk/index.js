// Mock of the platform `sdk`: records Bot API calls.
import db from './db.js';
export { db };
export const calls = [];
export class InputFile { constructor(bytes, name) { this.bytes = bytes; this.name = name; } }
export class BotApiError extends Error {
  constructor(method, code, description) { super(description); Object.assign(this, { method, code, description }); }
}
export class EndpointError extends Error {
  constructor(description, parameters) { super(description); Object.assign(this, { description, parameters }); }
}
export const api = new Proxy({}, { get: (_, method) => async (params) => {
  calls.push([method, params]);
  if (method === 'getMe') return { id: 1, is_bot: true, first_name: 'T', username: 'test_bot' };
  if (method === 'answerCallbackQuery') throw new BotApiError(method, 400, 'Bad Request: query is too old');
  return true;
} });
