"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { useSWRConfig } from "swr";
import { Bot, CloudRainWind, FlaskConical, Info, MessageSquareText, Minus, Plus, RotateCcw, Wrench } from "lucide-react";
import { useAgentStatus, useAssets, useMeta, useSimBaseline, useZones } from "@/hooks/useData";
import type { ZoneNow } from "@/hooks/useZoneNow";
import { approvePlan, endpoints, proposePlan, simulate, type ScenarioIn, type SimKpis, type SimResult, type SimZone } from "@/lib/api";
import { fmtCompact, fmtInt } from "@/lib/format";
import { bandLabel, t, type Lang, type TKey } from "@/lib/i18n";
import { BAND_COLORS, riskColor } from "@/lib/risk";
import { useUi } from "@/lib/store";
import { CityMap } from "@/components/map/CityMap";
import { Legend } from "@/components/map/Legend";
import { PlanCard, type PlanCardPlan } from "@/components/rafid/PlanCard";

const MAX_PER_ZONE = 6;
const DRAIN_UPGRADE_PCT = 20;
const STORM_MIN = 50;
const STORM_MAX = 200;

/**
 * Tab 2 — Act 3. A stateless what-if per control change (the backend answers in ~25 ms), the same map
 * lit by PEAK risk under the scenario, and the governance moment: Rafid proposes, R-05 validates, the
 * operator approves, trucks move. The agent never applies anything itself (CLAUDE.md §7).
 */
