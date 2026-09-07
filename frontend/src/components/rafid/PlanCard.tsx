"use client";

import clsx from "clsx";
import { Check, Route, ShieldCheck } from "lucide-react";
import type { DispatchPlan } from "@/lib/api";
import { t, type Lang } from "@/lib/i18n";

export type PlanCardPlan = DispatchPlan & { approving?: boolean };

interface Props {
  plan: PlanCardPlan;
  lang: Lang;
  onApprove: () => void;
  /** zone_id → display name (falls back to a humanised id). */
  names?: Record<string, string>;
  error?: string | null;
}

/**
 * A Rafid-proposed dispatch plan awaiting the operator's APPROVE. Shared by the Rafid dock and the
 * Simulation Lab so the governance moment looks identical wherever it happens (CLAUDE.md §7).
 */
export function PlanCard({ plan, lang, onApprove, names, error }: Props) {
  const approved = plan.status === "approved";
  const rejected = plan.status === "rejected";
  const rows = [...plan.zones].sort((a, b) => b.pumps - a.pumps);
  const dmg = plan.delta.damage_qar ?? 0;
  const name = (id: string) => names?.[id] ?? id.replace(/_/g, " ");
  return (
    <div className="glass-inset overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Route size={13} className="text-accent" />
        <span className="text-[11.5px] font-extrabold">{t(lang, "rafid_plan_title")}</span>
        <span className="ms-auto font-mono text-[10px] text-muted">#{plan.plan_id} · ×{plan.storm_multiplier.toFixed(2)}</span>
      </div>
      <ul className="divide-y divide-line/60 px-3 py-1">
        {rows.map((z) => (
          <li key={z.zone_id} className="flex items-center gap-2 py-1.5 text-[11.5px]">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: `var(--color-${z.peak_band})` }} />
            <span className="min-w-0 flex-1 truncate font-semibold text-fg-2">{name(z.zone_id)}</span>
            <span className="font-mono text-[11px] text-fg">{z.pumps} {t(lang, "rafid_trucks")}</span>
            <span className="w-[74px] text-end font-mono text-[10.5px] text-muted" dir="ltr">{z.baseline_time_to_drain_h.toFixed(1)}→{z.time_to_drain_h.toFixed(1)} h</span>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-2 border-t border-line px-3 py-2 text-[11px]">
        <div><span className="text-muted">{t(lang, "rafid_all_clear")}</span> <span className="font-mono font-bold text-fg">{plan.expected.all_clear_h?.toFixed(1)} h</span> <span className="text-muted">({t(lang, "rafid_baseline")} {plan.baseline.all_clear_h?.toFixed(1)} h)</span></div>
        <div className="text-end"><span className="text-muted">{t(lang, "rafid_damage")}</span> <span className={clsx("font-mono font-bold", dmg < 0 ? "text-green" : "text-fg")} dir="ltr">{dmg < 0 ? "−" : "+"}{Math.abs(dmg / 1e6).toFixed(2)}M QAR</span></div>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-3 py-2">
        {approved ? (
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-green"><Check size={13} /> {t(lang, "rafid_approved")} · {plan.result?.trucks_moved} {t(lang, "rafid_trucks")} · {plan.result?.rule} · #{plan.result?.decision_id}</span>
        ) : rejected ? (
          <span className="text-[11px] font-bold text-red">{t(lang, "rafid_rejected")}{error ? ` · ${error}` : ""}</span>
        ) : (
          <>
            <span className="min-w-0 flex-1 text-[10.5px] leading-snug text-muted">{t(lang, "rafid_plan_note")}</span>
            <button onClick={onApprove} disabled={plan.approving} className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-extrabold text-[#06121a] transition hover:brightness-110 disabled:opacity-60" style={{ background: "var(--cyan-grad)" }}>
              <ShieldCheck size={13} /> {plan.approving ? t(lang, "rafid_approving") : t(lang, "rafid_approve")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
