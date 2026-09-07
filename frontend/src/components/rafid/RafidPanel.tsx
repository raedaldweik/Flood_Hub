"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useSWRConfig } from "swr";
import { BookOpen, Bot, ChevronLeft, ChevronRight, Database, Gauge, Info, MessageSquareText, Route, SendHorizontal, Waves, Wrench } from "lucide-react";
import { useAgentStatus, useZones } from "@/hooks/useData";
import { approvePlan, endpoints, streamChat, type AdvisoryDraft, type Citation, type DispatchPlan } from "@/lib/api";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { useUi } from "@/lib/store";
import { PlanCard } from "./PlanCard";

interface TraceLine {
  name: string;
  args?: Record<string, unknown>;
  summary?: string;
}

interface Msg {
  role: "user" | "rafid";
  text: string;
  trace: TraceLine[];
  citations: Citation[];
  plan?: DispatchPlan;
  draft?: AdvisoryDraft;
  error?: string;
  streaming?: boolean;
}

const CAPS: { icon: typeof Bot; key: TKey; tag: TKey }[] = [
  { icon: Database, key: "cap_db", tag: "cap_db_tag" },
  { icon: Waves, key: "cap_flood", tag: "cap_flood_tag" },
  { icon: Gauge, key: "cap_score", tag: "cap_score_tag" },
  { icon: BookOpen, key: "cap_rag", tag: "cap_rag_tag" },
  { icon: Route, key: "cap_plan", tag: "cap_plan_tag" },
  { icon: MessageSquareText, key: "cap_draft", tag: "cap_draft_tag" },
];

const PROMPTS: { key: TKey; tag: TKey }[] = [
  { key: "rafid_p1", tag: "rafid_tag_ask" },
  { key: "rafid_p2", tag: "rafid_tag_sop" },
  { key: "rafid_p3", tag: "rafid_tag_score" },
  { key: "rafid_p4", tag: "rafid_tag_draft" },
];

/** Where a tool lives, for the visible trace ("Rafid used: flood-mcp → …"). */
function toolSource(name: string, db: "toolbox" | "local"): string {
  if (name.startsWith("flood_")) return "flood-mcp";
  if (["score_zone"].includes(name)) return "model";
  if (name === "search_protocols") return "RAG";
  if (name === "propose_dispatch_plan") return "planner";
  if (name === "draft_advisory") return "draft";
  return db === "toolbox" ? "MCP Toolbox" : "db";
}

