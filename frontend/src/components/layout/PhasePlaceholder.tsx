"use client";

import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { t, type TKey } from "@/lib/i18n";
import { useUi } from "@/lib/store";

/** Honest build-order marker for tabs that arrive in a later phase (CLAUDE.md §13). */
export function PhasePlaceholder({ titleKey, bodyKey, phase }: { titleKey: TKey; bodyKey: TKey; phase: number }) {
  const lang = useUi((s) => s.lang);
  const widgets = t(lang, bodyKey).split(/[,.;]\s+/).map((w) => w.trim()).filter((w) => w.length > 3);
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="glass glass-hero max-w-2xl px-9 py-8">
        <div className="flex items-center gap-3">
          <span className="panel-title">{t(lang, "phase")} {phase}</span>
          <span className="accent-line" />
          <span className="status-pill gap-1.5 text-accent"><Sparkles size={12} /> {t(lang, "coming_title")}</span>
        </div>
        <h1 className="display mt-4 text-[30px] text-fg">{t(lang, titleKey)}</h1>
        <p className="mt-3 max-w-xl text-[13.5px] leading-relaxed text-fg-2">{t(lang, bodyKey)}</p>
        <div className="label mt-6 mb-2">{t(lang, "coming_widgets")}</div>
        <div className="flex flex-wrap gap-2">
          {widgets.map((w) => (
            <span key={w} className="chip cursor-default">{w}</span>
          ))}
        </div>
        <Link href="/" className="mt-7 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-accent hover:underline">
          <ArrowLeft size={14} className="rtl:rotate-180" /> {t(lang, "back_to_command")}
        </Link>
      </div>
    </div>
  );
}
