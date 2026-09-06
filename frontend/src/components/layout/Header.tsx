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
  // trailingSlash export → "/simulation/"; normalise so the active tab matches either form.
  const pathname = (usePathname() ?? "/").replace(/\/+$/, "") || "/";
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="relative z-30 grid h-[62px] shrink-0 grid-cols-[auto_1fr_auto] items-center gap-5 px-5">
      <Link href="/" className="flex items-center gap-3">
        <span className="avatar-ring grid h-9 w-9 place-items-center text-[#06121a]">
          <Waves size={19} strokeWidth={2.4} />
        </span>
        <span className="leading-tight">
          <span className="flex items-baseline gap-2">
            <span className="text-[17px] font-extrabold tracking-tight">{t(lang, "app_name")}</span>
            <span className="text-[14px] font-medium text-fg-2">{t(lang, "app_name_ar")}</span>
          </span>
          <span className="block text-[11px] text-muted">
            {t(lang, "foc")} <span className="mx-1 opacity-50">·</span> {t(lang, "fictional")}
          </span>
        </span>
      </Link>

      <div className="flex min-w-0 items-center gap-4">
        <nav className="seg">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link key={tab.href} href={tab.href} className={clsx("flex items-center gap-2", active && "on")}>
                {t(lang, tab.key)}
                {tab.phase && (
                  <span className="rounded-md bg-white/[0.06] px-1.5 py-px font-mono text-[9.5px] font-bold text-muted ring-1 ring-line">
                    P{tab.phase}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <span className="accent-line" />
      </div>

      <div className="flex items-center gap-2.5">
        <DataModePill meta={meta} />
        <button onClick={() => setLang(lang === "en" ? "ar" : "en")} className="btn-ghost" aria-label="Toggle language">
          <Languages size={14} />
          {t(lang, "lang_toggle")}
        </button>
        <div className="num min-w-[92px] text-end">
          <div className="text-[15px] font-bold leading-none">{now ? fmtTime(now, lang) : "--:--"}</div>
          <div className="text-[10px] tracking-wider text-muted">DOHA · AST</div>
        </div>
      </div>
    </header>
  );
}
