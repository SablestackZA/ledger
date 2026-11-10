"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="sbl-page" style={{ padding: "96px 0" }}>
      <div className="sbl-empty">
        <p className="sbl-status sbl-status--failed"><span aria-hidden="true">✕</span> Failed</p>
        <h1>The ledger did not answer</h1>
        <p className="sbl-lede">The database did not respond in time. Retry in a few seconds.</p>
        <button type="button" className="sbl-btn sbl-btn--outline" onClick={reset}>Retry</button>
      </div>
    </main>
  );
}
