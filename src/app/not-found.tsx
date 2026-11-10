import { Empty, Footer, Nav } from "../surface/ui";

export default function NotFound() {
  return (
    <>
      <Nav />
      <main className="sbl-page" style={{ padding: "72px 0" }}>
        <Empty title="Not found" body="That account or transaction does not exist in the demo ledger. It is reseeded nightly, so earlier ids may be gone." action={{ href: "/accounts", label: "Open the explorer" }} />
      </main>
      <Footer />
    </>
  );
}
