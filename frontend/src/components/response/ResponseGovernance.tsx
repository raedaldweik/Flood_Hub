"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { useSWRConfig } from "swr";
import { Check, ChevronDown, ChevronRight, Droplets, FlaskConical, Radio, ScrollText, ShieldCheck, Truck, Undo2, Users } from "lucide-react";
import { useAssets, useDecisions, useDepots, useMeta, useRules, useTimeline, useZones } from "@/hooks/useData";
import { useZoneNow } from "@/hooks/useZoneNow";
import { endpoints, standDown, type Asset, type Decision, type Depot, type Rule, type ZoneFeature } from "@/lib/api";
import { fmtInt, fmtTime } from "@/lib/format";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { BAND_COLORS } from "@/lib/risk";
import { useUi } from "@/lib/store";
import { CityMap } from "@/components/map/CityMap";
import { FLEET_COLORS } from "@/components/map/fleetPins";

const STATUSES: Asset["status"][] = ["staged", "enroute", "pumping", "idle"];
const DECISION_TYPES = ["alert", "action_item", "recommendation", "clear", "dispatch", "dispatch_rejected", "stand_down"] as const;
const DECISION_COLORS: Record<string, string> = {
  alert: "#ef4444",
  action_item: "#f97316",
  recommendation: "#22d3ee",
  clear: "#22c55e",
  dispatch: "#22d3ee",
  dispatch_rejected: "#ef4444",
  stand_down: "#8d98ad",
};
const ROSTER: TKey[] = ["resp_roster_1", "resp_roster_2", "resp_roster_3", "resp_roster_4"];

/** Tab 3 — the thesis made visible: dispatch board, the decision ledger, the versioned rule catalog. */
export function ResponseGovernance() {
  const lang = useUi((s) => s.lang);
  const { data: meta } = useMeta();
  const ready = meta?.startup?.phase === "ready";
  const { data: zones } = useZones(ready);
  const { data: assets } = useAssets(ready);
  const { data: depots } = useDepots(ready);
  const { data: rules } = useRules(ready);
  const { data: decisions } = useDecisions(ready);
  const { data: timeline } = useTimeline(ready);
  const zoneNow = useZoneNow(timeline, undefined);

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,11fr)_minmax(0,13fr)] gap-3">
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_400px_372px] gap-3">
        <DispatchBoard assets={assets ?? []} depots={depots ?? []} zones={zones?.features ?? []} lang={lang} />
        <section className="glass-hero relative min-h-0 overflow-hidden rounded-[18px] ring-1 ring-line">
          {zones ? <CityMap zones={zones.features} states={zoneNow} assets={assets ?? []} chromeBottom={12} /> : <div className="backdrop absolute inset-0" />}
          <div className="pointer-events-none absolute start-3 top-3 z-10">
            <span className="status-pill text-fg-2"><Radio size={12} className="text-green" /> {t(lang, "resp_positions")}</span>
          </div>
        </section>
        <RuleCatalog rules={rules ?? []} lang={lang} />
      </div>
      <DecisionLog decisions={decisions ?? []} zones={zones?.features ?? []} rules={rules ?? []} lang={lang} />
    </div>
  );
}

/* ── Dispatch board ─────────────────────────────────────────────────────── */

