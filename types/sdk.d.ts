// Type declarations for the virtual `sdk` modules that exist only inside the
// Telegram Serverless (tgcloud) runtime. Enable them in a bot project with
// `"types": ["@aiogram/tgcloud-grammy/sdk"]` (or extend `@aiogram/tgcloud-grammy/tsconfig.json`).
//
// Globals: the runtime is a bare V8 isolate. Besides the ECMAScript built-ins
// (ES2025 level) it has only `console`, `TextEncoder`, `TextDecoder`, `crypto`
// and `WebAssembly`; those are declared below. It has NO `fetch` (import it
// from `sdk`), `setTimeout`/`setInterval`, `queueMicrotask`, `structuredClone`,
// `URL`, `URLSearchParams`, `atob`/`btoa`, `AbortController`, `Blob`,
// `Headers`, `ReadableStream`, `process` or `Buffer`, and dynamic `import()`
// throws "Not supported". (Probed on the platform, 2026-10-11.)

/** Logging. Each line is tagged `[file:line]`; `error` and `trace` add a stack. */
interface Console {
  log(...data: unknown[]): void;
  info(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  error(...data: unknown[]): void;
  debug(...data: unknown[]): void;
  trace(...data: unknown[]): void;
}
declare var console: Console;

/** Encodes strings as UTF-8. */
declare class TextEncoder {
  readonly encoding: 'utf-8';
  encode(input?: string): Uint8Array;
}

declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  readonly encoding: string;
  decode(input?: ArrayBuffer | ArrayBufferView, options?: { stream?: boolean }): string;
}

type BufferSource = ArrayBuffer | ArrayBufferView;
/** E.g. `'SHA-256'` or `{ name: 'HMAC', hash: 'SHA-256' }`. */
type CryptoAlgorithm = string | { name: string; [param: string]: unknown };
type KeyUsage = 'encrypt' | 'decrypt' | 'sign' | 'verify' | 'deriveKey' | 'deriveBits' | 'wrapKey' | 'unwrapKey';

interface CryptoKey {
  readonly type: 'secret' | 'private' | 'public';
  readonly extractable: boolean;
  readonly algorithm: { name: string };
  readonly usages: KeyUsage[];
}

