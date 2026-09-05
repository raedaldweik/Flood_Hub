import { AppShell } from "@/components/layout/AppShell";
import { CommandCenter } from "@/components/command/CommandCenter";

export default function Page() {
  return (
    <AppShell>
      <CommandCenter />
    </AppShell>
  );
}
