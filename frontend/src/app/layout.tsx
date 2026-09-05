import type { Metadata } from "next";
import { Inter, Noto_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { LangSync } from "@/components/layout/LangSync";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const arabic = Noto_Sans_Arabic({ subsets: ["arabic"], variable: "--font-arabic", display: "swap" });

export const metadata: Metadata = {
  title: "SADD — Flood Command & Preparedness Twin",
  description: "Urban flood command & preparedness digital twin for a Gulf city (fictional operations center demo).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning className={`${inter.variable} ${arabic.variable}`}>
      <body className="h-full">
        <LangSync />
        {children}
      </body>
    </html>
  );
}
