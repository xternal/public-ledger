import { feedResponse, feedTargets, keyFromFile } from "../../feed-response";

export const dynamic = "force-static";
export const dynamicParams = false;
// The monthly "coming due" entry moves on with the calendar, not only with a deploy: rebuild every 6 hours.
export const revalidate = 21600;

export function generateStaticParams() {
  return feedTargets().windows.map((w) => ({ file: `${w.id}.xml` }));
}

/** Promises due in a window (Atom): /feeds/deadlines/{window}.xml, e.g. next-3-months.xml */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const key = keyFromFile((await params).file);
  if (!key) return new Response("Not found", { status: 404 });
  return feedResponse("deadlines", key);
}
