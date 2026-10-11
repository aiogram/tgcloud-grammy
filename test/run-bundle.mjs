// Runs a built tgcloud/ folder the way the platform would, with the web
// globals a bare V8 isolate may lack removed. Usage: node run-bundle.mjs <dir containing tgcloud/>
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2]);
const load = async (m) => (await import(pathToFileURL(path.join(root, 'tgcloud', `${m}.js`)).href)).default;
// Globals the platform lacks (probed 2026-10-11); it does have TextEncoder, TextDecoder and crypto.
for (const g of ['fetch', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask', 'structuredClone',
  'URL', 'URLSearchParams', 'atob', 'btoa', 'AbortController', 'AbortSignal', 'Blob', 'FormData', 'Headers', 'Request',
  'Response', 'ReadableStream', 'Buffer', 'navigator']) delete globalThis[g];

const { calls } = await import(pathToFileURL(path.join(root, 'node_modules/sdk/index.js')).href);
const message = await load('handlers/message');
const callback = await load('handlers/callback_query');
const edited = await load('handlers/edited_message');
const getProfile = await load('endpoints/getProfile');

const chat = { id: 5, type: 'private', first_name: 'U' };
const from = { id: 5, is_bot: false, first_name: 'U' };
const cmd = (text) => ({ message_id: 1, date: 0, chat, from, text, entities: [{ type: 'bot_command', offset: 0, length: text.length }] });
const update = (update_id, field, value) => [value, { update: { update_id, [field]: value } }];

await message(...update(1, 'message', cmd('/start')));
await message(...update(2, 'message', { message_id: 2, date: 0, chat, from, text: 'hi' }));
await message(...update(3, 'message', cmd('/file')));
await assert.rejects(callback(...update(4, 'callback_query', { id: 'q', from, chat_instance: 'c', data: 'ping' })),
  (e) => e.message.startsWith('GrammyError') && e.error.error_code === 400);
await edited(...update(5, 'edited_message', { message_id: 3, date: 0, chat, from, text: 'x' }));
// Payload only, no ctx.update — how `tgcloud run handlers/message '{…}'` calls it.
await message({ message_id: 4, date: 0, chat, from, text: 'bare' }, {});

assert.deepEqual(calls.map((c) => c[0]), ['getMe', 'sendMessage', 'sendMessage', 'sendDocument', 'answerCallbackQuery', 'sendMessage', 'sendMessage']);
assert.equal(calls[1][1].text, 'Hi, I am @test_bot');
assert.equal(calls[2][1].text, 'echo: hi');
assert.equal(calls[3][1].document.name, 'a.txt');
assert.deepEqual([...calls[3][1].document.bytes], [104, 105]);
assert.equal(calls[5][1].text, 'edited #5');
assert.equal(calls[6][1].text, 'echo: bare');

assert.deepEqual(await getProfile({ lang: 'en' }, { initData: { user: { id: 1, first_name: 'Ann' } } }), { hello: 'Ann/en' });
await assert.rejects(getProfile({ lang: 'en' }, { initData: {} }), (e) => e.parameters.code === 'NO_USER');
console.log('OK');
