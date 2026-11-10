import Link from "next/link";
import type { ReactNode } from "react";

// Canonical v2 mark (website/src/components/sbl/mark.tsx). Never redrawn.
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 144 120" width={size} height={Math.round(size * (120 / 144))} fill="currentColor" role="img" aria-label="Sablestack">
      <path d="M0 0 L144 0 L144 30.6 L126 30.6 L126 18 L18 18 L18 51 L57 51 L57 69 L0 69 Z" />
      <path d="M144 120 L0 120 L0 89.4 L18 89.4 L18 102 L126 102 L126 69 L87 69 L87 51 L144 51 Z" />
    </svg>
  );
}

export const REPO = "https://github.com/SablestackZA/ledger";
export const repoFile = (path: string) => `${REPO}/blob/main/${path}`;

export function Nav({ current }: { current?: "writeup" | "accounts" }) {
  return (
    <header className="sbl-page">
      <nav className="sbl-nav" aria-label="Primary">
        <Link href="/" className="sbl-brand">
          <Mark />
          <span className="sbl-brand-name">ledger</span>
        </Link>
        <div className="sbl-nav-links">
          <Link className="sbl-nav-link" href="/" aria-current={current === "writeup" ? "page" : undefined}>Write-up</Link>
          <Link className="sbl-nav-link" href="/accounts" aria-current={current === "accounts" ? "page" : undefined}>Explorer</Link>
          <a className="sbl-nav-link sbl-hide-sm" href="/v1/integrity">Integrity</a>
        </div>
        <a className="sbl-btn sbl-btn--solid" href={REPO}>Source <span className="sbl-hide-sm" aria-hidden="true">→</span></a>
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="sbl-page">
      <div className="sbl-footer">
        <p className="sbl-label">Built in-house by Sablestack (Pty) Ltd.</p>
        <p className="sbl-label">
          <a className="sbl-underline" href="https://sablestack.io">sablestack.io</a>
        </p>
      </div>
    </footer>
  );
}

export function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="sbl-frame">
      <span className="sbl-frame-tick sbl-frame-tick--tl" aria-hidden="true" />
      <span className="sbl-frame-tick sbl-frame-tick--tr" aria-hidden="true" />
      <span className="sbl-frame-tick sbl-frame-tick--bl" aria-hidden="true" />
      <span className="sbl-frame-tick sbl-frame-tick--br" aria-hidden="true" />
      {children}
    </div>
  );
}

export function Section({ eyebrow, title, lede, children }: { eyebrow: string; title: string; lede?: string; children: ReactNode }) {
  return (
    <section className="sbl-section">
      <div className="sbl-section-head">
        <p className="sbl-label">{eyebrow}</p>
        <h2>{title}</h2>
        {lede ? <p className="sbl-lede">{lede}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function Figure({ n, caption, source, children }: { n: number; caption: string; source?: { label: string; path: string }[]; children: ReactNode }) {
  return (
    <figure className="sbl-figure" id={`fig-${n}`}>
      {children}
      <figcaption>
        <span className="sbl-label">
          <span className="sbl-idx">Fig. {n}</span>&nbsp;&nbsp;{caption}
        </span>
        {source?.length ? (
          <span className="sbl-label">
            Source:{" "}
            {source.map((s, i) => (
              <span key={s.path}>
                {i > 0 ? ", " : ""}
                <a className="sbl-underline sbl-mono" href={repoFile(s.path)}>{s.label}</a>
              </span>
            ))}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

export function Code({ name, children }: { name: string; children: string }) {
  return (
    <div className="sbl-code">
      <div className="sbl-code-bar sbl-idx"><span>{name}</span></div>
      <pre><code>{children}</code></pre>
    </div>
  );
}

// DESIGN.md §5.3: ● Live · ◐ Building · ○ Draft · △ Degraded · ✕ Failed. Grey by default;
// the accent is only for a failure that needs attention, so it is opt-in.
export type StatusKind = "live" | "building" | "draft" | "degraded" | "failed";
const GLYPH: Record<StatusKind, string> = { live: "●", building: "◐", draft: "○", degraded: "△", failed: "✕" };

export function Status({ kind, accent = false, children }: { kind: StatusKind; accent?: boolean; children: ReactNode }) {
  return (
    <span className={`sbl-status${accent ? " sbl-status--failed" : ""}`}>
      <span aria-hidden="true">{GLYPH[kind]}</span>
      {children}
    </span>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: { href: string; label: string } }) {
  return (
    <div className="sbl-empty">
      <h3>{title}</h3>
      <p className="sbl-lede">{body}</p>
      {action ? <a className="sbl-btn sbl-btn--outline" href={action.href}>{action.label} <span aria-hidden="true">→</span></a> : null}
    </div>
  );
}
