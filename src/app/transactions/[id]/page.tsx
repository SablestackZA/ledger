import Link from "next/link";
import { notFound } from "next/navigation";
import { DomainError } from "../../../ledger/errors";
import type { Account } from "../../../ledger/types";
import { getLedger } from "../../../server/container";
import { formatMinor, formatTime } from "../../../surface/format";
import { Footer, Nav, Status } from "../../../surface/ui";

export const dynamic = "force-dynamic";

export default async function TransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ledger = getLedger();
  let txn;
  try {
    txn = await ledger.getTransaction(id);
  } catch (err) {
    if (err instanceof DomainError && err.code === "not_found") notFound();
    throw err;
  }

  const accountIds = [...new Set(txn.entries.map((e) => e.account_id))];
  const accounts = new Map<string, Account>(
    (await Promise.all(accountIds.map((a) => ledger.getAccount(a)))).map((a) => [a.id, a]),
  );

  const totals = new Map<string, { debit: bigint; credit: bigint }>();
  for (const e of txn.entries) {
    const t = totals.get(e.currency) ?? { debit: 0n, credit: 0n };
    const v = BigInt(e.amount_minor);
    if (v > 0n) t.debit += v;
    else t.credit += -v;
    totals.set(e.currency, t);
  }

  return (
    <>
      <Nav current="accounts" />
      <main className="sbl-page">
        <section className="sbl-hero" style={{ paddingBottom: 48 }}>
          <p className="sbl-label"><Link className="sbl-underline" href="/accounts">Explorer</Link></p>
          <h1>
            Transaction <span className="sbl-soft sbl-mono" style={{ fontSize: "0.5em" }}>{txn.id}</span>
          </h1>
          <dl className="sbl-kv">
            <dt>Status</dt>
            <dd><Status kind={txn.status === "posted" ? "live" : "failed"}>{txn.status}</Status></dd>
            <dt>Posted</dt>
            <dd className="sbl-mono">{formatTime(txn.posted_at)}</dd>
            <dt>Description</dt>
            <dd>{txn.description ?? <span className="sbl-soft">None</span>}</dd>
            {txn.reverses_id ? (
              <>
                <dt>Reverses</dt>
                <dd className="sbl-mono"><Link className="sbl-underline" href={`/transactions/${txn.reverses_id}`}>{txn.reverses_id}</Link></dd>
              </>
            ) : null}
            {txn.reversed_by ? (
              <>
                <dt>Reversed by</dt>
                <dd className="sbl-mono"><Link className="sbl-underline" href={`/transactions/${txn.reversed_by}`}>{txn.reversed_by}</Link></dd>
              </>
            ) : null}
          </dl>
        </section>

        <section className="sbl-section" style={{ paddingTop: 48 }}>
          <div className="sbl-section-head"><p className="sbl-label">Entries</p></div>
          <div className="sbl-table-wrap">
            <table className="sbl-table">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Name</th>
                  <th scope="col" className="sbl-num">Debit</th>
                  <th scope="col" className="sbl-num">Credit</th>
                  <th scope="col">Currency</th>
                </tr>
              </thead>
              <tbody>
                {txn.entries.map((e, i) => {
                  const a = accounts.get(e.account_id);
                  const v = BigInt(e.amount_minor);
                  return (
                    <tr key={i}>
                      <td className="sbl-mono">{a?.code ?? e.account_id}</td>
                      <td className="sbl-soft">{a?.name ?? ""}</td>
                      <td className="sbl-num">{v > 0n ? formatMinor(v, e.currency) : ""}</td>
                      <td className="sbl-num">{v < 0n ? formatMinor(-v, e.currency) : ""}</td>
                      <td className="sbl-mono sbl-soft">{e.currency}</td>
                    </tr>
                  );
                })}
                {[...totals].map(([currency, t]) => (
                  <tr key={`total-${currency}`}>
                    <td className="sbl-idx sbl-soft" colSpan={2}>Total</td>
                    <td className="sbl-num">{formatMinor(t.debit, currency)}</td>
                    <td className="sbl-num">{formatMinor(t.credit, currency)}</td>
                    <td className="sbl-mono sbl-soft">{currency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
