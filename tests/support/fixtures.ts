import { GET as listAccounts, POST as openAccountRoute } from "../../src/app/v1/accounts/route";
import { POST as postTransactionRoute } from "../../src/app/v1/transactions/route";
import { call } from "./harness";

let n = 0;

export async function openAccount(code: string, currency = "ZAR", type = "asset") {
  const res = await call(openAccountRoute, "/v1/accounts", {
    method: "POST",
    auth: true,
    key: `acct-${code}-${n++}`,
    body: { code, name: `Account ${code}`, type, currency },
  });
  if (res.status !== 201) throw new Error(`openAccount failed: ${JSON.stringify(res.body)}`);
  return res.body as { id: string; balance_minor: string };
}

export function transfer(from: string, to: string, amount: number | string, key: string, currency = "ZAR") {
  return call(postTransactionRoute, "/v1/transactions", {
    method: "POST",
    auth: true,
    key,
    body: {
      description: "test transfer",
      entries: [
        { account_id: to, amount_minor: amount, currency },
        { account_id: from, amount_minor: `-${amount}`, currency },
      ],
    },
  });
}

export { listAccounts };
