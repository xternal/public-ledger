import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Public Ledger",
  description: "An open P&L of the UK state: where public money comes from, where it goes, and what every promise would cost.",
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
