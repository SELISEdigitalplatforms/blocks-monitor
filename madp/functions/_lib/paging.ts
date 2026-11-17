// One paging rule for every gateway list: the data gateway answers 1-100 rows per page, nothing more.
import type { Filter } from "./filter";
import type { RawGateway, Row } from "./gateway";

export const MAX_PAGE_SIZE = 100;

/** The gateway's own rule and message (gateway.ts find). */
export function checkPaging(page: number, pageSize: number): void {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new TypeError("invalid paging");
  }
}

/** Wraps a gateway so find never sends a page size above 100: a larger window is read as 100-row pages in one parallel round. */
export function guardPaging(raw: RawGateway): RawGateway {
  return {
    get: (schema, itemId, fields) => raw.get(schema, itemId, fields),
    findAll: (schema, o) => raw.findAll(schema, o),
    insert: (schema, row) => raw.insert(schema, row),
    insertMany: (schema, rows) => raw.insertMany(schema, rows),
    update: (schema, itemId, patch) => raw.update(schema, itemId, patch),
    updateMany: (schema, where, patch) => raw.updateMany(schema, where, patch),
    remove: (schema, itemId) => raw.remove(schema, itemId),
    async find(schema, o) {
      const size = o.pageSize;
      if (size === undefined || size <= MAX_PAGE_SIZE) return raw.find(schema, o);
      const page = o.page ?? 1;
      if (!Number.isInteger(page) || page < 1 || !Number.isInteger(size)) throw new TypeError("invalid paging");
      const start = (page - 1) * size;
      const end = page * size;
      const first = Math.floor(start / MAX_PAGE_SIZE) + 1;
      const last = Math.ceil(end / MAX_PAGE_SIZE);
      const numbers: number[] = [];
      for (let n = first; n <= last; n += 1) numbers.push(n);
      const parts = await Promise.all(numbers.map((n) => raw.find(schema, { ...o, page: n, pageSize: MAX_PAGE_SIZE })));
      const joined = parts.flatMap((p) => p.items);
      const offset = start - (first - 1) * MAX_PAGE_SIZE;
      return { items: joined.slice(offset, offset + size), totalCount: parts[0]?.totalCount ?? null };
    },
  };
}

/** The newest `max` rows in sort order: page 1, then the remaining pages in one parallel round. Never limit_reached. */
export async function findNewest(
  gw: Pick<RawGateway, "find">,
  schema: string,
  o: { where: Filter; fields: readonly string[]; sort: { field: string; dir: "asc" | "desc" } },
  max: number,
): Promise<Row[]> {
  const size = Math.min(max, MAX_PAGE_SIZE);
  const head = await gw.find(schema, { ...o, page: 1, pageSize: size });
  const more = head.totalCount !== null ? head.totalCount > head.items.length : head.items.length >= size;
  if (!more || max <= MAX_PAGE_SIZE) return head.items.slice(0, max);
  const pages = Math.ceil(Math.min(head.totalCount ?? max, max) / MAX_PAGE_SIZE);
  const numbers: number[] = [];
  for (let n = 2; n <= pages; n += 1) numbers.push(n);
  const rest = await Promise.all(numbers.map((n) => gw.find(schema, { ...o, page: n, pageSize: MAX_PAGE_SIZE })));
  return [...head.items, ...rest.flatMap((r) => r.items)].slice(0, max);
}
