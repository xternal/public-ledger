import { feedResponse, feedTargets, keyFromFile } from "../../feed-response";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return feedTargets().actors.map((a) => ({ file: `${a.id}.xml` }));
}

/** An actor's cards and, for a party, its people's cards (Atom): /feeds/actor/{actorId}.xml */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const key = keyFromFile((await params).file);
  if (!key) return new Response("Not found", { status: 404 });
  return feedResponse("actor", key);
}
