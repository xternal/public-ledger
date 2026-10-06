import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/site";
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
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={GeistSans.variable}>
      <body>{children}</body>
    </html>
  );
}
