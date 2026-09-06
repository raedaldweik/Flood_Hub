"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { BookOpen, Bot, ChevronLeft, ChevronRight, Database, Gauge, Info, MessageSquareText, Route, SendHorizontal, Waves } from "lucide-react";
import { useAgentStatus } from "@/hooks/useData";
import { t, type TKey } from "@/lib/i18n";
import { useUi } from "@/lib/store";

interface Msg {
  role: "user" | "rafid";
  text: string;
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

/**
 * The agent dock (present on every tab). Phase 1 ships the shell with an honest offline state;
 * Phase 3 streams ADK + Gemini replies, tool-call traces and citation chips into this same panel.
 */
export function RafidPanel() {
  const lang = useUi((s) => s.lang);
  const open = useUi((s) => s.rafidOpen);
  const setOpen = useUi((s) => s.setRafidOpen);
  const { data: status } = useAgentStatus();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const online = status?.online ?? false;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs, thinking]);

  const send = (text: string) => {
    if (!text.trim() || thinking) return;
    setMsgs((m) => [...m, { role: "user", text }]);
    setDraft("");
    setThinking(true);
    // Offline build: the reply is a static notice (CLAUDE.md §11). Phase 3 replaces this with SSE.
    setTimeout(() => {
      setMsgs((m) => [...m, { role: "rafid", text: t(lang, "rafid_offline_reply") }]);
      setThinking(false);
    }, 900);
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
          </div>
        </div>
        <button onClick={() => setOpen(false)} className="btn-ghost ms-auto px-2" aria-label="Collapse">
          <ChevronRight size={14} className="rtl:rotate-180" />
        </button>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
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

        <div>
          <div className="label mb-2">{t(lang, "rafid_try")}</div>
          <div className="flex flex-wrap gap-1.5">
            {PROMPTS.map((p) => (
              <button key={p.key} onClick={() => send(t(lang, p.key))} className="chip">
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
            <div className={clsx("max-w-[78%] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-fg", m.role === "user" ? "msg-user-bubble" : "msg-bot-bubble")}>{m.text}</div>
          </div>
        ))}
        {thinking && (
          <div className="animate-fade-up flex gap-2.5">
            <div className="avatar-ring grid h-8 w-8 shrink-0 place-items-center text-[#06121a]"><Bot size={15} /></div>
            <div className="msg-bot-bubble flex min-w-[120px] items-center gap-2 px-3.5 py-3">
              <span className="text-[11px] font-semibold text-muted">{t(lang, "rafid_thinking")}</span>
              <span className="flex items-center gap-1">
                {[0, 1, 2].map((j) => (
                  <span key={j} className="h-1.5 w-1.5 rounded-full bg-accent" style={{ animation: `pop 1.4s ease-in-out infinite ${j * 0.15}s` }} />
                ))}
              </span>
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        className="border-t border-line p-3"
      >
        <div className="glass-inset flex items-center gap-2 p-1.5 ps-3.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t(lang, "rafid_placeholder")}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[12.5px] text-fg placeholder:text-muted focus:outline-none"
          />
          <button type="submit" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#06121a] transition hover:brightness-110" style={{ background: "var(--cyan-grad)" }} aria-label={t(lang, "rafid_send")}>
            <SendHorizontal size={14} className="rtl:rotate-180" />
          </button>
        </div>
        <div className="mt-2 text-center text-[10px] font-semibold tracking-wide text-muted/80">{t(lang, "rafid_footer")}</div>
      </form>
    </aside>
  );
}
