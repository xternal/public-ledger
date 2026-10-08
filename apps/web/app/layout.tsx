import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { isAlpha, MAKER, OPEN_GRAPH, SITE_DESCRIPTION, SITE_NAME, siteUrl, SOURCE_CODE } from "@/lib/site";
import { FooterLink } from "@/components/FooterLink";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: "Public Ledger: where UK public money comes from and goes",
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  // No canonical here: each public page names its own, and a page without one (a 404, a private link) must not claim to be the home page.
  alternates: { types: { "application/atom+xml": [{ url: "/feeds/all.xml", title: "Public Ledger: every change" }] } },
  openGraph: { ...OPEN_GRAPH, type: "website" },
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
            Alpha: an early version. Promise cards are checked by AI Journalist, our automated reviewer; human editor review comes next.{" "}
            <a href="/editors" className="text-warn underline underline-offset-2">
              Become an editor
            </a>
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
            <span aria-hidden>·</span>
            <FooterLink href="/privacy">Privacy</FooterLink>
            <span aria-hidden>·</span>
            <a href="/method#licence">Our text: CC BY 4.0 · Data: Open Government Licence</a>
            <span aria-hidden>·</span>
            <a href={SOURCE_CODE.url}>Source code</a>
          </p>
        </footer>
      </body>
    </html>
  );
}
