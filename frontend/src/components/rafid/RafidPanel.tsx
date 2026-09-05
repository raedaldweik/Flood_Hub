"use client";

import { useState } from "react";
import clsx from "clsx";
import { Bot, ChevronLeft, ChevronRight, Info, SendHorizontal } from "lucide-react";
import { useAgentStatus } from "@/hooks/useData";
import { t } from "@/lib/i18n";
import { useUi } from "@/lib/store";

interface Msg {
  role: "user" | "rafid" | "system";
  text: string;
}

/**
 * The agent dock (present on every tab). Phase 1 ships the shell with an honest offline state;
 * Phase 3 wires ADK + Gemini streaming, tool-call traces and citation chips into this same panel.
 */
export function RafidPanel() {
  const lang = useUi((s) => s.lang);
  const open = useUi((s) => s.rafidOpen);
  const setOpen = useUi((s) => s.setRafidOpen);
  const { data: status } = useAgentStatus();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const online = status?.online ?? false;

  const send = (text: string) => {
    if (!text.trim()) return;
    setMsgs((m) => [...m, { role: "user", text }, { role: "rafid", text: t(lang, "rafid_offline_reply") }]);
    setDraft("");
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex h-full w-11 shrink-0 flex-col items-center gap-3 border-s border-line bg-bg-2/80 py-3 text-fg-2 hover:text-fg"
        aria-label="Open Rafid"
      >
        <Bot size={18} className="text-accent" />
        <span className="[writing-mode:vertical-rl] text-[11px] tracking-wider">{t(lang, "rafid_title")}</span>
        <span className="dot mt-auto bg-muted" />
        <ChevronLeft size={14} className="rtl:rotate-180" />
      </button>
    );
  }

  const prompts = ["rafid_p1", "rafid_p2", "rafid_p3", "rafid_p4"] as const;

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col border-s border-line bg-bg-2/80 backdrop-blur">
      <header className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 text-accent ring-1 ring-accent/30">
          <Bot size={17} />
        </span>
        <div className="leading-tight">
          <div className="flex items-center gap-1.5 text-[14px] font-semibold">
            {t(lang, "rafid_title")} <span className="text-[12px] font-normal text-fg-2">{lang === "ar" ? "Rafid" : "رافد"}</span>
            <span className="group relative">
              <Info size={12} className="text-muted" />
              <span className="pointer-events-none absolute start-0 top-5 z-20 hidden w-60 rounded-lg border border-line bg-panel-solid p-2.5 text-[11px] leading-snug text-fg-2 shadow-xl group-hover:block">
                {t(lang, "rafid_about")}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted">
            <span className={clsx("dot", online ? "bg-green dot-pulse" : "bg-muted")} />
            {online ? t(lang, "rafid_online") : t(lang, "rafid_offline")}
            {online && status?.model && <span className="font-mono text-[10px] opacity-70">· {status.model}</span>}
          </div>
        </div>
        <button onClick={() => setOpen(false)} className="ms-auto rounded-md p-1.5 text-fg-2 hover:bg-white/[0.06] hover:text-fg" aria-label="Collapse">
          <ChevronRight size={15} className="rtl:rotate-180" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <p className="text-[12.5px] leading-relaxed text-fg-2">{t(lang, "rafid_intro")}</p>
        <div>
          <div className="label mb-2">{t(lang, "rafid_try")}</div>
          <div className="flex flex-wrap gap-1.5">
            {prompts.map((k) => (
              <button key={k} onClick={() => send(t(lang, k))} className="rounded-full border border-line px-2.5 py-1 text-[11.5px] text-fg-2 transition hover:border-accent/50 hover:text-fg">
                {t(lang, k)}
              </button>
            ))}
          </div>
        </div>
        {msgs.map((m, i) => (
          <div key={i} className={clsx("fade-in max-w-[92%] rounded-xl px-3 py-2 text-[12.5px] leading-relaxed", m.role === "user" ? "ms-auto bg-accent/15 text-fg ring-1 ring-accent/25" : "bg-white/[0.05] text-fg-2 ring-1 ring-line")}>
            {m.text}
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        className="flex items-center gap-2 border-t border-line p-3"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t(lang, "rafid_placeholder")}
          className="min-w-0 flex-1 rounded-lg border border-line bg-white/[0.04] px-3 py-2 text-[12.5px] text-fg placeholder:text-muted focus:border-accent/50 focus:outline-none"
        />
        <button type="submit" className="grid h-9 w-9 place-items-center rounded-lg bg-white/[0.06] text-fg-2 ring-1 ring-line hover:text-fg" aria-label={t(lang, "rafid_send")}>
          <SendHorizontal size={15} className="rtl:rotate-180" />
        </button>
      </form>
    </aside>
  );
}
