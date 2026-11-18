import type { Metadata, Viewport } from "next";
import { Inter, Manrope, Geist_Mono } from "next/font/google";
import "./globals.css";
import AppHeader from "./components/AppHeader";
import ThemeSync from "./theme/ThemeSync";
import { readThemePref } from "@/src/theme/store";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["200", "300", "500"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Wallet Sync",
  description: "Import broker exports into BudgetBakers Wallet — locally, idempotently.",
  appleWebApp: { capable: true, title: "Wallet", statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/180" },
};

// Every page reads the local database, so nothing may be prerendered at build time.
export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pref = await readThemePref();
  return (
    <html
      lang="en"
      data-theme="wallet-dark"
      data-theme-pref={pref}
      suppressHydrationWarning
      className={`${inter.variable} ${manrope.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Blocking on purpose: sets data-theme before first paint. */}
        <script src="/theme-boot.js" />
        <meta name="theme-color" content="#0f1115" />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeSync pref={pref} />
        <AppHeader />
        <div className="min-w-0 flex-1 pb-[calc(76px+env(safe-area-inset-bottom))] lg:pb-10 lg:pl-56 lg:pt-6">{children}</div>
      </body>
    </html>
  );
}
