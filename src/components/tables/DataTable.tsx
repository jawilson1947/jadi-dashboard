import Link from "next/link";
import { formatCount } from "@/lib/format";

/**
 * Server-rendered data table (Spec §5): sortable headers, server-side pagination,
 * caption, keyboard-navigable links, and an explicit empty state.
 * Column visibility and client-side filtering are added with the shared table
 * component in Phase 3 (needs a client island); URL-driven state keeps every view linkable.
 */
export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  /** Field name sent in ?sort= when it differs from key. */
  sortKey?: string;
  align?: "left" | "right";
  render?: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  page: number;
  pageSize: number;
  totalRows: number;
  sort: { field: string; direction: "asc" | "desc" };
  /** Href without page/sort params; the table appends them. */
  baseHref: string;
  caption: string;
  emptyMessage?: string;
}

export function DataTable<T extends object>({ rows, columns, rowKey, page, pageSize, totalRows, sort, baseHref, caption, emptyMessage = "No rows." }: DataTableProps<T>) {
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const href = (p: number, s = sort.field, d = sort.direction) => `${baseHref}&page=${p}&pageSize=${pageSize}&sort=${s}&direction=${d}`;

  return (
    <div className="card p-0 overflow-hidden paged-table">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface-2 text-left">
            <tr>
              {columns.map((c) => {
                const sortKey = c.sortKey ?? c.key;
                const active = sort.field === sortKey;
                const nextDir = active && sort.direction === "asc" ? "desc" : "asc";
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                    className={`px-3 py-2 font-medium text-ink-2 whitespace-nowrap ${c.align === "right" ? "text-right" : ""}`}
                  >
                    {c.sortable ? (
                      <Link href={href(1, sortKey, nextDir)} className="inline-flex items-center gap-1 hover:text-ink">
                        {c.label}
                        <span aria-hidden className="text-ink-3">{active ? (sort.direction === "asc" ? "▲" : "▼") : "⇅"}</span>
                      </Link>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-ink-3">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={rowKey(r)} className="border-t border-border hover:bg-surface-2">
                  {columns.map((c) => (
                    <td key={c.key} className={`px-3 py-2 whitespace-nowrap ${c.align === "right" ? "text-right tabular" : ""}`}>
                      {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <nav aria-label="Pagination" className="flex items-center gap-3 px-3 py-2 border-t border-border text-sm">
        <span className="text-ink-2">
          Showing {formatCount(totalRows === 0 ? 0 : (page - 1) * pageSize + 1)}–{formatCount(Math.min(page * pageSize, totalRows))} of {formatCount(totalRows)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <PageLink href={href(page - 1)} disabled={page <= 1} label="Previous" />
          <span className="text-ink-2">
            Page {formatCount(page)} of {formatCount(pageCount)}
          </span>
          <PageLink href={href(page + 1)} disabled={page >= pageCount} label="Next" />
        </div>
      </nav>
    </div>
  );
}

function PageLink({ href, disabled, label }: { href: string; disabled: boolean; label: string }) {
  return disabled ? (
    <span aria-disabled="true" className="rounded-md border border-border px-3 py-1 text-ink-3">
      {label}
    </span>
  ) : (
    <Link href={href} className="rounded-md border border-border px-3 py-1 hover:bg-surface-2">
      {label}
    </Link>
  );
}
