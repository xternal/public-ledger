import type { Metadata } from "next";
import { requireAdmin } from "./guard";

export const metadata: Metadata = {
  title: "Editors’ triage | Public Ledger",
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <>
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-[1000px] items-center gap-4 px-4 sm:px-6">
          <a href="/admin" className="text-[15px] font-semibold tracking-[-0.01em] text-ink no-underline">
            Public Ledger · Editors’ triage
          </a>
        </div>
      </header>
      <div className="mx-auto max-w-[1000px] px-4 pt-6 sm:px-6">
        <p role="note" className="m-0 rounded-control border border-line bg-sunk px-3 py-2.5 text-label font-medium">
          Interim access control. Put Cloudflare Access or Vercel Authentication in front before launch.
        </p>
      </div>
      {children}
    </>
  );
}
