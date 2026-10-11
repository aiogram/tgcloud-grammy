// Mock of `sdk/db`: every DSL call returns a chainable no-op; queries resolve to a run result.
const chain = () => new Proxy(function () {}, {
  get: (_, k) => (k === 'then' ? (ok) => ok({ rowsAffected: 1, lastInsertRowid: 1, rows: [] }) : chain()),
  apply: () => chain(),
});
export const table = (name, columns) => ({ ...columns, name });
export const text = chain, integer = chain, json = chain, boolean = chain, index = chain;
export const sql = chain(), eq = chain;
const db = chain();
export default db;