function DispatchBoard({ assets, depots, zones, lang }: { assets: Asset[]; depots: Depot[]; zones: ZoneFeature[]; lang: Lang }) {
  const tick = useUi((s) => s.tick);
  const { mutate } = useSWRConfig();
  const [filter, setFilter] = useState<"all" | Asset["status"]>("all");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const zoneName = Object.fromEntries(zones.map((z) => [z.properties.id, lang === "ar" ? z.properties.name_ar : z.properties.name_en]));
  const depotName = Object.fromEntries(depots.map((d) => [d.id, lang === "ar" ? d.name_ar : d.name_en]));
  const counts = STATUSES.map((s) => [s, assets.filter((a) => a.status === s).length] as const);
  const rows = useMemo(
    () => [...assets].filter((a) => filter === "all" || a.status === filter).sort((a, b) => (a.type === b.type ? a.id.localeCompare(b.id) : a.type === "pump_truck" ? -1 : 1)),
    [assets, filter],
  );
  const deployed = assets.filter((a) => a.type === "pump_truck" && a.status !== "idle").length;

  const doStandDown = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await standDown("operator-01", tick);
      setNote(`${r.rule} · #${r.decision_id} · ${fmtInt(r.units_returned, lang)} ${t(lang, "resp_units_returned")}`);
      void mutate(endpoints.assets);
      void mutate(endpoints.decisions);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="glass flex min-h-0 flex-col overflow-hidden">
      <header className="flex items-center gap-3 px-4 pb-2 pt-3.5">
        <span className="panel-title">{t(lang, "resp_board")}</span>
        <span className="accent-line" />
        <span className="num status-pill py-1 text-[11px]"><Truck size={12} className="text-accent" /> {fmtInt(deployed, lang)} {t(lang, "kpi_of")} {fmtInt(assets.filter((a) => a.type === "pump_truck").length, lang)}</span>
        <button onClick={doStandDown} disabled={busy || deployed === 0} className="btn-ghost text-orange disabled:opacity-40" title={t(lang, "resp_stand_down_hint")}>
          <Undo2 size={13} /> {busy ? t(lang, "resp_stand_down_busy") : t(lang, "resp_stand_down")}
        </button>
      </header>
      <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2">
        <button onClick={() => setFilter("all")} className={clsx("chip !py-1 text-[11px]", filter === "all" && "!bg-accent !text-[#06121a]")}>{t(lang, "resp_filter_all")} <span className="num opacity-70">{assets.length}</span></button>
        {counts.map(([s, n]) => (
          <button key={s} onClick={() => setFilter(s)} className={clsx("chip !py-1 text-[11px]", filter === s && "!bg-accent !text-[#06121a]")}>
            <span className="dot" style={{ background: FLEET_COLORS[s], width: 7, height: 7 }} /> {t(lang, `status_${s}` as TKey)} <span className="num opacity-70">{n}</span>
          </button>
        ))}
        {note && <span className="ms-auto max-w-[46%] truncate text-[10.5px] font-semibold text-green" title={note}>{note}</span>}
      </div>
      <div className="flex items-center gap-1.5 overflow-x-auto px-4 pb-2">
        <span className="label me-1 whitespace-nowrap"><Users size={11} className="mb-0.5 inline" /> {t(lang, "resp_roster")}</span>
        {ROSTER.map((k) => <span key={k} className="chip cursor-default !py-1 text-[10.5px] whitespace-nowrap">{t(lang, k)}</span>)}
        <span className="tag" style={{ ["--tag" as string]: "#eab308" }}><FlaskConical size={9} /> {t(lang, "resp_fictional")}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="ledger w-full text-[12px]">
          <thead>
            <tr>
              <th>{t(lang, "resp_unit")}</th>
              <th>{t(lang, "resp_type")}</th>
              <th className="text-end">{t(lang, "resp_capacity")}</th>
              <th>{t(lang, "resp_zone")}</th>
              <th>{t(lang, "resp_depot")}</th>
              <th>{t(lang, "resp_status")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const c = FLEET_COLORS[a.status];
              return (
                <tr key={a.id} className="row">
                  <td className="font-bold text-fg"><span className="font-mono text-[10.5px] text-muted">{a.id}</span> <bdi>{lang === "ar" ? a.callsign_ar : a.callsign}</bdi></td>
                  <td className="text-fg-2">{a.type === "pump_truck" ? <Truck size={12} className="mb-0.5 inline text-accent" /> : <Droplets size={12} className="mb-0.5 inline text-accent-2" />} {t(lang, `type_${a.type}` as TKey)}</td>
                  <td className="num text-end text-fg-2" dir="ltr">{fmtInt(a.capacity_m3_h, lang)} m³/h</td>
                  <td className="text-fg-2">{a.zone_id ? zoneName[a.zone_id] ?? a.zone_id : "—"}</td>
                  <td className="truncate text-muted">{a.depot_id ? depotName[a.depot_id] ?? a.depot_id : "—"}</td>
                  <td><span className="tag" style={{ ["--tag" as string]: c }}><span className="dot" style={{ background: c, width: 6, height: 6 }} /> {t(lang, `status_${a.status}` as TKey)}</span></td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted">—</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ── Rule catalog ───────────────────────────────────────────────────────── */

function RuleCatalog({ rules, lang }: { rules: Rule[]; lang: Lang }) {
  const tests = rules.reduce((s, r) => s + r.test_count, 0);
  return (
    <section className="glass flex min-h-0 flex-col overflow-hidden">
      <header className="flex items-center gap-3 px-4 pb-2 pt-3.5">
        <span className="panel-title">{t(lang, "resp_rules")}</span>
        <span className="accent-line" />
        <span className="num status-pill py-1 text-[11px]"><ShieldCheck size={12} className="text-green" /> {fmtInt(rules.length, lang)} · {fmtInt(tests, lang)} {t(lang, "resp_tests")}</span>
      </header>
      <div className="px-4 pb-2 text-[10.5px] text-muted">{t(lang, "resp_rules_sub")}</div>
      <ol className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
        {rules.map((r) => (
          <li key={r.id} className="glass-inset px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="trace-step-tool">{r.id}</span>
              <span className="font-mono text-[10px] text-muted">v{r.version}</span>
              <span className="tag" style={{ ["--tag" as string]: r.kind === "gate" ? "#22d3ee" : "#8d98ad" }}>{t(lang, r.kind === "gate" ? "resp_kind_gate" : "resp_kind_timeline")}</span>
              <span className="num ms-auto text-[10.5px] font-bold text-green"><Check size={11} className="mb-0.5 inline" /> {fmtInt(r.test_count, lang)} {t(lang, "resp_tests")}</span>
            </div>
            <div className="mt-1 text-[12px] font-bold text-fg">{lang === "ar" ? r.name_ar : r.name_en}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-fg-2">{lang === "ar" ? r.description_ar : r.description_en}</div>
          </li>
        ))}
        {rules.length === 0 && [0, 1, 2, 3].map((i) => <li key={i} className="shimmer h-16 rounded-xl" />)}
      </ol>
      <div className="border-t border-line px-4 py-2 text-[10.5px] leading-snug text-muted">{t(lang, "resp_rule_footer")}</div>
    </section>
  );
}

/* ── Decision log ───────────────────────────────────────────────────────── */

function summarise(d: Decision, lang: Lang): { text: string; inputs: string } {
  const o = d.output_json as Record<string, unknown>;
  const i = d.inputs_json as Record<string, unknown>;
  const msg = (lang === "ar" ? o.message_ar : o.message_en) as string | undefined;
  let text = msg ?? "";
  if (!text && d.decision_type === "dispatch") text = `${o.trucks_moved ?? 0} ${t(lang, "resp_trucks_moved")}`;
  if (!text && d.decision_type === "dispatch_rejected") text = `${t(lang, "resp_rejected")}: ${((o.rejected as string[]) ?? []).join("; ")}`;
  if (!text && d.decision_type === "stand_down") text = `${o.units_returned ?? 0} ${t(lang, "resp_units_returned")}`;
  let inputs = "";
  if (typeof i.rain_mm_h === "number") {
    inputs = `${t(lang, "zone_rain")} ${(i.rain_mm_h as number).toFixed(0)} mm/h · ${t(lang, "zone_risk")} ${(i.risk as number).toFixed(0)}`;
    if (typeof o.threshold === "number") inputs += ` · ${t(lang, "resp_threshold")} ${o.threshold}`;
    if (typeof o.forecast_risk_6h === "number") inputs += ` · 6h → ${(o.forecast_risk_6h as number).toFixed(0)}`;
  } else if (i.plan && typeof i.plan === "object") {
    const alloc = ((i.plan as Record<string, unknown>).allocations as Record<string, number>) ?? {};
    inputs = `${t(lang, "resp_fleet")} ${i.fleet_size ?? "?"} · ${t(lang, "resp_requested")} ${Object.values(alloc).reduce((s, n) => s + n, 0)}`;
  } else if (Array.isArray(i.fleet_before)) {
    inputs = `${t(lang, "resp_fleet")} ${(i.fleet_before as unknown[]).length}`;
  }
  return { text, inputs };
}

function DecisionLog({ decisions, zones, rules, lang }: { decisions: Decision[]; zones: ZoneFeature[]; rules: Rule[]; lang: Lang }) {
  const [type, setType] = useState<string>("all");
  const [rule, setRule] = useState<string>("all");
  const [zone, setZone] = useState<string>("all");
  const [proposer, setProposer] = useState<string>("all");
  const [open, setOpen] = useState<number | null>(null);
  const zoneName = Object.fromEntries(zones.map((z) => [z.properties.id, lang === "ar" ? z.properties.name_ar : z.properties.name_en]));

  const rows = useMemo(
    () =>
      decisions.filter(
        (d) =>
          (type === "all" || d.decision_type === type) &&
          (rule === "all" || d.rule_id === rule) &&
          (zone === "all" || d.zone_id === zone) &&
          (proposer === "all" || d.proposed_by === proposer),
      ),
    [decisions, type, rule, zone, proposer],
  );

  return (
    <section className="glass flex min-h-0 flex-col overflow-hidden">
      <header className="flex items-center gap-3 px-4 pb-2 pt-3.5">
        <span className="panel-title">{t(lang, "resp_log")}</span>
        <span className="accent-line" />
        <span className="text-[10.5px] text-muted">{t(lang, "resp_log_sub")}</span>
        <span className="num status-pill py-1 text-[11px]"><ScrollText size={12} className="text-accent" /> {fmtInt(rows.length, lang)} / {fmtInt(decisions.length, lang)}</span>
      </header>
      <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2">
        <button onClick={() => setType("all")} className={clsx("chip !py-1 text-[11px]", type === "all" && "!bg-accent !text-[#06121a]")}>{t(lang, "resp_filter_all")}</button>
        {DECISION_TYPES.map((k) => (
          <button key={k} onClick={() => setType(k)} className={clsx("chip !py-1 text-[11px]", type === k && "!bg-accent !text-[#06121a]")}>
            <span className="dot" style={{ background: DECISION_COLORS[k], width: 7, height: 7 }} /> {t(lang, `dec_${k}` as TKey)}
          </button>
        ))}
        <select value={rule} onChange={(e) => setRule(e.target.value)} className="select ms-2" aria-label={t(lang, "resp_col_rule")}>
          <option value="all">{t(lang, "resp_col_rule")}: {t(lang, "resp_filter_all")}</option>
          {rules.map((r) => <option key={r.id} value={r.id}>{r.id} v{r.version}</option>)}
        </select>
        <select value={zone} onChange={(e) => setZone(e.target.value)} className="select" aria-label={t(lang, "resp_zone")}>
          <option value="all">{t(lang, "resp_zone")}: {t(lang, "resp_filter_all")}</option>
          {zones.map((z) => <option key={z.properties.id} value={z.properties.id}>{zoneName[z.properties.id]}</option>)}
        </select>
        <select value={proposer} onChange={(e) => setProposer(e.target.value)} className="select" aria-label={t(lang, "resp_col_proposer")}>
          <option value="all">{t(lang, "resp_col_proposer")}: {t(lang, "resp_filter_all")}</option>
          {(["system", "agent", "operator"] as const).map((p) => <option key={p} value={p}>{t(lang, `prop_${p}` as TKey)}</option>)}
        </select>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="ledger w-full text-[12px]">
          <thead>
            <tr>
              <th className="w-[54px]">#</th>
              <th className="w-[150px]">{t(lang, "resp_col_time")}</th>
              <th>{t(lang, "resp_col_decision")}</th>
              <th className="w-[112px]">{t(lang, "resp_col_rule")}</th>
              <th className="w-[250px]">{t(lang, "resp_col_inputs")}</th>
              <th className="w-[90px]">{t(lang, "resp_col_proposer")}</th>
              <th className="w-[110px]">{t(lang, "resp_col_approver")}</th>
              <th className="w-[80px] text-center">{t(lang, "resp_col_notified")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const c = DECISION_COLORS[d.decision_type] ?? "#8d98ad";
              const sev = (d.output_json as Record<string, unknown>).severity as string | undefined;
              const chipColor = d.decision_type === "alert" && sev && sev in BAND_COLORS ? BAND_COLORS[sev as keyof typeof BAND_COLORS] : c;
              const { text, inputs } = summarise(d, lang);
              const isOpen = open === d.id;
              const live = d.source === "live";
              return [
                <tr key={d.id} className={clsx("row cursor-pointer", isOpen && "open")} onClick={() => setOpen(isOpen ? null : d.id)}>
                  <td className="font-mono text-[10.5px] text-muted">{isOpen ? <ChevronDown size={11} className="inline" /> : <ChevronRight size={11} className="inline rtl:rotate-180" />} {String(d.id).padStart(4, "0")}</td>
                  <td className="num whitespace-nowrap text-fg-2">
                    {fmtTime(d.ts, lang, true)}
                    <span className="tag ms-1.5" style={{ ["--tag" as string]: live ? "#22c55e" : "#eab308" }}>{t(lang, live ? "resp_live" : "resp_replay")}</span>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="tag" style={{ ["--tag" as string]: chipColor }}>{t(lang, `dec_${d.decision_type}` as TKey)}{sev ? ` · ${sev}` : ""}</span>
                      <span className="truncate font-bold text-fg">{d.zone_id ? zoneName[d.zone_id] ?? d.zone_id : ""}</span>
                    </div>
                    <div className="mt-0.5 line-clamp-1 text-[11px] text-fg-2" dir="auto">{text}</div>
                  </td>
                  <td><span className="trace-step-tool">{d.rule_id} v{d.rule_version}</span></td>
                  <td className="num text-[11px] text-fg-2" dir="ltr">{inputs}</td>
                  <td><span className="tag" style={{ ["--tag" as string]: d.proposed_by === "agent" ? "#22d3ee" : d.proposed_by === "operator" ? "#eab308" : "#8d98ad" }}>{t(lang, `prop_${d.proposed_by}` as TKey)}</span></td>
                  <td className="font-mono text-[11px] text-fg-2">{d.approved_by ?? "—"}</td>
                  <td className="text-center">{d.notified ? <Check size={13} className="inline text-green" /> : <span className="text-muted">—</span>}</td>
                </tr>,
                isOpen && (
                  <tr key={`${d.id}-x`} className="open">
                    <td colSpan={8} className="!py-3">
                      <div className="grid grid-cols-2 gap-3">
                        <Json title="inputs_json" value={d.inputs_json} />
                        <Json title="output_json" value={d.output_json} />
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
            {rows.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-muted">{t(lang, "resp_no_rows")}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Json({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="glass-inset overflow-hidden" dir="ltr">
      <div className="trace-header">{title}</div>
      <pre className="max-h-56 overflow-auto px-3 py-2 font-mono text-[10.5px] leading-snug text-fg-2">{JSON.stringify(value, null, 1)}</pre>
    </div>
  );
}
