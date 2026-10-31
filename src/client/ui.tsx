// Small shared UI pieces.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ApiFailure } from "./api.ts";

export function Emoji({ symbol, size = 20, className = "" }: { symbol: string; size?: number; className?: string }) {
  return (
    <span className={`emoji ${className}`} style={{ fontSize: size }} aria-hidden="true">
      {symbol}
    </span>
  );
}

export function StarIcon({ size = 20, className = "" }: { size?: number; className?: string }) {
  return <Emoji symbol="⭐" size={size} className={className} />;
}

/** A little burst of stars that plays once when mounted. */
export function StarBurst() {
  return (
    <span className="burst" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`burst-star burst-${i}`}>
          <StarIcon size={16} />
        </span>
      ))}
    </span>
  );
}

export function Banner({ kind, children, action }: { kind: "error" | "info"; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`banner banner-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <div>{children}</div>
      {action}
    </div>
  );
}

export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const unreachable = error instanceof ApiFailure && error.unreachable;
  const message = error instanceof Error ? error.message : "Something went wrong";
  return (
    <Banner
      kind="error"
      action={
        unreachable ? (
          <button className="btn btn-small" onClick={() => location.reload()}>
            Reload
          </button>
        ) : onRetry ? (
          <button className="btn btn-small" onClick={onRetry}>
            Try again
          </button>
        ) : null
      }
    >
      {message}
    </Banner>
  );
}

/** Load something when mounted (and whenever `deps` change), with reload + manual set. */
export function useLoad<T>(fn: () => Promise<T>, deps: readonly unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  const run = useCallback(() => {
    const id = ++latest.current;
    setLoading(true);
    fn().then(
      (value) => {
        if (id !== latest.current) return; // a newer request superseded this one
        setData(value);
        setError(null);
        setLoading(false);
      },
      (err: unknown) => {
        if (id !== latest.current) return;
        setError(err);
        setLoading(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run();
  }, [run]);

  return { data, setData, error, loading, reload: run };
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "seg seg-on" : "seg"}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

/** Parse a number typed into a text box. Returns null for blank/invalid. */
export function parseNum(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function plural(word: string, n: number): string {
  if (n === 1) return word;
  return /(s|x|ch|sh)$/.test(word) ? `${word}es` : `${word}s`;
}

/** 5 -> "5", 5.25 -> "5.3" (one decimal at most). */
export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}
