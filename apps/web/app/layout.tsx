import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { isAlpha, MAKER, SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: "Public Ledger: where UK public money comes from and goes",
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: { canonical: "/", types: { "application/atom+xml": [{ url: "/feeds/all.xml", title: "Public Ledger: every change" }] } },
  openGraph: { siteName: SITE_NAME, locale: "en_GB", type: "website", url: "/" },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
  authors: [{ name: MAKER.name, url: MAKER.url }],
  creator: MAKER.name,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#101820" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={GeistSans.variable}>
      <body>
        {isAlpha() && (
          <p className="m-0 bg-warn/10 px-4 py-1.5 text-center text-caption font-medium text-warn">
            Alpha: an early version. Promise cards are checked by AI Journalist, our automated reviewer; human editor review comes next.
          </p>
        )}
        {children}
        <footer className="mx-auto max-w-[1200px] px-4 pb-8 pt-6 text-caption text-muted sm:px-6">
          <p className="m-0 flex flex-wrap gap-x-3 gap-y-1">
            <span>
              Made by{" "}
              <a href={MAKER.url} rel="author">
                {MAKER.name}
              </a>
            </span>
            <span aria-hidden>·</span>
            <a href={MAKER.coffee} rel="noopener noreferrer" target="_blank">
              Buy me a coffee
            </a>
          </p>
        </footer>
      </body>
    </html>
  );
}
