import type { Metadata, Viewport } from "next";
import { Inter, Manrope, Geist_Mono } from "next/font/google";
import "./globals.css";
import AppHeader from "./components/AppHeader";

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
  themeColor: "#0f1115",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${inter.variable} ${manrope.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AppHeader />
        <div className="min-w-0 flex-1 pb-[calc(76px+env(safe-area-inset-bottom))]">{children}</div>
      </body>
    </html>
  );
}
