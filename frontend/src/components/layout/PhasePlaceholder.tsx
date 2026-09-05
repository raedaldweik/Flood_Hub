"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { t, type TKey } from "@/lib/i18n";
import { useUi } from "@/lib/store";

/** Honest build-order marker for tabs that arrive in a later phase (CLAUDE.md §13). */
export function PhasePlaceholder({ titleKey, bodyKey, phase }: { titleKey: TKey; bodyKey: TKey; phase: number }) {
  const lang = useUi((s) => s.lang);
  return (
    <div className="backdrop grid h-full place-items-center p-6">
      <div className="glass max-w-xl px-8 py-7">
        <div className="label">{t(lang, "phase")} {phase}</div>
        <h1 className="mt-1 text-[22px] font-semibold">{t(lang, titleKey)}</h1>
        <p className="mt-3 text-[13.5px] leading-relaxed text-fg-2">{t(lang, bodyKey)}</p>
        <Link href="/" className="mt-5 inline-flex items-center gap-1.5 text-[12.5px] text-accent hover:underline">
          <ArrowLeft size={14} className="rtl:rotate-180" /> {t(lang, "back_to_command")}
        </Link>
      </div>
    </div>
  );
}