export function SimulationLab() {
  const lang = useUi((s) => s.lang);
  const tick = useUi((s) => s.tick);
  const askRafid = useUi((s) => s.askRafid);
  const { data: meta } = useMeta();
  const ready = meta?.startup?.phase === "ready";
  const { data: zones } = useZones(ready);
  const { data: assets } = useAssets(ready);
  const { data: baseline } = useSimBaseline(ready);
  const { data: agent } = useAgentStatus();
  const { mutate } = useSWRConfig();

  const [storm, setStorm] = useState(100);
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const [prepositioned, setPrepositioned] = useState(false);
  const [drainUp, setDrainUp] = useState(false);
  const [result, setResult] = useState<SimResult>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanCardPlan | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const fleetSize = useMemo(() => (assets ?? []).filter((a) => a.type === "pump_truck").length || 24, [assets]);
  const allocated = useMemo(() => Object.values(alloc).reduce((s, n) => s + n, 0), [alloc]);
  const names = useMemo(
    () => Object.fromEntries((zones?.features ?? []).map((z) => [z.properties.id, lang === "ar" ? z.properties.name_ar : z.properties.name_en])),
    [zones, lang],
  );

  // Debounced + abortable: every slider tick fires one request and stale answers never land.
  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    const body: ScenarioIn = {
      storm_multiplier: storm / 100,
      allocations: alloc,
      prepositioned,
      drain_upgrade_pct: drainUp ? DRAIN_UPGRADE_PCT : 0,
    };
    setPending(true);
    const id = setTimeout(() => {
      simulate(body, ctrl.signal)
        .then((r) => {
          setResult(r);
          setError(null);
          setPending(false);
        })
        .catch((e: unknown) => {
          if ((e as Error).name === "AbortError") return;
          setError(e instanceof Error ? e.message : String(e));
          setPending(false);
        });
    }, 80);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [ready, storm, alloc, prepositioned, drainUp]);

  const states = useMemo<Record<string, ZoneNow>>(
    () =>
      Object.fromEntries(
        (result?.zones ?? []).map((z) => [
          z.zone_id,
          { risk: z.peak_risk, band: z.peak_band, rain: 0, cum3h: 0, exceedance: 0, depth: z.peak_depth_cm, flooded: z.flooded_h > 0 },
        ]),
      ),
    [result],
  );
  const baseZones = useMemo(() => Object.fromEntries((baseline?.zones ?? []).map((z) => [z.zone_id, z])), [baseline]);
  const ordered = useMemo(() => [...(result?.zones ?? [])].sort((a, b) => b.peak_risk - a.peak_risk || a.zone_id.localeCompare(b.zone_id)), [result]);

  const bump = (zoneId: string, d: number) =>
    setAlloc((cur) => {
      const next = Math.max(0, Math.min(MAX_PER_ZONE, (cur[zoneId] ?? 0) + d));
      if (d > 0 && allocated >= fleetSize) return cur;
      const out = { ...cur, [zoneId]: next };
      if (next === 0) delete out[zoneId];
      return out;
    });

  const reset = () => {
    setStorm(100);
    setAlloc({});
    setPrepositioned(false);
    setDrainUp(false);
    setPlan(null);
    setPlanError(null);
  };

  const propose = async () => {
    setPlanBusy(true);
    setPlanError(null);
    try {
      setPlan(await proposePlan({ storm_multiplier: storm / 100, tick, lang }));
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanBusy(false);
    }
  };

  const approve = async () => {
    if (!plan) return;
    setPlan({ ...plan, approving: true });
    try {
      const res = await approvePlan(plan.plan_id);
      setPlan({ ...plan, approving: false, status: "approved", result: res.result });
      // The approved plan becomes the scenario: allocations + pre-positioned, so time-to-drain visibly drops.
      setAlloc(plan.allocations);
      setPrepositioned(true);
      void mutate(endpoints.assets);
      void mutate(endpoints.decisions);
    } catch (e) {
      setPlan({ ...plan, approving: false, status: "rejected" });
      setPlanError(e instanceof Error ? e.message : String(e));
    }
  };

  const kpis = result?.kpis;
  const base = result?.baseline ?? baseline?.kpis;
  const online = agent?.online ?? false;

  return (
    <div className="grid h-full min-h-0 grid-cols-[384px_minmax(0,1fr)] gap-3">
      {/* ── Control rail ─────────────────────────────────────────────── */}
      <aside className="glass flex min-h-0 flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <span className="panel-title">{t(lang, "sim_title")}</span>
          <span className="accent-line" />
          <span className="status-pill py-1 text-[10px] text-accent">{t(lang, "sim_act")}</span>
          <button onClick={reset} className="btn-ghost px-2" title={t(lang, "sim_reset")} aria-label={t(lang, "sim_reset")}>
            <RotateCcw size={13} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {/* Storm intensity */}
          <section>
            <div className="flex items-end justify-between">
              <div className="flex items-center gap-2">
                <span className="glass-inset grid h-7 w-7 place-items-center text-accent"><CloudRainWind size={14} /></span>
                <div>
                  <div className="text-[12.5px] font-extrabold text-fg">{t(lang, "sim_storm")}</div>
                  <div className="text-[10.5px] text-muted">{t(lang, "sim_storm_hint")}</div>
                </div>
              </div>
              <div className="display num text-[34px]" style={{ color: storm > 100 ? riskColor(40 + ((storm - 100) / 100) * 60) : "#22d3ee", textShadow: "0 0 22px rgba(34,211,238,0.35)" }}>
                {storm}<span className="text-[16px] text-muted">%</span>
              </div>
            </div>
            <input
              type="range"
              min={STORM_MIN}
              max={STORM_MAX}
              step={5}
              value={storm}
              onChange={(e) => setStorm(Number(e.target.value))}
              className="slider mt-1"
              style={{ ["--pct" as string]: `${((storm - STORM_MIN) / (STORM_MAX - STORM_MIN)) * 100}%` }}
              aria-label={t(lang, "sim_storm")}
            />
            <div className="flex justify-between text-[10px] font-semibold text-muted">
              <span>50%</span>
              <span className="text-fg-2">100% · {t(lang, "sim_baseline")}</span>
              <span>200%</span>
            </div>
          </section>

          {/* Preparedness toggles */}
          <section className="space-y-2">
            <Toggle on={prepositioned} onChange={setPrepositioned} label={t(lang, "sim_prepared")} hint={t(lang, "sim_prepared_hint")} />
            <Toggle on={drainUp} onChange={setDrainUp} label={t(lang, "sim_drain")} hint={t(lang, "sim_drain_hint")} />
          </section>

          {/* Fleet allocator */}
          <section>
            <div className="flex items-center gap-3">
              <span className="panel-title">{t(lang, "sim_fleet")}</span>
              <span className="accent-line" />
              <span className="group relative">
                <Info size={12} className="text-muted" />
                <span className="pointer-events-none absolute end-0 top-5 z-20 hidden w-64 rounded-lg border border-line bg-panel-solid p-2.5 text-[11px] leading-snug text-fg-2 shadow-xl group-hover:block">
                  {t(lang, "sim_fleet_hint")}<br /><span className="font-mono text-[10px] text-accent" dir="ltr">{t(lang, "sim_formula")}</span>
                </span>
              </span>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                <div className="h-full rounded-full transition-all duration-300" style={{ width: `${(allocated / fleetSize) * 100}%`, background: "var(--cyan-grad)" }} />
              </div>
              <span className="num text-[11.5px] font-bold text-fg">{fmtInt(allocated, lang)} / {fmtInt(fleetSize, lang)}</span>
              <span className="text-[10.5px] text-muted">{t(lang, "sim_deployed")}</span>
            </div>
            <ul className="mt-2 space-y-1">
              {ordered.map((z) => {
                const n = alloc[z.zone_id] ?? 0;
                const before = baseZones[z.zone_id]?.time_to_drain_h ?? 0;
                const color = BAND_COLORS[z.peak_band];
                const cold = z.peak_risk < 40 && n === 0;
                return (
                  <li key={z.zone_id} className={clsx("glass-inset flex items-center gap-2 px-2.5 py-1.5", cold && "opacity-60")}>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-bold text-fg">{names[z.zone_id] ?? z.zone_id}</div>
                      <div className="num text-[10.5px] text-muted" dir="ltr">
                        {z.flooded_h > 0 || before > 0 ? (
                          <>
                            {t(lang, "sim_ttd")}: <span className="text-fg-2">{before.toFixed(1)}</span> → <span className={clsx("font-bold", z.time_to_drain_h < before ? "text-green" : z.time_to_drain_h > before ? "text-orange" : "text-fg")}>{z.time_to_drain_h.toFixed(1)} h</span>
                          </>
                        ) : (
                          <span>{t(lang, "sim_no_flood")}</span>
                        )}
                      </div>
                    </div>
                    <button onClick={() => bump(z.zone_id, -1)} disabled={n === 0} className="stepper" aria-label="−"><Minus size={12} /></button>
                    <span className="num w-5 text-center text-[13px] font-extrabold text-fg">{n}</span>
                    <button onClick={() => bump(z.zone_id, +1)} disabled={n >= MAX_PER_ZONE || allocated >= fleetSize} className="stepper" aria-label="+"><Plus size={12} /></button>
                  </li>
                );
              })}
              {ordered.length === 0 && [0, 1, 2, 3, 4, 5].map((i) => <li key={i} className="shimmer h-10 rounded-xl" />)}
            </ul>
          </section>

          {/* Rafid */}
          <section className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="panel-title">{t(lang, "rafid_title")}</span>
              <span className="accent-line" />
            </div>
            <p className="text-[11px] leading-snug text-muted">{t(lang, "sim_ask_hint")}</p>
            <div className="flex gap-2">
              <button
                onClick={propose}
                disabled={planBusy || !ready}
                className="glow-cyan flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[12px] font-extrabold text-[#06121a] transition hover:brightness-110 disabled:opacity-60"
                style={{ background: "var(--cyan-grad)" }}
              >
                <Bot size={15} /> {planBusy ? t(lang, "sim_ask_busy") : t(lang, "sim_ask")}
              </button>
              {online && (
                <button
                  onClick={() => askRafid(t(lang, "sim_ask_chat_prompt").replace("{pct}", String(storm)))}
                  className="btn-ghost"
                  title={t(lang, "sim_ask_chat")}
                >
                  <MessageSquareText size={13} /> {t(lang, "sim_ask_chat")}
                </button>
              )}
            </div>
            {plan && (
              <div className="trace-panel animate-fade-up">
                <div className="trace-step">
                  <Wrench size={11} className="mt-0.5 shrink-0 text-accent" />
                  <div className="min-w-0 flex-1 text-[11px] leading-snug text-fg-2">
                    <span className="font-semibold text-muted">{t(lang, "rafid_used")}:</span> <span className="trace-step-tool">planner</span> → <span className="font-mono text-[10.5px]" dir="ltr">propose_dispatch_plan(storm_multiplier={(plan.storm_multiplier).toFixed(2)})</span>
                    <span className="block text-[10.5px] text-muted">↳ plan {plan.plan_id} · {fmtInt(Object.values(plan.allocations).reduce((s, n) => s + n, 0), lang)} {t(lang, "rafid_trucks")} · {plan.status}</span>
                  </div>
                </div>
              </div>
            )}
            {plan && <div className="animate-fade-up"><PlanCard plan={plan} lang={lang} names={names} onApprove={approve} error={planError} /></div>}
            {plan?.status === "approved" && (
              <div className="rounded-lg bg-green/10 px-3 py-2 text-[11px] font-bold text-green ring-1 ring-green/30">{t(lang, "sim_applied")}</div>
            )}
            {planError && plan?.status !== "rejected" && (
              <div className="rounded-lg bg-red/10 px-3 py-2 text-[11.5px] text-red ring-1 ring-red/30">{planError}</div>
            )}
          </section>
        </div>
      </aside>

      {/* ── Map + readouts ───────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-col gap-3">
        <BeforeAfter base={base} now={kpis} lang={lang} pending={pending} />

        <div className="glass-hero relative min-h-0 flex-1 overflow-hidden rounded-[18px] ring-1 ring-line">
          {zones ? <CityMap zones={zones.features} states={states} assets={assets ?? []} chromeBottom={14} /> : <div className="backdrop absolute inset-0" />}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-3.5">
            <div className="pointer-events-auto"><Legend /></div>
            <div className="flex flex-col items-end gap-2">
              <span className="status-pill text-yellow" style={{ borderColor: "rgba(234,179,8,0.35)" }}>
                <FlaskConical size={12} /> {t(lang, "sim_map_note")} · {t(lang, "pill_simulated")}
              </span>
              <AllClear kpis={kpis} base={base} lang={lang} />
            </div>
          </div>
          {error && (
            <div className="absolute bottom-3 start-3 z-10 rounded-lg bg-red/15 px-3 py-2 text-[11.5px] text-red ring-1 ring-red/40">{t(lang, "sim_error")}: {error}</div>
          )}
        </div>

        <Outcomes zones={ordered} names={names} lang={lang} />
      </div>
    </div>
  );
}

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="glass-inset flex w-full items-center gap-3 px-3 py-2.5 text-start transition hover:bg-white/[0.06]" aria-pressed={on}>
      <span className={clsx("switch", on && "on")} />
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-bold text-fg">{label}</span>
        <span className="block text-[10.5px] leading-snug text-muted">{hint}</span>
      </span>
    </button>
  );
}

function AllClear({ kpis, base, lang }: { kpis?: SimKpis; base?: SimKpis; lang: Lang }) {
  if (!kpis) return null;
  const none = kpis.zones_flooded === 0;
  return (
    <div className="glass glass-strong pointer-events-auto px-4 py-2.5 text-end">
      <div className="label">{none ? t(lang, "sim_all_clear_none") : t(lang, "sim_all_clear")}</div>
      {!none && (
        <div className="flex items-baseline justify-end gap-2" dir="ltr">
          <span className="display num text-[30px]" style={{ color: kpis.all_clear_h <= 3 ? "#22c55e" : kpis.all_clear_h <= 12 ? "#eab308" : "#ef4444" }}>
            {kpis.all_clear_h.toFixed(1)}<span className="text-[14px] text-muted"> h</span>
          </span>
          {base && <span className="num text-[11px] text-muted">{t(lang, "sim_baseline")} {base.all_clear_h.toFixed(1)} h</span>}
        </div>
      )}
    </div>
  );
}

function BeforeAfter({ base, now, lang, pending }: { base?: SimKpis; now?: SimKpis; lang: Lang; pending: boolean }) {
  const items: { key: TKey; k: keyof SimKpis; fmt: (v: number) => string }[] = [
    { key: "sim_zones_flooded", k: "zones_flooded", fmt: (v) => fmtInt(v, lang) },
    { key: "sim_zones_red", k: "zones_red", fmt: (v) => fmtInt(v, lang) },
    { key: "sim_all_clear_short", k: "all_clear_h", fmt: (v) => `${v.toFixed(1)} h` },
    { key: "sim_flooded_h", k: "total_flooded_h", fmt: (v) => `${v.toFixed(1)} h` },
    { key: "sim_roads", k: "roads_closed_km", fmt: (v) => `${v.toFixed(0)} km` },
    { key: "sim_population", k: "population_affected", fmt: (v) => fmtCompact(v, lang) },
    { key: "sim_damage", k: "damage_qar", fmt: (v) => `${(v / 1e6).toFixed(2)}M` },
  ];
  return (
    <div className="glass grid grid-cols-7 divide-x divide-line/70 rtl:divide-x-reverse">
      {items.map((it) => {
        const b = base?.[it.k];
        const n = now?.[it.k];
        const delta = b != null && n != null ? n - b : 0;
        const better = delta < 0;
        const worse = delta > 0;
        return (
          <div key={it.key} className="px-3.5 py-2.5">
            <div className="label truncate">{t(lang, it.key)}</div>
            <div className="mt-1 flex items-baseline gap-2" dir="ltr">
              <span className="num text-[11.5px] text-muted">{b != null ? it.fmt(b) : "—"}</span>
              <span className="text-muted">→</span>
              <span className={clsx("display num text-[22px] transition-colors", pending && "opacity-60", better ? "text-green" : worse ? "text-orange" : "text-fg")}>{n != null ? it.fmt(n) : "—"}</span>
            </div>
            <div className="mt-0.5 h-3 text-[10px] font-bold">
              {delta !== 0 && b != null && (
                <span className={better ? "text-green" : "text-orange"} dir="ltr">{delta > 0 ? "+" : "−"}{it.fmt(Math.abs(delta))}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Outcomes({ zones, names, lang }: { zones: SimZone[]; names: Record<string, string>; lang: Lang }) {
  return (
    <div className="glass shrink-0 px-3 py-2.5">
      <div className="mb-2 flex items-center gap-3">
        <span className="panel-title">{t(lang, "sim_outcomes")}</span>
        <span className="accent-line" />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {zones.map((z) => {
          const color = riskColor(z.peak_risk);
          return (
            <div key={z.zone_id} className="glass-inset w-[152px] shrink-0 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="display num text-[20px]" style={{ color, textShadow: `0 0 14px ${color}66` }}>{Math.round(z.peak_risk)}</span>
                <div className="min-w-0">
                  <div className="truncate text-[11.5px] font-bold text-fg">{names[z.zone_id] ?? z.zone_id}</div>
                  <div className="text-[9.5px] font-extrabold uppercase tracking-wider" style={{ color }}>{bandLabel(lang, z.peak_band)}</div>
                </div>
              </div>
              <div className="num mt-1.5 grid grid-cols-2 gap-x-2 text-[10px] text-muted" dir="ltr">
                <span>{t(lang, "sim_depth")} <b className="text-fg-2">{z.peak_depth_cm.toFixed(0)} cm</b></span>
                <span>{t(lang, "sim_flooded_h")} <b className="text-fg-2">{z.flooded_h.toFixed(1)} h</b></span>
                <span>{t(lang, "sim_ttd")} <b className={z.time_to_drain_h > 0 ? "text-orange" : "text-fg-2"}>{z.time_to_drain_h.toFixed(1)} h</b></span>
                <span>{t(lang, "sim_pumps")} <b className="text-accent">{z.pumps}</b></span>
              </div>
            </div>
          );
        })}
        {zones.length === 0 && [0, 1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="shimmer h-[68px] w-[152px] shrink-0 rounded-xl" />)}
      </div>
    </div>
  );
}
