import { AppShell } from "@/components/layout/AppShell";
import { PhasePlaceholder } from "@/components/layout/PhasePlaceholder";

export default function Page() {
  return (
    <AppShell>
      <PhasePlaceholder titleKey="tab_simulation" bodyKey="coming_sim" phase={4} />
    </AppShell>
  );
}
