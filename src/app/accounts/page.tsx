import Link from "next/link";
import { DomainError } from "../../ledger/errors";
import { getLedger } from "../../server/container";
import { formatMinor, formatTime, normalSide, onNormalSide, shortId } from "../../surface/format";
import { DataTable } from "../../surface/data-table";
import { Empty, Footer, Nav } from "../../surface/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Explorer | Ledger | Sablestack" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const { cursor } = await searchParams;
  const ledger = getLedger();
  let accounts, recent;
  try {
    [accounts, recent] = await Promise.all([
      ledger.listAccounts({ limit: 50, cursor }),
      cursor ? Promise.resolve(null) : ledger.listTransactions({ limit: 10 }),
    ]);
  } catch (err) {
    if (err instanceof DomainError && err.code === "invalid_request") {
      return (
        <>
          <Nav current="accounts" />
          <main className="sbl-page" style={{ padding: "72px 0" }}>
            <Empty title="Page cursor not valid" body="The cursor in the address is not one this ledger issued. Start again from the first page." action={{ href: "/accounts", label: "First page" }} />
          </main>
          <Footer />
        </>
      );
    }
    throw err;
  }

  return (
    <>
      <Nav current="accounts" />
      <main className="sbl-page">
        <section className="sbl-hero" style={{ paddingBottom: 48 }}>
          <h1>
            Demo ledger <span className="sbl-soft">explorer</span>
          </h1>
          <p className="sbl-lede">
            Read-only. Balances are shown on each account&apos;s normal side: debit for asset and expense, credit for the rest. A minus sign marks an abnormal balance.
          </p>
        </section>

        <section className="sbl-section" style={{ paddingTop: 48 }}>
          <div className="sbl-section-head"><p className="sbl-label">Accounts</p></div>
          {accounts.data.length === 0 ? (
            <Empty title="No accounts yet" body="The demo ledger is reseeded every night. Check back after the next reset." action={{ href: "/", label: "Read the write-up" }} />
          ) : (
            <DataTable
              rows={accounts.data}
              rowKey={(a) => a.id}
              columns={[
                { header: "Code", kind: "mono", cell: (a) => a.code },
                { header: "Name", cell: (a) => a.name },
                { header: "Type", kind: "soft", cell: (a) => a.type },
                { header: "Side", kind: "mono", cell: (a) => normalSide(a.type) },
                { header: "Balance", kind: "num", cell: (a) => formatMinor(onNormalSide(a.type, a.balance_minor), a.currency) },
                { header: "Currency", kind: "mono", cell: (a) => a.currency },
              ]}
            />
          )}
          {accounts.next_cursor ? (
            <div className="sbl-pager">
              <Link className="sbl-btn sbl-btn--outline" href={`/accounts?cursor=${accounts.next_cursor}`}>Next accounts <span aria-hidden="true">→</span></Link>
            </div>
          ) : null}
        </section>

        {recent ? (
          <section className="sbl-section">
            <div className="sbl-section-head"><p className="sbl-label">Latest transactions</p></div>
            {recent.data.length === 0 ? (
              <Empty title="No transactions yet" body="Nothing has been posted to the demo ledger." />
            ) : (
              <DataTable
                rows={recent.data}
                rowKey={(t) => t.id}
                columns={[
                  { header: "Transaction", kind: "mono", cell: (t) => <Link href={`/transactions/${t.id}`}>{shortId(t.id)}</Link> },
                  { header: "Posted", kind: "mono", cell: (t) => formatTime(t.posted_at) },
                  { header: "Description", kind: "soft", cell: (t) => t.description ?? "" },
                  { header: "Status", kind: "mono", cell: (t) => t.status },
                ]}
              />
            )}
          </section>
        ) : null}
      </main>
      <Footer />
    </>
  );
}
