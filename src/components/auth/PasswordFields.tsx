"use client";

/** New-password + confirmation inputs with the policy hint (USER-MANAGEMENT-PLAN Sec.4). */
export function PasswordFields({ password, confirm, onPassword, onConfirm, label, autoComplete, minLength = 12 }: { password: string; confirm: string; onPassword: (v: string) => void; onConfirm: (v: string) => void; label: string; autoComplete: string; minLength?: number }) {
  return (
    <>
      <div>
        <label htmlFor="new-password" className="block text-sm font-medium mb-1">{label}</label>
        <input id="new-password" type="password" autoComplete={autoComplete} required minLength={minLength} value={password} onChange={(e) => onPassword(e.target.value)} className="w-full rounded-md border border-border bg-surface-1 px-3 py-2" aria-describedby="pw-hint" />
        <p id="pw-hint" className="text-xs text-ink-3 mt-1">At least {minLength} characters. Any characters are allowed; common passwords and your username are rejected. A long passphrase works well.</p>
      </div>
      <div>
        <label htmlFor="confirm-password" className="block text-sm font-medium mb-1">Confirm {label.toLowerCase()}</label>
        <input id="confirm-password" type="password" autoComplete={autoComplete} required value={confirm} onChange={(e) => onConfirm(e.target.value)} className="w-full rounded-md border border-border bg-surface-1 px-3 py-2" />
      </div>
    </>
  );
}
