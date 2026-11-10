import type { ReactNode } from "react";

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  kind?: "mono" | "num" | "soft";
}

const cls = (kind?: Column<unknown>["kind"]) => (kind === "mono" ? "sbl-mono" : kind === "num" ? "sbl-num" : kind === "soft" ? "sbl-soft" : undefined);
const empty = (v: ReactNode) => v === null || v === undefined || v === false || v === "";

// Table from 640px up, one card per row below. Both are rendered and CSS shows one, so each keeps its semantics.
export function DataTable<T>({ columns, rows, rowKey }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T, index: number) => string }) {
  return (
    <>
      <div className="sbl-table-wrap sbl-only-wide">
        <table className="sbl-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.header} scope="col" className={c.kind === "num" ? "sbl-num" : undefined}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={rowKey(row, i)}>
                {columns.map((c) => (
                  <td key={c.header} className={cls(c.kind)}>{c.cell(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="sbl-rows sbl-only-narrow">
        {rows.map((row, i) => {
          const [first, ...rest] = columns;
          return (
            <li key={rowKey(row, i)} className="sbl-row">
              <div className={`sbl-row-title ${cls(first!.kind) ?? ""}`}>{first!.cell(row)}</div>
              <dl>
                {rest.map((c) => {
                  const value = c.cell(row);
                  return empty(value) ? null : (
                    <div key={c.header} className="sbl-row-field">
                      <dt>{c.header}</dt>
                      <dd className={cls(c.kind)}>{value}</dd>
                    </div>
                  );
                })}
              </dl>
            </li>
          );
        })}
      </ul>
    </>
  );
}
