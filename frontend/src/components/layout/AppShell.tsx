"use client";

import { useMeta } from "@/hooks/useData";
import { Header } from "./Header";
import { RafidPanel } from "@/components/rafid/RafidPanel";
import { t } from "@/lib/i18n";
import { useUi } from "@/lib/store";

/** Header + page + omnipresent Rafid dock. Every tab renders inside this shell. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: meta } = useMeta();
  const lang = useUi((s) => s.lang);
  return (
    <div className="flex h-screen flex-col bg-bg text-fg">
      <Header meta={meta} />
      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">{children}</main>
        <RafidPanel />
      </div>
      <footer className="flex h-6 shrink-0 items-center justify-center border-t border-line bg-bg-2/80 text-[10.5px] text-muted">
        {t(lang, "disclaimer")}
      </footer>
    </div>
  );
}
