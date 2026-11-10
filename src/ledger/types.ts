export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
export type TxnStatus = "posted" | "reversed";

export interface OpenAccountInput {
  code: string;
  name: string;
  type: AccountType;
  currency: string;
}

export interface EntryInput {
  account_id: string;
  amount_minor: bigint;
  currency: string;
}

export interface PostTransactionInput {
  description?: string;
  entries: EntryInput[];
}

// Wire shapes. Money is a decimal string because it is a bigint.
export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  currency: string;
  balance_minor: string;
  version: number;
  created_at: string;
}

export interface Entry {
  transaction_id: string;
  account_id: string;
  amount_minor: string;
  currency: string;
  posted_at: string;
}

export interface TransactionEntry {
  account_id: string;
  amount_minor: string;
  currency: string;
}

export interface Transaction {
  id: string;
  description: string | null;
  status: TxnStatus;
  reverses_id: string | null;
  reversed_by: string | null;
  version: number;
  posted_at: string;
  entries: TransactionEntry[];
}

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}

export interface Integrity {
  ok: boolean;
  unbalanced_transactions: number;
  transactions_under_two_entries: number;
  drifted_accounts: number;
  accounts: number;
  transactions: number;
  entries: number;
  checked_at: string;
}

export interface Written<T> {
  value: T;
  replayed: boolean;
  // Duration of the posting database transaction, when the write ran one.
  dbMs?: number;
}