function fmtArgs(args?: Record<string, unknown>): string {
  if (!args) return "";
  const parts = Object.entries(args)
    .filter(([, v]) => v !== "" && v !== null && v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  const s = parts.join(", ");
  return s.length > 90 ? s.slice(0, 87) + "…" : s;
}

function sessionId(): string {
  try {
    const key = "sadd_rafid_session";
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(key, id);
    return id;
  } catch {
    return "session-" + Math.random().toString(16).slice(2, 10);
  }
}

/**
 * The agent dock (present on every tab): streams ADK + Gemini replies with a visible tool-call
 * trace, citation chips, DRAFT advisories and dispatch-plan cards that need an operator's APPROVE.
 */
export function RafidPanel() {
  const lang = useUi((s) => s.lang);
  const tick = useUi((s) => s.tick);
  const mode = useUi((s) => s.mode);
  const open = useUi((s) => s.rafidOpen);
  const setOpen = useUi((s) => s.setRafidOpen);
  const { data: status } = useAgentStatus();
  const { data: zones } = useZones();
  const ask = useUi((s) => s.rafidAsk);
  const { mutate } = useSWRConfig();
  const zoneNames = Object.fromEntries((zones?.features ?? []).map((z) => [z.properties.id, lang === "ar" ? z.properties.name_ar : z.properties.name_en]));
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const online = status?.online ?? false;
  const db = status?.tools?.db ?? "local";

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  const patchLast = (fn: (m: Msg) => Msg) =>
    setMsgs((all) => {
      const last = all[all.length - 1];
      if (!last || last.role !== "rafid") return all;
      return [...all.slice(0, -1), fn(last)];
    });

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setDraft("");
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", text: message, trace: [], citations: [] }, { role: "rafid", text: "", trace: [], citations: [], streaming: true }]);
    try {
      for await (const ev of streamChat({ message, session_id: sessionId(), lang, tick, mode })) {
        if (ev.type === "text") patchLast((m) => ({ ...m, text: m.text + ev.delta }));
        else if (ev.type === "tool_call") patchLast((m) => ({ ...m, trace: [...m.trace, { name: ev.name, args: ev.args }] }));
        else if (ev.type === "tool_result")
          patchLast((m) => {
            const i = m.trace.map((x) => x.name).lastIndexOf(ev.name);
            const trace = [...m.trace];
            if (i >= 0) trace[i] = { ...trace[i]!, summary: ev.summary };
            else trace.push({ name: ev.name, summary: ev.summary });
            return { ...m, trace };
          });
        else if (ev.type === "citations") patchLast((m) => ({ ...m, citations: dedupe([...m.citations, ...ev.items]) }));
        else if (ev.type === "plan") patchLast((m) => ({ ...m, plan: ev.plan }));
        else if (ev.type === "draft") patchLast((m) => ({ ...m, draft: ev.draft }));
        else if (ev.type === "error") patchLast((m) => ({ ...m, error: ev.message }));
      }
    } catch (err) {
      patchLast((m) => ({ ...m, error: err instanceof Error ? err.message : String(err) }));
    } finally {
      patchLast((m) => ({ ...m, streaming: false }));
      setBusy(false);
    }
  };

  // Another tab asked Rafid something on the operator's behalf (Simulation Lab, Executive View).
  const lastAsk = useRef(0);
  useEffect(() => {
    if (ask.n && ask.n !== lastAsk.current) {
      lastAsk.current = ask.n;
      void send(ask.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask.n]);

  const approve = async (plan: DispatchPlan) => {
    setMsgs((all) => all.map((m) => (m.plan?.plan_id === plan.plan_id ? { ...m, plan: { ...m.plan, status: "proposed", result: undefined, approving: true } as DispatchPlan & { approving?: boolean } } : m)));
    try {
      const res = await approvePlan(plan.plan_id);
      setMsgs((all) => all.map((m) => (m.plan?.plan_id === plan.plan_id ? { ...m, plan: { ...m.plan, status: "approved", result: res.result } } : m)));
      void mutate(endpoints.assets);
      void mutate(endpoints.decisions);
    } catch (err) {
      setMsgs((all) => all.map((m) => (m.plan?.plan_id === plan.plan_id ? { ...m, plan: { ...m.plan, status: "rejected" }, error: err instanceof Error ? err.message : String(err) } : m)));
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="glass flex h-full w-12 shrink-0 flex-col items-center gap-3 py-3 text-fg-2 hover:text-fg" aria-label="Open Rafid">
        <span className="avatar-ring grid h-8 w-8 place-items-center text-[#06121a]"><Bot size={16} /></span>
        <span className="[writing-mode:vertical-rl] text-[11px] font-bold tracking-[0.2em]">{t(lang, "rafid_title").toUpperCase()}</span>
        <span className={clsx("dot mt-auto", online ? "bg-green dot-pulse" : "bg-muted")} />
        <ChevronLeft size={14} className="rtl:rotate-180" />
      </button>
    );
  }

  return (
    <aside className="glass flex h-full w-[352px] shrink-0 flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="avatar-ring grid h-10 w-10 place-items-center text-[#06121a]"><Bot size={20} /></span>
        <div className="min-w-0 leading-tight">
          <div className="flex items-center gap-1.5 text-[15px] font-extrabold">
            {t(lang, "rafid_title")} <span className="text-[13px] font-medium text-fg-2">{lang === "ar" ? "Rafid" : "رافد"}</span>
            <span className="group relative">
              <Info size={12} className="text-muted" />
              <span className="pointer-events-none absolute start-0 top-5 z-20 hidden w-60 rounded-lg border border-line bg-panel-solid p-2.5 text-[11px] leading-snug text-fg-2 shadow-xl group-hover:block">
                {t(lang, "rafid_about")}
              </span>
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 whitespace-nowrap text-[10.5px] font-semibold text-muted">
            <span className={clsx("dot", online ? "bg-green dot-pulse" : "bg-muted")} />
            {online ? t(lang, "rafid_online") : t(lang, "rafid_offline")}
            {online && status?.model && <span className="font-mono text-[10px] opacity-70">· {status.model}</span>}
            {online && status?.tools && <span className="font-mono text-[10px] opacity-70">· {status.tools.db === "toolbox" ? "MCP Toolbox" : "local db"} · {status.tools.rag}</span>}
          </div>
        </div>
        <button onClick={() => setOpen(false)} className="btn-ghost ms-auto px-2" aria-label="Collapse">
          <ChevronRight size={14} className="rtl:rotate-180" />
        </button>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {msgs.length === 0 && (
          <>
            <p className="text-[12.5px] leading-relaxed text-fg-2">{t(lang, "rafid_intro")}</p>
            <div>
              <div className="mb-2 flex items-center gap-3">
                <span className="panel-title">{t(lang, "rafid_caps_title")}</span>
                <span className="accent-line" />
              </div>
              <ul className="space-y-1.5">
                {CAPS.map((c) => (
                  <li key={c.key} className="glass-inset flex items-center gap-2.5 px-2.5 py-2">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent/12 text-accent ring-1 ring-accent/25"><c.icon size={13} /></span>
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-fg-2">{t(lang, c.key)}</span>
                    <span className="trace-step-tool">{t(lang, c.tag)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        <div>
          <div className="label mb-2">{t(lang, "rafid_try")}</div>
          <div className="flex flex-wrap gap-1.5">
            {PROMPTS.map((p) => (
              <button key={p.key} onClick={() => send(t(lang, p.key))} disabled={busy} className="chip disabled:opacity-50">
                <span className="chip-tag">{t(lang, p.tag)}</span>
                {t(lang, p.key)}
              </button>
            ))}
          </div>
        </div>

        {msgs.map((m, i) => (
          <div key={i} className={clsx("animate-fade-up flex gap-2.5", m.role === "user" && "flex-row-reverse")}>
            {m.role === "user" ? (
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/12 text-[10px] font-extrabold text-accent ring-1 ring-accent/30">{t(lang, "you")}</div>
            ) : (
              <div className="avatar-ring grid h-8 w-8 shrink-0 place-items-center text-[#06121a]"><Bot size={15} /></div>
            )}
            <div className={clsx("min-w-0 max-w-[85%] space-y-2", m.role === "user" && "max-w-[78%]")}>
              {m.trace.length > 0 && (
                <div className="trace-panel">
                  {m.trace.map((tr, k) => (
                    <div key={k} className="trace-step">
                      <Wrench size={11} className="mt-0.5 shrink-0 text-accent" />
                      <div className="min-w-0 flex-1 text-[11px] leading-snug text-fg-2">
                        <span className="font-semibold text-muted">{t(lang, "rafid_used")}:</span> <span className="trace-step-tool">{toolSource(tr.name, db)}</span> → <span className="font-mono text-[10.5px]">{tr.name.replace(/^flood_/, "")}({fmtArgs(tr.args)})</span>
                        {tr.summary && <span className="block text-[10.5px] text-muted">↳ {tr.summary}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {(m.text || m.role === "user") && (
                <div className={clsx("whitespace-pre-wrap px-3.5 py-2.5 text-[12.5px] leading-relaxed text-fg", m.role === "user" ? "msg-user-bubble" : "msg-bot-bubble")} dir="auto">
                  {m.text}
                  {m.streaming && <span className="ms-0.5 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-accent align-middle" />}
                </div>
              )}
              {m.role === "rafid" && m.streaming && !m.text && (
                <div className="msg-bot-bubble flex min-w-[120px] items-center gap-2 px-3.5 py-3">
                  <span className="text-[11px] font-semibold text-muted">{t(lang, "rafid_thinking")}</span>
                  <span className="flex items-center gap-1">
                    {[0, 1, 2].map((j) => (
                      <span key={j} className="h-1.5 w-1.5 rounded-full bg-accent" style={{ animation: `pop 1.4s ease-in-out infinite ${j * 0.15}s` }} />
                    ))}
                  </span>
                </div>
              )}
              {m.citations.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="label">{t(lang, "rafid_sources")}</span>
                  {m.citations.map((c) => (
                    <span key={`${c.doc_id}-${c.section_no}-${c.lang}`} className="chip cursor-default" title={`${c.doc_title} — §${c.section_no} ${c.section}`}>
                      <BookOpen size={11} className="text-accent" />
                      {c.doc_id} §{c.section_no}
                    </span>
                  ))}
                </div>
              )}
              {m.plan && <PlanCard plan={m.plan} lang={lang} names={zoneNames} onApprove={() => approve(m.plan!)} />}
              {m.draft && <DraftCard draft={m.draft} lang={lang} />}
              {m.error && <div className="rounded-lg bg-red/10 px-3 py-2 text-[11.5px] text-red ring-1 ring-red/30">{t(lang, "rafid_error")}: {m.error}</div>}
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
        className="border-t border-line p-3"
      >
        <div className="glass-inset flex items-center gap-2 p-1.5 ps-3.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={online ? t(lang, "rafid_placeholder") : t(lang, "rafid_placeholder_offline")}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[12.5px] text-fg placeholder:text-muted focus:outline-none"
            dir="auto"
          />
          <button type="submit" disabled={busy} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#06121a] transition hover:brightness-110 disabled:opacity-50" style={{ background: "var(--cyan-grad)" }} aria-label={t(lang, "rafid_send")}>
            <SendHorizontal size={14} className="rtl:rotate-180" />
          </button>
        </div>
        <div className="mt-2 text-center text-[10px] font-semibold tracking-wide text-muted/80">{t(lang, "rafid_footer")}</div>
      </form>
    </aside>
  );
}

function dedupe(items: Citation[]): Citation[] {
  const seen = new Set<string>();
  return items.filter((c) => {
    const k = `${c.doc_id}|${c.section_no}|${c.lang}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function DraftCard({ draft, lang }: { draft: AdvisoryDraft; lang: Lang }) {
  return (
    <div className="glass-inset overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <MessageSquareText size={13} className="text-orange" />
        <span className="text-[11.5px] font-extrabold text-orange">{t(lang, "rafid_draft")}</span>
        <span className="ms-auto font-mono text-[10px] text-muted">{draft.template}</span>
      </div>
      <div className="space-y-2 px-3 py-2 text-[11.5px] leading-relaxed">
        <p dir="ltr" className="text-fg"><span className="chip-tag me-1">EN · {draft.chars_en}</span>{draft.sms_en}</p>
        <p dir="rtl" className="text-fg"><span className="chip-tag me-1">AR · {draft.chars_ar}</span>{draft.sms_ar}</p>
        <p className="text-[10.5px] text-muted">{draft.note}</p>
      </div>
    </div>
  );
}
