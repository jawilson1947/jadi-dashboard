export function StatusBadge({ status, isLocked, mustChangePassword }: { status: "ACTIVE" | "DISABLED" | "INVITED"; isLocked: boolean; mustChangePassword: boolean }) {
  const s = isLocked
    ? { cls: "border-warning text-warning", text: "Locked" }
    : status === "DISABLED"
      ? { cls: "border-critical text-critical", text: "Disabled" }
      : status === "INVITED"
        ? { cls: "border-border text-ink-2", text: "Invited" }
        : mustChangePassword
          ? { cls: "border-warning text-warning", text: "Reset pending" }
          : { cls: "border-good text-good", text: "Active" };
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${s.cls}`}>{s.text}</span>;
}