/** Web Crypto (`crypto.subtle`). */
interface SubtleCrypto {
  digest(algorithm: CryptoAlgorithm, data: BufferSource): Promise<ArrayBuffer>;
  importKey(format: 'raw' | 'pkcs8' | 'spki', keyData: BufferSource, algorithm: CryptoAlgorithm, extractable: boolean, usages: KeyUsage[]): Promise<CryptoKey>;
  importKey(format: 'jwk', keyData: Record<string, unknown>, algorithm: CryptoAlgorithm, extractable: boolean, usages: KeyUsage[]): Promise<CryptoKey>;
  exportKey(format: 'raw' | 'pkcs8' | 'spki', key: CryptoKey): Promise<ArrayBuffer>;
  exportKey(format: 'jwk', key: CryptoKey): Promise<Record<string, unknown>>;
  generateKey(algorithm: CryptoAlgorithm, extractable: boolean, usages: KeyUsage[]): Promise<CryptoKey | { publicKey: CryptoKey; privateKey: CryptoKey }>;
  sign(algorithm: CryptoAlgorithm, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>;
  verify(algorithm: CryptoAlgorithm, key: CryptoKey, signature: BufferSource, data: BufferSource): Promise<boolean>;
  encrypt(algorithm: CryptoAlgorithm, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>;
  decrypt(algorithm: CryptoAlgorithm, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>;
  deriveBits(algorithm: CryptoAlgorithm, baseKey: CryptoKey, length: number): Promise<ArrayBuffer>;
  deriveKey(algorithm: CryptoAlgorithm, baseKey: CryptoKey, derivedKeyType: CryptoAlgorithm, extractable: boolean, usages: KeyUsage[]): Promise<CryptoKey>;
}

interface Crypto {
  readonly subtle: SubtleCrypto;
  getRandomValues<T extends Exclude<ArrayBufferView, DataView | Float32Array | Float64Array>>(array: T): T;
  randomUUID(): `${string}-${string}-${string}-${string}-${string}`;
}
declare var crypto: Crypto;

declare module 'sdk' {
  import type { ApiMethods, File, ResponseParameters } from '@grammyjs/types';
  import type { Db } from 'sdk/db';

  /** The bot's SQLite database. Same object as the default export of `sdk/db`. */
  export const db: Db;

  /**
   * A file to upload, usable anywhere the Bot API expects a file (at any depth,
   * e.g. inside `sendMediaGroup` media) and as a `fetch` / `FormData` body.
   * Bot API limits apply: 50 MB per file, 10 MB per photo.
   */
  export class InputFile {
    /**
     * @param bytes file contents
     * @param filename name Telegram shows for the file, e.g. `'report.pdf'`
     * @param opts.type MIME type, e.g. `'application/pdf'`
     */
    constructor(bytes: Uint8Array | ArrayBuffer, filename: string, opts?: { type?: string });
  }

  /** Thrown by `api.*` when Telegram answers `{ ok: false }`. */
  export class BotApiError extends Error {
    /** Bot API `error_code`: 400, 403, 429, … */
    readonly code: number;
    readonly description: string;
    /** The Bot API method that failed, e.g. `'sendMessage'`. */
    readonly method: string;
    /** E.g. `retry_after` on 429, `migrate_to_chat_id` after a group upgrade. */
    readonly parameters?: ResponseParameters;
  }

  /**
   * The only way an endpoint refuses a Mini App call: the client gets HTTP 400
   * with `description` and `parameters`. Any other exception becomes a generic
   * 500 and its message is visible only in logs.
   */
  export class EndpointError extends Error {
    /**
     * @param description human-readable reason, sent to the Mini App
     * @param parameters plain object with machine-readable details, e.g. `{ code: 'OUT_OF_STOCK' }`
     */
    constructor(description: string, parameters?: Record<string, unknown>);
    readonly description: string;
    readonly parameters?: Record<string, unknown>;
  }

  type Methods = ApiMethods<InputFile>;

  /**
   * The Telegram Bot API. `api.<method>(params)` resolves to the unwrapped
   * `result` and throws `BotApiError` on failure. Params use the Bot API's
   * snake_case names. The bot token is handled by the platform.
   */
  export type Api = {
    [M in keyof Methods]: (...args: Parameters<Methods[M]>) => Promise<ReturnType<Methods[M]>>;
  } & {
    /** Downloads a whole file by `file_id` (max 20 MB). Raw `file_path`s are rejected. */
    getFileContent(file: string | { file_id: string }): Promise<Uint8Array>;
    /** Streams a file by `file_id` (max 20 MB). */
    getFileStream(file: string | { file_id: string }): Promise<{
      /** `getFile` info without `file_path`. */
      file: Omit<File, 'file_path'>;
      body: AsyncIterable<Uint8Array>;
      bytes(): Promise<Uint8Array>;
      readonly bodyUsed: boolean;
    }>;
  };
  export const api: Api;

  export interface FetchHeaders {
    get(name: string): string | null;
    has(name: string): boolean;
    keys(): IterableIterator<string>;
    entries(): IterableIterator<[string, string]>;
  }

  export interface FetchResponse {
    readonly status: number;
    readonly statusText: string;
    /** `true` for 200–299. Other statuses resolve normally; only network errors reject. */
    readonly ok: boolean;
    /** Final URL after redirects. */
    readonly url: string;
    readonly headers: FetchHeaders;
    /** The body can be read once; a second read throws `TypeError`. */
    readonly bodyUsed: boolean;
    json<T = unknown>(): Promise<T>;
    text(): Promise<string>;
    /** Stream with `for await (const chunk of res.body)`. */
    readonly body: AsyncIterable<Uint8Array>;
  }

  /** A body built by `fetch.body.*`; sets the matching `Content-Type`. */
  export interface FetchBody {
    readonly __fetchBody: true;
  }

  export interface FetchInit {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array | InputFile | FormData | FetchBody;
  }

  /** Outbound HTTP, the only network access a module has. Total response size is capped at 30 MB. */
  export interface Fetch {
    (url: string, init?: FetchInit): Promise<FetchResponse>;
    body: {
      /** `application/json` */
      json(value: unknown): FetchBody;
      /** `application/x-www-form-urlencoded` */
      form(value: Record<string, string | number | boolean>): FetchBody;
      /** `text/plain` */
      text(value: string): FetchBody;
    };
  }
  export const fetch: Fetch;

  /** A multipart body for `fetch`. */
  export class FormData {
    append(name: string, value: string | InputFile): void;
  }
}

declare module 'sdk/api' {
  export { api, BotApiError, InputFile } from 'sdk';
  export type { Api } from 'sdk';
}

declare module 'sdk/fetch' {
  export { fetch, FormData, InputFile } from 'sdk';
  export type { Fetch, FetchInit, FetchResponse, FetchHeaders, FetchBody } from 'sdk';
}

/**
 * The SQLite database: schema DSL (used in `schema.js`), query builder and raw
 * SQL. Every query is async: always `await` it.
 *
 * Foreign keys are not supported (`.references()` / `foreignKey()` throw and
 * are not declared here). Dropping happens only via `.deprecated()`.
 */
declare module 'sdk/db' {
  // ---- SQL fragments ----

  /** A SQL fragment. `T` is the type the expression evaluates to. */
  export interface SQL<T = unknown> {
    readonly __sqlType?: T;
  }

  export interface SqlTag {
    /**
     * Values become named parameters, columns become identifiers, nested `sql`
     * is spliced in. Parameters don't work in DDL (DEFAULT / CHECK / GENERATED).
     */
    <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): SQL<T>;
    /** Literal SQL, no parameters. */
    raw<T = unknown>(text: string): SQL<T>;
  }
  export const sql: SqlTag;

  // ---- Columns ----

  /**
   * A column. `T` is its JS value, `NotNull` whether it rejects NULL,
   * `HasDefault` whether an insert may omit it.
   */
  export interface Column<T = unknown, NotNull extends boolean = false, HasDefault extends boolean = false> {
    readonly __column: { data: T; notNull: NotNull; hasDefault: HasDefault };
    /**
     * Makes this the primary key. An integer primary key is SQLite's rowid and
     * is assigned automatically, so inserts may omit it.
     */
    primaryKey(opts?: { autoIncrement?: boolean }): Column<T, true, T extends number ? true : HasDefault>;
    notNull(): Column<T, true, HasDefault>;
    unique(): Column<T, NotNull, HasDefault>;
    /** A `json()` default is encoded for you; a `sql` default is used verbatim. */
    default(value: T | SQL): Column<T, NotNull, true>;
    generatedAlwaysAs(expr: SQL, opts?: { mode?: 'stored' | 'virtual' }): Column<T, NotNull, true>;
    /** Arbitrary column-level DDL, e.g. `'COLLATE NOCASE'`. */
    constraint(ddl: string): Column<T, NotNull, HasDefault>;
    /** Marks the column for dropping on `migrate`; it disappears from the row types. Terminal. */
    deprecated(reason: string): DeprecatedColumn;
  }

  export interface DeprecatedColumn {
    readonly __deprecated: true;
  }

  export type AnyColumn = Column<any, boolean, boolean>;

  export function text(name?: string): Column<string>;
  /** Stores JSON as TEXT; same as `json()`. */
  export function text<T = unknown>(name: string | undefined, opts: { mode: 'json' }): Column<T>;

  export function integer(name?: string): Column<number>;
  export function integer(name: string | undefined, opts: { mode: 'boolean' }): Column<boolean>;
  /** `timestamp`: unix seconds ↔ `Date`; `timestamp_ms`: unix ms ↔ `Date`. */
  export function integer(name: string | undefined, opts: { mode: 'timestamp' | 'timestamp_ms' }): Column<Date>;

  export function real(name?: string): Column<number>;
  /** Alias of `real()`. */
  export function float(name?: string): Column<number>;
  export function numeric(name?: string): Column<number>;
  /** Takes and returns `Uint8Array`. */
  export function blob(name?: string, opts?: { mode?: 'bytes' }): Column<Uint8Array>;
  /** INTEGER 0/1, read as `true` / `false`. */
  export function boolean(name?: string): Column<boolean>;
  /**
   * TEXT with automatic `JSON.stringify` / `JSON.parse`.
   * `T` only types the value; nothing validates it at runtime.
   */
  export function json<T = unknown>(name?: string): Column<T>;

  // ---- Tables ----

  export type Columns = Record<string, AnyColumn | DeprecatedColumn>;

  /** A table. Its columns are properties: `users.id`. */
  export type Table<Name extends string = string, C extends Columns = Columns> = C & {
    readonly __table: { name: Name; columns: C };
    strict(): Table<Name, C>;
    withoutRowid(): Table<Name, C>;
    constraint(ddl: string, name?: string): Table<Name, C>;
    /** Marks the table for dropping on `migrate`. Terminal. */
    deprecated(reason: string): DeprecatedColumn;
  };
  export type AnyTable = Table<string, any>;

  /** Something declared in `table()`'s third argument. */
  export interface TableExtra {
    readonly __extra: true;
  }
  export interface IndexBuilder {
    /** Columns or expressions, e.g. `.on(t.userId, t.done)` or `.on(sql\`lower(${t.email})\`)`. */
    on(...targets: (AnyColumn | SQL)[]): Index;
  }
  export interface Index extends TableExtra {
    /** Makes it a partial index. */
    where(condition: SQL): Index;
  }

  /**
   * Declares a table. Export it from `schema.js` as a named export; `migrate`
   * creates and alters it.
   * @param name SQL table name
   * @param columns JS key → column; a column without a name uses the key
   * @param extras indexes and table-level constraints, built from the columns
   */
  export function table<Name extends string, C extends Columns>(
    name: Name,
    columns: C,
    extras?: (t: C) => Record<string, TableExtra>,
  ): Table<Name, C>;

  export function index(name: string): IndexBuilder;
  export function uniqueIndex(name: string): IndexBuilder;
  export function unique(name: string): { on(...columns: AnyColumn[]): TableExtra };
  export function check(name: string, condition: SQL): TableExtra;
  export function primaryKey(opts: { columns: AnyColumn[] }): TableExtra;

  // ---- Row types ----

  type ColumnsOf<T> = T extends { readonly __table: { columns: infer C } } ? C : never;
  type LiveKeys<C> = { [K in keyof C]: C[K] extends AnyColumn ? K : never }[keyof C];
  type DataOf<Col> = Col extends Column<infer D, infer NotNull, any> ? (NotNull extends true ? D : D | null) : never;
  type RequiredInsertKeys<C> = {
    [K in LiveKeys<C>]: C[K] extends Column<any, true, false> ? K : never;
  }[LiveKeys<C>];
  type Simplify<T> = { [K in keyof T]: T[K] } & {};

  /** A row read from `T`. Deprecated columns are excluded. */
  export type InferSelect<T extends AnyTable> = Simplify<{ [K in LiveKeys<ColumnsOf<T>>]: DataOf<ColumnsOf<T>[K]> }>;

  /** A row to insert into `T`: NOT NULL columns without a default are required. */
  export type InferInsert<T extends AnyTable> = Simplify<
    { [K in RequiredInsertKeys<ColumnsOf<T>>]: DataOf<ColumnsOf<T>[K]> } & {
      [K in Exclude<LiveKeys<ColumnsOf<T>>, RequiredInsertKeys<ColumnsOf<T>>>]?: DataOf<ColumnsOf<T>[K]>;
    }
  >;

  type Projection = Record<string, AnyColumn | SQL>;
  type ProjectedRow<P extends Projection> = Simplify<{
    [K in keyof P]: P[K] extends AnyColumn ? DataOf<P[K]> : P[K] extends SQL<infer S> ? S : never;
  }>;

  // ---- Operators ----

  type Operand<Col> = (Col extends Column<infer D, any, any> ? D : unknown) | AnyColumn | SQL;

  export function eq<Col extends AnyColumn | SQL>(left: Col, right: Operand<Col>): SQL<boolean>;
  export function ne<Col extends AnyColumn | SQL>(left: Col, right: Operand<Col>): SQL<boolean>;
  export function gt<Col extends AnyColumn | SQL>(left: Col, right: Operand<Col>): SQL<boolean>;
  export function gte<Col extends AnyColumn | SQL>(left: Col, right: Operand<Col>): SQL<boolean>;
  export function lt<Col extends AnyColumn | SQL>(left: Col, right: Operand<Col>): SQL<boolean>;
  export function lte<Col extends AnyColumn | SQL>(left: Col, right: Operand<Col>): SQL<boolean>;
  export function like(left: AnyColumn | SQL, pattern: string): SQL<boolean>;
  export function notLike(left: AnyColumn | SQL, pattern: string): SQL<boolean>;
  export function isNull(value: AnyColumn | SQL): SQL<boolean>;
  export function isNotNull(value: AnyColumn | SQL): SQL<boolean>;
  export function between<Col extends AnyColumn | SQL>(value: Col, min: Operand<Col>, max: Operand<Col>): SQL<boolean>;
  export function notBetween<Col extends AnyColumn | SQL>(value: Col, min: Operand<Col>, max: Operand<Col>): SQL<boolean>;
  export function inArray<Col extends AnyColumn | SQL>(value: Col, values: readonly Operand<Col>[]): SQL<boolean>;
  export function notInArray<Col extends AnyColumn | SQL>(value: Col, values: readonly Operand<Col>[]): SQL<boolean>;
  export function and(...conditions: SQL[]): SQL<boolean>;
  export function or(...conditions: SQL[]): SQL<boolean>;
  export function not(condition: SQL): SQL<boolean>;

  export function count(value?: AnyColumn | SQL): SQL<number>;
  export function sum(value: AnyColumn | SQL): SQL<number | null>;
  export function avg(value: AnyColumn | SQL): SQL<number | null>;
  export function min<Col extends AnyColumn>(value: Col): SQL<DataOf<Col> | null>;
  export function max<Col extends AnyColumn>(value: Col): SQL<DataOf<Col> | null>;

  export function asc(value: AnyColumn | SQL): SQL;
  export function desc(value: AnyColumn | SQL): SQL;

  // ---- Query builder ----

  /** Result of a write without `.returning()`. */
  export interface RunResult<Row = Record<string, unknown>> {
    rowsAffected: number;
    lastInsertRowid: number;
    rows: Row[];
  }

  /** Awaiting the builder runs `.all()`. */
  export interface SelectQuery<Row> extends PromiseLike<Row[]> {
    /** Several conditions are combined with `and`. */
    where(...conditions: SQL[]): SelectQuery<Row>;
    orderBy(...order: (AnyColumn | SQL)[]): SelectQuery<Row>;
    limit(n: number): SelectQuery<Row>;
    offset(n: number): SelectQuery<Row>;
    groupBy(...columns: (AnyColumn | SQL)[]): SelectQuery<Row>;
    having(condition: SQL): SelectQuery<Row>;
    distinct(): SelectQuery<Row>;
    all(): Promise<Row[]>;
    /** First row, or `null`. */
    get(): Promise<Row | null>;
    /** Rows as positional arrays. */
    values(): Promise<unknown[][]>;
  }

  /** A write that returns rows (after `.returning()`). Awaiting runs it. */
  export interface ReturningQuery<Row> extends PromiseLike<Row[]> {
    run(): Promise<Row[]>;
  }

  /** A write. Awaiting runs it and resolves to the run result. */
  export interface WriteQuery<T extends AnyTable> extends PromiseLike<RunResult> {
    /** `RETURNING *`: resolves to the affected rows instead of the run result. */
    returning(): ReturningQuery<InferSelect<T>>;
    returning<P extends Projection>(projection: P): ReturningQuery<ProjectedRow<P>>;
    run(): Promise<RunResult>;
  }

  export interface InsertQuery<T extends AnyTable> extends WriteQuery<T> {
    onConflictDoNothing(opts?: { target?: AnyColumn | AnyColumn[] }): WriteQuery<T>;
    onConflictDoUpdate(opts: { target: AnyColumn | AnyColumn[]; set: Partial<InferInsert<T>> }): WriteQuery<T>;
  }

  export interface FilteredWriteQuery<T extends AnyTable> extends WriteQuery<T> {
    /** Several conditions are combined with `and`. Without `where`, every row is affected. */
    where(...conditions: SQL[]): WriteQuery<T>;
  }

  type RawParams = Record<string, unknown> | unknown[];

  export interface Db {
    /** `SELECT *` from a table. */
    select(): { from<T extends AnyTable>(table: T): SelectQuery<InferSelect<T>> };
    /** `SELECT` a projection `{ alias: column | sql }`. */
    select<P extends Projection>(projection: P): { from(table: AnyTable): SelectQuery<ProjectedRow<P>> };
    insert<T extends AnyTable>(table: T): { values(rows: InferInsert<T> | InferInsert<T>[]): InsertQuery<T> };
    update<T extends AnyTable>(table: T): { set(values: Partial<InferInsert<T>>): FilteredWriteQuery<T> };
    delete<T extends AnyTable>(table: T): FilteredWriteQuery<T>;
    /** `COUNT(*)`, optionally filtered. */
    $count(table: AnyTable, where?: SQL): Promise<number>;

    // Raw SQL. Rows are not mode-converted: booleans are 0/1, JSON is a string, timestamps are numbers.
    /** Executes a write; params are named, e.g. `{ ':id': 5 }`. */
    run(query: SQL | string, params?: RawParams): Promise<RunResult>;
    all<Row = Record<string, unknown>>(query: SQL | string, params?: RawParams): Promise<Row[]>;
    get<Row = Record<string, unknown>>(query: SQL | string, params?: RawParams): Promise<Row | null>;
    /** Positional rows; use when two selected columns share a name. */
    values(query: SQL | string, params?: RawParams): Promise<unknown[][]>;
  }

  const db: Db;
  export default db;
}
