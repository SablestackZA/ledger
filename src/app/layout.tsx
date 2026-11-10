import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  icons: {
    icon: [
      // The ICO stays 32x32 so browsers with SVG support pick the SVG, whose ink follows the tab bar theme.
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/brand/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: [{ url: "/apple-touch-icon.png" }],
  },
  title: "Ledger | Sablestack",
  description:
    "A double-entry ledger API with a live integrity check and a reproducible load-test report. Built in-house by Sablestack (Pty) Ltd.",
};

export const viewport: Viewport = { themeColor: "#0a0a0a" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
