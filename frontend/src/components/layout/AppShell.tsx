"use client";

import { useMeta } from "@/hooks/useData";
import { Header } from "./Header";
import { Bokeh } from "./Bokeh";
import { RafidPanel } from "@/components/rafid/RafidPanel";
import { t } from "@/lib/i18n";
import { useUi } from "@/lib/store";

/** Atmospheric shell: header + page + omnipresent Rafid dock. Every tab renders inside this. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: meta } = useMeta();
  const lang = useUi((s) => s.lang);
  return (
    <div className="app-shell text-fg">
      <Bokeh />
      <Header meta={meta} />
      <div className="relative z-[1] flex min-h-0 flex-1 gap-3 px-3 pb-2">
        <main className="relative min-w-0 flex-1">{children}</main>
        <RafidPanel />
      </div>
      <footer className="relative z-[1] flex h-6 shrink-0 items-center justify-center text-[10.5px] tracking-wide text-muted/80">
        {t(lang, "disclaimer")}
      </footer>
    </div>
  );
}
