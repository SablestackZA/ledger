import Link from "next/link";
import { DomainError } from "../../ledger/errors";
import { getLedger } from "../../server/container";
import { formatMinor, formatTime, normalSide, onNormalSide, shortId } from "../../surface/format";
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
            <div className="sbl-table-wrap">
              <table className="sbl-table">
                <caption className="sbl-label" style={{ display: "none" }}>Accounts</caption>
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Name</th>
                    <th scope="col">Type</th>
                    <th scope="col">Side</th>
                    <th scope="col" className="sbl-num">Balance</th>
                    <th scope="col">Currency</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.data.map((a) => (
                    <tr key={a.id}>
                      <td className="sbl-mono">{a.code}</td>
                      <td>{a.name}</td>
                      <td className="sbl-soft">{a.type}</td>
                      <td className="sbl-mono sbl-soft">{normalSide(a.type)}</td>
                      <td className="sbl-num">{formatMinor(onNormalSide(a.type, a.balance_minor), a.currency)}</td>
                      <td className="sbl-mono sbl-soft">{a.currency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
              <div className="sbl-table-wrap">
                <table className="sbl-table">
                  <thead>
                    <tr>
                      <th scope="col">Transaction</th>
                      <th scope="col">Posted</th>
                      <th scope="col">Description</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.data.map((t) => (
                      <tr key={t.id}>
                        <td className="sbl-mono"><Link href={`/transactions/${t.id}`}>{shortId(t.id)}</Link></td>
                        <td className="sbl-mono sbl-soft">{formatTime(t.posted_at)}</td>
                        <td className="sbl-soft">{t.description ?? ""}</td>
                        <td className="sbl-mono sbl-soft">{t.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}
      </main>
      <Footer />
    </>
  );
}
