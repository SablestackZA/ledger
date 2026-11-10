import Link from "next/link";
import { notFound } from "next/navigation";
import { DomainError } from "../../../ledger/errors";
import type { Account } from "../../../ledger/types";
import { getLedger } from "../../../server/container";
import { formatMinor, formatTime } from "../../../surface/format";
import { DataTable } from "../../../surface/data-table";
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

  const lines = [
    ...txn.entries.map((e, i) => {
      const a = accounts.get(e.account_id);
      const v = BigInt(e.amount_minor);
      return {
        key: `entry-${i}`,
        code: a?.code ?? e.account_id,
        name: a?.name ?? "",
        debit: v > 0n ? formatMinor(v, e.currency) : "",
        credit: v < 0n ? formatMinor(-v, e.currency) : "",
        currency: e.currency,
      };
    }),
    ...[...totals].map(([currency, t]) => ({
      key: `total-${currency}`,
      code: "Total",
      name: "",
      debit: formatMinor(t.debit, currency),
      credit: formatMinor(t.credit, currency),
      currency,
    })),
  ];

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
          <DataTable
            rows={lines}
            rowKey={(l) => l.key}
            columns={[
              { header: "Account", kind: "mono", cell: (l) => l.code },
              { header: "Name", kind: "soft", cell: (l) => l.name },
              { header: "Debit", kind: "num", cell: (l) => l.debit },
              { header: "Credit", kind: "num", cell: (l) => l.credit },
              { header: "Currency", kind: "mono", cell: (l) => l.currency },
            ]}
          />
        </section>
      </main>
      <Footer />
    </>
  );
}
