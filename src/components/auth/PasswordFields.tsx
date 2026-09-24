"use client";

import { useState } from "react";

/**
 * New-password + confirmation inputs with the policy hint (USER-MANAGEMENT-PLAN Sec.4).
 *
 * One Show/Hide control governs BOTH fields (2026-09-24): this is where someone types a password
 * they have never typed before, and revealing only one half would leave the confirmation a guess.
 * Reveal starts off on every render and is never remembered — a password left visible on an
 * unattended screen is the risk the masking exists to prevent.
 */
export function PasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
  label,
  autoComplete,
  minLength = 12,
}: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  label: string;
  autoComplete: string;
  minLength?: number;
}) {
  const [reveal, setReveal] = useState(false);
  const type = reveal ? "text" : "password";
  const input = "w-full rounded-md border border-border bg-surface-1 px-3 py-2";

  return (
    <>
      <div>
        <div className="flex items-baseline justify-between mb-1">
          <label htmlFor="new-password" className="block text-sm font-medium">{label}</label>
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            aria-pressed={reveal}
            aria-controls="new-password confirm-password"
            className="text-xs font-medium text-ink-2 hover:text-ink-1"
          >
            {reveal ? "Hide" : "Show"}
          </button>
        </div>
        <input
          id="new-password"
          type={type}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          required
          minLength={minLength}
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          className={input}
          aria-describedby="pw-hint"
        />
        <p id="pw-hint" className="text-xs text-ink-3 mt-1">
          At least {minLength} characters. Any characters are allowed; common passwords and your username are rejected. A long passphrase works well.
        </p>
      </div>
      <div>
        <label htmlFor="confirm-password" className="block text-sm font-medium mb-1">Confirm {label.toLowerCase()}</label>
        <input
          id="confirm-password"
          type={type}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          required
          value={confirm}
          onChange={(e) => onConfirm(e.target.value)}
          className={input}
        />
      </div>
      <p aria-live="polite" className="sr-only">{reveal ? "Password is visible." : "Password is hidden."}</p>
    </>
  );
}
