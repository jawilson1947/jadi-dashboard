export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 no-print">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description ? <p className="text-sm text-ink-2 mt-1">{description}</p> : null}
      </div>
      {actions ? <div className="ml-auto">{actions}</div> : null}
    </div>
  );
}
