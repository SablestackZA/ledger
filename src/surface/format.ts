import type { AccountType } from "../ledger/types";

// ISO 4217 minor-unit exponents that differ from the default of 2.
const EXPONENT: Record<string, number> = { JPY: 0, KRW: 0, VND: 0, BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3 };

export function formatMinor(minor: string | bigint, currency: string, opts: { sign?: boolean } = {}): string {
  const value = BigInt(minor);
  const exp = EXPONENT[currency] ?? 2;
  const digits = (value < 0n ? -value : value).toString().padStart(exp + 1, "0");
  const whole = digits.slice(0, digits.length - exp).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const text = exp === 0 ? whole : `${whole}.${digits.slice(digits.length - exp)}`;
  if (value < 0n) return `-${text}`;
  return opts.sign && value > 0n ? `+${text}` : text;
}

// Balances are stored debit-positive. Debit-normal accounts show as stored; credit-normal
// accounts are negated so their usual balance reads positive. A negative figure is abnormal.
const DEBIT_NORMAL: ReadonlySet<AccountType> = new Set(["asset", "expense"]);

export const normalSide = (type: AccountType): "Dr" | "Cr" => (DEBIT_NORMAL.has(type) ? "Dr" : "Cr");

export function onNormalSide(type: AccountType, balanceMinor: string): bigint {
  const v = BigInt(balanceMinor);
  return DEBIT_NORMAL.has(type) ? v : -v;
}

export const shortId = (id: string) => `${id.slice(0, 8)}...${id.slice(-4)}`;

export const formatTime = (iso: string) => iso.slice(0, 19).replace("T", " ") + "Z";
