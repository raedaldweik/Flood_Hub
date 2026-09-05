"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { Languages, Waves } from "lucide-react";
import { t } from "@/lib/i18n";
import { useUi } from "@/lib/store";
import { fmtTime } from "@/lib/format";
import { DataModePill } from "@/components/command/DataModePill";
import type { Meta } from "@/lib/api";

const TABS = [
  { href: "/", key: "tab_command", phase: null },
  { href: "/simulation", key: "tab_simulation", phase: 4 },
  { href: "/response", key: "tab_response", phase: 4 },
  { href: "/executive", key: "tab_executive", phase: 4 },
] as const;

export function Header({ meta }: { meta?: Meta }) {
  const lang = useUi((s) => s.lang);
  const setLang = useUi((s) => s.setLang);
  const pathname = usePathname();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-4 border-b border-line bg-bg-2/80 px-4 backdrop-blur">
      <Link href="/" className="flex items-center gap-3">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 text-accent ring-1 ring-accent/30">
          <Waves size={17} strokeWidth={2.2} />
        </span>
        <span className="leading-tight">
          <span className="flex items-baseline gap-2">
            <span className="text-[15px] font-semibold tracking-tight">{t(lang, "app_name")}</span>
            <span className="text-[13px] text-fg-2">{t(lang, "app_name_ar")}</span>
          </span>
          <span className="block text-[11px] text-muted">
            {t(lang, "foc")} · <span className="text-muted/80">{t(lang, "fictional")}</span>
          </span>
        </span>
      </Link>

      <nav className="ms-6 flex items-center gap-1">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={clsx(
                "group relative flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] transition-colors",
                active ? "bg-white/[0.06] text-fg" : "text-fg-2 hover:bg-white/[0.04] hover:text-fg",
              )}
            >
              {t(lang, tab.key)}
              {tab.phase && (
                <span className="rounded bg-white/[0.06] px-1.5 py-px text-[10px] font-medium text-muted ring-1 ring-line">
                  P{tab.phase}
                </span>
              )}
              {active && <span className="absolute inset-x-3 -bottom-[13px] h-px bg-accent" />}
            </Link>
          );
        })}
      </nav>

      <div className="ms-auto flex items-center gap-3">
        <DataModePill meta={meta} />
        <button
          onClick={() => setLang(lang === "en" ? "ar" : "en")}
          className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12px] text-fg-2 transition hover:border-line-2 hover:text-fg"
          aria-label="Toggle language"
        >
          <Languages size={14} />
          {t(lang, "lang_toggle")}
        </button>
        <div className="num min-w-[86px] text-end text-[13px] tabular-nums text-fg-2">
          {now ? fmtTime(now, lang) : "--:--"} <span className="text-[10px] text-muted">AST</span>
        </div>
      </div>
    </header>
  );
}
