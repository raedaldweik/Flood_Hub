"use client";

import { useMemo } from "react";
import clsx from "clsx";
import { Banknote, Bot, Clock, Info, MessageSquareText, Timer, TrafficCone, Truck, Users } from "lucide-react";
import { Area, Bar, BarChart, Cell, ComposedChart, LabelList, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAgentStatus, useExecutive, useMeta } from "@/hooks/useData";
import type { ExecutiveReport } from "@/lib/api";
import { fmtCompact, fmtDayTime, fmtDuration, fmtInt, fmtTime } from "@/lib/format";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { useUi } from "@/lib/store";

/*
 * Tab 4 — minister persona. Draft 1 renders with recharts over /api/executive.
 * GCP version: Looker Studio embed over the same tables in BigQuery.
 */

const ACTUAL = "#f97316";
const SADD = "#22d3ee";

export function ExecutiveView() {
  const lang = useUi((s) => s.lang);
  const askRafid = useUi((s) => s.askRafid);
  const { data: meta } = useMeta();
  const ready = meta?.startup?.phase === "ready";
  const { data: r, error } = useExecutive(lang, ready);
  const { data: agent } = useAgentStatus();

  if (error) return <div className="grid h-full place-items-center text-[13px] text-red">{String(error)}</div>;
  if (!r) return <Skeleton />;

  const sc = r.scorecards;
  const planTrucks = Object.values(r.scenarios.allocations).reduce((s, n) => s + n, 0);
  const m = (n: number) => `${(n / 1e6).toFixed(2)}M`;
  const cards: { icon: typeof Clock; label: TKey; value: string; sub: string; tone: string }[] = [
    {
      icon: Clock, label: "exec_lead", value: fmtDuration(sc.alert_lead_time_min.sadd, lang), tone: SADD,
      sub: t(lang, "exec_lead_sub").replace("{h}", fmtDuration(sc.preposition_lead_time_min.sadd, lang)),
    },
    {
      icon: Timer, label: "exec_ttd", value: `${sc.time_to_drain_h.sadd.toFixed(1)} h`, tone: "#22c55e",
      sub: `${t(lang, "exec_actual_short")}: ${sc.time_to_drain_h.actual.toFixed(1)} h · ${t(lang, "exec_ttd_sub").replace("{h}", r.scenarios.no_pumps.all_clear_h.toFixed(1))}`,
    },
    {
      icon: Users, label: "exec_protected", value: fmtCompact(sc.population_protected.sadd, lang), tone: SADD,
      sub: t(lang, "exec_protected_sub").replace("{n}", fmtCompact(r.lead.population_flooded_zones, lang)),
    },
    {
      icon: TrafficCone, label: "exec_roads", value: `${sc.road_closure_h.sadd.toFixed(1)} h`, tone: "#22c55e",
      sub: t(lang, "exec_roads_sub").replace("{h}", sc.road_closure_h.actual.toFixed(1)).replace("{km}", sc.road_closure_h.km_affected.toFixed(0)),
    },
    {
      icon: Banknote, label: "exec_damage", value: `${m(sc.avoided_damage_qar.sadd)} QAR`, tone: "#22c55e",
      sub: `${m(r.scenarios.reactive.damage_qar)} → ${m(r.scenarios.prepared.damage_qar)} · ${t(lang, "exec_damage_sub")}`,
    },
    {
      icon: Truck, label: "exec_util", value: `${sc.asset_utilisation_pct.sadd.toFixed(0)}%`, tone: SADD,
      sub: t(lang, "exec_util_sub").replace("{n}", fmtInt(planTrucks, lang)).replace("{fleet}", fmtInt(r.scenarios.fleet_size, lang)).replace("{live}", sc.asset_utilisation_pct.live.toFixed(0)),
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto pe-0.5">
      <header className="flex items-center gap-3 px-1">
        <div>
          <h1 className="display text-[24px] text-fg">{t(lang, "exec_title")}</h1>
          <div className="mt-1 text-[11.5px] text-muted">
            {t(lang, "exec_sub")}
            {r.event.start_ts && r.event.end_ts && <span className="num"> · {fmtTime(r.event.start_ts, lang, true)} → {fmtTime(r.event.end_ts, lang, true)}</span>}
            <span className="num"> · {t(lang, "exec_rain_total")} {r.event.city_rain_total_mm.toFixed(0)} mm</span>
          </div>
        </div>
        <span className="accent-line" />
        <span className="status-pill text-yellow" style={{ borderColor: "rgba(234,179,8,0.35)" }}>{t(lang, "pill_simulated")} · {t(lang, "exec_modelled")}</span>
        <span className="status-pill text-fg-2">{t(lang, "exec_looker")}</span>
      </header>

      {/* Scorecards */}
      <div className="grid shrink-0 grid-cols-6 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="glass relative overflow-hidden px-4 pb-3 pt-3.5">
            <div className="pointer-events-none absolute -end-6 -top-8 h-28 w-28 rounded-full" style={{ background: `radial-gradient(circle, ${c.tone}2e 0%, transparent 65%)` }} />
            <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, ${c.tone}, ${c.tone}22)` }} />
            <div className="flex items-center gap-2">
              <span className="glass-inset grid h-6 w-6 place-items-center" style={{ color: c.tone }}><c.icon size={13} /></span>
              <span className="label truncate">{t(lang, c.label)}</span>
            </div>
            <div className="display num mt-2 text-[30px]" style={{ color: c.tone, textShadow: `0 0 22px ${c.tone}55` }} dir="ltr">{c.value}</div>
            <div className="mt-1.5 line-clamp-2 min-h-[30px] text-[10.5px] leading-snug text-muted">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid min-h-[300px] max-h-[460px] flex-1 grid-cols-[1.25fr_1fr_0.85fr] gap-3">
        <Comparison r={r} lang={lang} />
        <Trend r={r} lang={lang} />
        <Fleet r={r} lang={lang} />
      </div>

      {/* Rafid + method */}
      <div className="grid shrink-0 grid-cols-[1.4fr_1fr] gap-3">
        <section className="glass flex items-start gap-4 px-5 py-4">
          <span className="avatar-ring grid h-11 w-11 shrink-0 place-items-center text-[#06121a]"><Bot size={22} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-extrabold">{t(lang, "exec_summary")}</span>
              <span className={clsx("tag", r.summary.source === "gemini" ? "" : "")} style={{ ["--tag" as string]: r.summary.source === "gemini" ? "#22d3ee" : "#8d98ad" }}>
                {r.summary.source === "gemini" ? `${t(lang, "exec_summary_gemini")} · ${r.summary.model}` : t(lang, "exec_summary_template")}
              </span>
            </div>
            <p className="mt-2 text-[15px] font-semibold leading-relaxed text-fg" dir="auto">{r.summary.text}</p>
          </div>
          {agent?.online && (
            <button onClick={() => askRafid(t(lang, "exec_ask_prompt"))} className="btn-ghost shrink-0">
              <MessageSquareText size={13} /> {t(lang, "exec_ask")}
            </button>
          )}
        </section>
        <section className="glass px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="panel-title">{t(lang, "exec_method")}</span>
            <span className="accent-line" />
            <Info size={12} className="text-muted" />
          </div>
          <ul className="mt-2 space-y-1.5 text-[11px] leading-snug text-fg-2">
            <li><span className="font-bold" style={{ color: ACTUAL }}>{t(lang, "exec_actual")}:</span> {r.assumptions.actual}</li>
            <li><span className="font-bold" style={{ color: SADD }}>{t(lang, "exec_sadd")}:</span> {r.assumptions.sadd}</li>
            <li className="text-muted">{r.assumptions.damage} · {r.scenarios.sources.risk} · {r.scenarios.sources.time_to_drain}</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

function Comparison({ r, lang }: { r: ExecutiveReport; lang: Lang }) {
  const metrics = r.comparison.filter((c) => ["damage_qar", "road_closure_h", "alert_lead_time_h", "total_flooded_h"].includes(c.key));
  const fmt = (key: string, v: number) => (key === "damage_qar" ? `${(v / 1e6).toFixed(2)}M` : key.endsWith("_h") ? `${v.toFixed(1)} h` : fmtInt(v, lang));
  return (
    <section className="glass flex min-h-0 flex-col px-4 pb-3 pt-3.5">
      <div className="flex items-center gap-3">
        <span className="panel-title">{t(lang, "exec_compare")}</span>
        <span className="accent-line" />
        <span className="flex items-center gap-1.5 text-[10.5px] font-semibold text-muted"><span className="h-2 w-2 rounded-sm" style={{ background: ACTUAL }} /> {t(lang, "exec_actual")}</span>
        <span className="flex items-center gap-1.5 text-[10.5px] font-semibold text-muted"><span className="h-2 w-2 rounded-sm" style={{ background: SADD }} /> {t(lang, "exec_sadd")}</span>
      </div>
      <div className="mt-2 grid min-h-0 flex-1 grid-cols-4 gap-2">
        {metrics.map((c) => {
          const data = [
            { name: t(lang, "exec_actual_short"), v: c.key === "damage_qar" ? c.actual / 1e6 : c.actual },
            { name: t(lang, "exec_sadd"), v: c.key === "damage_qar" ? c.sadd / 1e6 : c.sadd },
          ];
          return (
            <div key={c.key} className="glass-inset flex min-h-0 flex-col px-2 pb-1 pt-2">
              <div className="label truncate text-center">{t(lang, `cmp_${c.key}` as TKey)}</div>
              <div className="min-h-0 flex-1" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data} margin={{ top: 18, right: 6, left: 6, bottom: 0 }} barCategoryGap="28%">
                    <XAxis dataKey="name" tick={{ fill: "#8d98ad", fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
                    <YAxis hide domain={[0, (max: number) => Math.max(max * 1.15, 0.1)]} />
                    <Bar dataKey="v" radius={[6, 6, 2, 2]} isAnimationActive>
                      <Cell fill={ACTUAL} />
                      <Cell fill={SADD} />
                      <LabelList dataKey="v" position="top" formatter={(v: unknown) => fmt(c.key, Number(v) * (c.key === "damage_qar" ? 1e6 : 1))} style={{ fill: "#eef2f8", fontSize: 11, fontWeight: 800 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Trend({ r, lang }: { r: ExecutiveReport; lang: Lang }) {
  const data = useMemo(() => r.trend.map((p) => ({ ...p, label: fmtDayTime(p.ts, lang) })), [r.trend, lang]);
  const peak = r.event.peak_ts ? fmtTime(r.event.peak_ts, lang, true) : "";
  return (
    <section className="glass flex min-h-0 flex-col px-4 pb-2 pt-3.5">
      <div className="flex items-center gap-3">
        <span className="panel-title">{t(lang, "exec_trend")}</span>
        <span className="accent-line" />
        <span className="num text-[10.5px] text-muted">{t(lang, "exec_peak")} {peak}</span>
      </div>
      <div className="mt-1 flex items-center gap-3 text-[10.5px] font-semibold text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-orange" /> {t(lang, "kpi_zones")}</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-red" /> {t(lang, "kpi_alerts")}</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-accent" /> {t(lang, "rain_title")}</span>
      </div>
      <div className="min-h-0 flex-1" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="exec-rain" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={SADD} stopOpacity={0.45} /><stop offset="100%" stopColor={SADD} stopOpacity={0} /></linearGradient>
              <linearGradient id="exec-risk" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={ACTUAL} stopOpacity={0.5} /><stop offset="100%" stopColor={ACTUAL} stopOpacity={0.05} /></linearGradient>
            </defs>
            <XAxis dataKey="label" tick={{ fill: "#8d98ad", fontSize: 10 }} axisLine={false} tickLine={false} interval={Math.max(1, Math.floor(data.length / 8))} />
            <YAxis yAxisId="n" tick={{ fill: "#8d98ad", fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis yAxisId="mm" orientation="right" hide />
            <Tooltip contentStyle={{ background: "#0f1729", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, fontSize: 11 }} labelStyle={{ color: "#c3ccdb" }} />
            <Area yAxisId="mm" type="monotone" dataKey="city_rain_mm_h" name="mm/h" stroke={SADD} strokeWidth={1} fill="url(#exec-rain)" isAnimationActive={false} />
            <Area yAxisId="n" type="stepAfter" dataKey="zones_at_risk" name={t(lang, "kpi_zones")} stroke={ACTUAL} strokeWidth={1.6} fill="url(#exec-risk)" isAnimationActive={false} />
            <Line yAxisId="n" type="stepAfter" dataKey="active_alerts" name={t(lang, "kpi_alerts")} stroke="#ef4444" strokeWidth={1.8} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function Fleet({ r, lang }: { r: ExecutiveReport; lang: Lang }) {
  const deployed = Object.values(r.scenarios.allocations).reduce((s, n) => s + n, 0);
  const idle = Math.max(0, r.scenarios.fleet_size - deployed);
  const pie = [
    { name: t(lang, "exec_deployed"), value: deployed, fill: SADD },
    { name: t(lang, "exec_idle"), value: idle, fill: "rgba(255,255,255,0.10)" },
  ];
  const rules = Object.entries(r.decisions.by_rule).sort(([a], [b]) => a.localeCompare(b)).map(([id, n]) => ({ id, n }));
  return (
    <section className="glass flex min-h-0 flex-col px-4 pb-3 pt-3.5">
      <div className="flex items-center gap-3">
        <span className="panel-title">{t(lang, "exec_util")}</span>
        <span className="accent-line" />
      </div>
      <div className="mt-2 grid min-h-0 flex-1 grid-cols-[124px_1fr] items-start gap-3">
        <div className="relative h-[124px] self-center" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pie} dataKey="value" innerRadius={40} outerRadius={56} startAngle={90} endAngle={-270} stroke="none" isAnimationActive>
                {pie.map((p) => <Cell key={p.name} fill={p.fill} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <div className="display num text-[22px] text-fg">{r.scorecards.asset_utilisation_pct.sadd.toFixed(0)}%</div>
              <div className="text-[9.5px] font-bold text-muted">{deployed}/{r.scenarios.fleet_size}</div>
            </div>
          </div>
        </div>
        <div className="min-h-0 self-stretch">
          <div className="label mb-1">{t(lang, "exec_decisions")} · {fmtInt(r.decisions.total, lang)}</div>
          <ul className="space-y-1">
            {rules.map((x) => (
              <li key={x.id} className="flex items-center gap-2 text-[11px]">
                <span className="trace-step-tool w-[42px] text-center">{x.id}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]"><span className="block h-full rounded-full" style={{ width: `${(x.n / Math.max(1, ...rules.map((y) => y.n))) * 100}%`, background: "var(--cyan-grad)" }} /></span>
                <span className="num w-5 text-end font-bold text-fg">{x.n}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 text-[10.5px] text-muted">{t(lang, "exec_approved")}: <b className="text-fg-2">{fmtInt(r.decisions.operator_approved, lang)}</b> · {t(lang, "prop_agent")}: <b className="text-fg-2">{fmtInt(r.decisions.by_proposer.agent ?? 0, lang)}</b></div>
        </div>
      </div>
    </section>
  );
}

function Skeleton() {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-6 gap-3">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="shimmer h-[104px] rounded-2xl" />)}</div>
      <div className="grid min-h-[300px] max-h-[460px] flex-1 grid-cols-[1.25fr_1fr_0.85fr] gap-3">{[0, 1, 2].map((i) => <div key={i} className="shimmer rounded-2xl" />)}</div>
      <div className="shimmer h-24 rounded-2xl" />
    </div>
  );
}
