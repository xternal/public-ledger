import { splitFormat } from "@ledger/server/api";
import { api } from "@/lib/api";
import { getSeed } from "@/lib/data";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return getSeed().cards.map((c) => ({ file: c.id }));
}

/** One promise card, with its full history: /api/v1/promises/{id} */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  return api.promise(splitFormat((await params).file).key);
}
