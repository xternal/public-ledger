import { feedResponse, feedTargets, keyFromFile } from "../../feed-response";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return feedTargets().areas.map((a) => ({ file: `${a.id}.xml` }));
}

/** Cards in one policy area (Atom): /feeds/area/{policyArea}.xml */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const key = keyFromFile((await params).file);
  if (!key) return new Response("Not found", { status: 404 });
  return feedResponse("area", key);
}
