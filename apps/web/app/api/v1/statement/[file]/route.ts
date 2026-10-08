import { splitFormat } from "@ledger/server/api";
import { api } from "@/lib/api";
import { getSeed } from "@/lib/data";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return getSeed().years.flatMap((y) => [{ file: y.period }, { file: `${y.period}.csv` }]);
}

/** One year, line by line: /api/v1/statement/{year} (JSON) or /api/v1/statement/{year}.csv */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { key, format } = splitFormat((await params).file);
  return api.statementYear(key, format);
}
