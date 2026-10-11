import type { Update, User, Chat } from '@grammyjs/types';

/** Update types a `handlers/<type>.ts` file can handle, e.g. `'message'`, `'callback_query'`. */
export type UpdateType = Exclude<keyof Update, 'update_id'>;

/** The payload a handler receives: the unwrapped field of the update, e.g. a `Message` for `'message'`. */
export type UpdatePayload<T extends UpdateType> = NonNullable<Update[T]>;

/** Second argument of a handler. */
export interface HandlerContext {
  /** The full update, including `update_id`. */
  update: Update;
}

export type Handler<T extends UpdateType> = (payload: UpdatePayload<T>, ctx: HandlerContext) => unknown;

/**
 * Declares an update handler. Use it as the default export of
 * `src/handlers/<type>.ts`, where the file name is the update type:
 *
 * ```ts
 * // src/handlers/message.ts
 * import { api } from 'sdk';
 * export default defineHandler('message', async (message) => {
 *   await api.sendMessage({ chat_id: message.chat.id, text: 'hi' });
 * });
 * ```
 *
 * The platform calls it only for updates of that type. Returns `fn` unchanged.
 */
export function defineHandler<T extends UpdateType>(type: T, fn: Handler<T>): Handler<T> {
  return fn;
}

/** Mini App init data, verified by the platform before an endpoint runs. */
export interface WebAppInitData {
  query_id?: string;
  /** The user who opened the Mini App. */
  user?: WebAppUser;
  receiver?: WebAppUser;
  chat?: Pick<Chat, 'id' | 'type'> & { title: string; username?: string; photo_url?: string };
  chat_type?: 'sender' | 'private' | 'group' | 'supergroup' | 'channel';
  chat_instance?: string;
  start_param?: string;
  can_send_after?: number;
  /** Unix time the Mini App was opened. */
  auth_date: number;
  hash: string;
  signature?: string;
}

export type WebAppUser = Pick<User, 'id' | 'is_bot' | 'first_name' | 'last_name' | 'username' | 'language_code' | 'is_premium' | 'added_to_attachment_menu'> & {
  allows_write_to_pm?: boolean;
  photo_url?: string;
};

/** Second argument of an endpoint. */
export interface EndpointContext {
  /** Verified init data; `initData.user` is the caller. */
  initData: WebAppInitData;
}

export type Endpoint<Input, Output> = (input: Input, ctx: EndpointContext) => Output | Promise<Output>;

/**
 * Declares a Mini App endpoint. Use it as the default export of
 * `src/endpoints/<name>.ts`; the Mini App calls it as `POST /api/<name>`.
 * Names: letters, digits and `_`, not starting with a digit.
 *
 * `Input` is only a type: the body comes from the client, so validate it
 * before trusting it. The return value is sent back as JSON: return plain
 * data. A `Date` arrives as `{}`, so send `date.getTime()` instead. Refuse a call
 * with `throw new EndpointError(description, parameters)` from `sdk`.
 */
export function defineEndpoint<Input extends object = Record<string, unknown>, Output = unknown>(
  fn: Endpoint<Input, Output>,
): Endpoint<Input, Output> {
  return fn;
}
