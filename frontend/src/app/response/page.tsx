import { AppShell } from "@/components/layout/AppShell";
import { PhasePlaceholder } from "@/components/layout/PhasePlaceholder";

export default function Page() {
  return (
    <AppShell>
      <PhasePlaceholder titleKey="tab_response" bodyKey="coming_resp" phase={4} />
    </AppShell>
  );
}
