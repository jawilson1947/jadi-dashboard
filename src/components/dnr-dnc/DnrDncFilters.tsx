import type { DnrDncFilter, DnrDncSortField, DnrDncView } from "@/server/services/dnr-dnc";
import { formatCount } from "@/lib/format";

/**
 * Filter bar (Spec §8): category, classification, balance range, and last-cleared semester.
 * A plain GET form — every filtered view is a linkable URL, works without JavaScript, and the browser
 * keeps the values. Options come from the population itself, so no filter can select an empty set.
 */
export function DnrDncFilters({
  options,
  current,
}: {
  options: DnrDncView["filterOptions"];
  current: DnrDncFilter & { sort: DnrDncSortField; direction: "asc" | "desc"; pageSize: number };
}) {
  const field = "rounded-md border border-border bg-surface-1 px-3 py-2 text-sm";
  return (
    <form method="get" action="/dnr-dnc" className="card flex flex-wrap items-end gap-3 no-print" aria-label="Filter DNR and DNC students">
      <input type="hidden" name="sort" value={current.sort} />
      <input type="hidden" name="direction" value={current.direction} />
      <input type="hidden" name="pageSize" value={current.pageSize} />

      <div className="flex flex-col gap-1">
        <label htmlFor="f-category" className="text-xs text-ink-2">
          Category
        </label>
        <select id="f-category" name="category" defaultValue={current.category ?? ""} className={field}>
          <option value="">All</option>
          <option value="DNC">DNC — did not clear</option>
          <option value="DNR">DNR — did not return</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="f-class" className="text-xs text-ink-2">
          Classification
        </label>
        <select id="f-class" name="classification" defaultValue={current.classification ?? ""} className={field}>
          <option value="">All</option>
          {options.classifications.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name} ({formatCount(c.count)})
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="f-last" className="text-xs text-ink-2">
          Last cleared semester
        </label>
        <select id="f-last" name="lastCleared" defaultValue={current.lastCleared ?? ""} className={field}>
          <option value="">All</option>
          {options.lastCleared.map((l) => (
            <option key={l.key || "blank"} value={l.key}>
              {l.label || "(blank)"} ({formatCount(l.count)})
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="f-min" className="text-xs text-ink-2">
          Balance from
        </label>
        <input id="f-min" name="minBalance" type="number" min={0} step="0.01" inputMode="decimal" defaultValue={current.minBalance ?? ""} placeholder={String(options.balance.min)} className={`${field} w-28`} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="f-max" className="text-xs text-ink-2">
          to
        </label>
        <input id="f-max" name="maxBalance" type="number" min={0} step="0.01" inputMode="decimal" defaultValue={current.maxBalance ?? ""} placeholder={String(options.balance.max)} className={`${field} w-28`} />
      </div>

      <button type="submit" className="rounded-md bg-brand text-brand-ink px-3 py-2 text-sm">
        Apply filters
      </button>
      <a href="/dnr-dnc" className="text-sm text-brand py-2">
        Reset
      </a>
    </form>
  );
}
