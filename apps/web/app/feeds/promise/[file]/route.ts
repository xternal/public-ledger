import { feedResponse, feedTargets, keyFromFile } from "../../feed-response";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return feedTargets().promises.map((p) => ({ file: `${p.id}.xml` }));
}

/** Changes to one promise card (Atom): /feeds/promise/{promiseId}.xml */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const key = keyFromFile((await params).file);
  if (!key) return new Response("Not found", { status: 404 });
  return feedResponse("promise", key);
}
