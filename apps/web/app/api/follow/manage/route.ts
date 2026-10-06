import { deleteByManageToken, isCadence, parseTarget, removeTarget, setCadence } from "@ledger/server/follow";
import { followContext } from "@/app/follow/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The manage page's forms post here: { t, action: cadence | remove | delete, cadence?, kind?, id? }.
 * Plain HTML forms with a redirect back, so the page works without JavaScript.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const t = form.get("t");
  const token = typeof t === "string" ? t : "";
  const back = (m: string, keepToken = true) => {
    const q = keepToken ? `t=${encodeURIComponent(token)}&m=${m}` : `m=${m}`;
    return new Response(null, { status: 303, headers: { location: new URL(`/follow/manage?${q}`, req.url).toString(), "cache-control": "no-store" } });
  };
  const ctx = await followContext();

  switch (form.get("action")) {
    case "cadence": {
      const cadence = form.get("cadence");
      if (!isCadence(cadence)) return back("error");
      return (await setCadence(ctx, token, cadence)) ? back(cadence === "weekly" ? "weekly" : "instant") : back("invalid", false);
    }
    case "remove": {
      const target = parseTarget({ kind: form.get("kind"), id: form.get("id") });
      if (!target) return back("error");
      const r = await removeTarget(ctx, token, target);
      if (r === "invalid") return back("invalid", false);
      if (r === "deleted") return back("deleted", false);
      return back("removed");
    }
    case "delete":
      return (await deleteByManageToken(ctx, token, "delete")) ? back("deleted", false) : back("invalid", false);
    default:
      return back("error");
  }
}
