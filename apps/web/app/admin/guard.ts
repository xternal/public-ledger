import "server-only";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { adminCredentials, checkAdminAuth } from "@ledger/server/triage";

/** Pages check access themselves too, so a proxy matcher change can never expose them. */
export async function requireAdmin(): Promise<void> {
  const h = await headers();
  if (checkAdminAuth(h.get("authorization"), adminCredentials()) !== "ok") notFound();
}
