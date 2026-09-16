"use client";

import { useRouter } from "next/navigation";
import { SettingsTabs } from "./settings-tabs";

export function Setup() {
  const router = useRouter();

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-12">
      <p className="eyebrow mb-4">V4 Company MS&amp;CO · Painel de Mídia</p>
      <SettingsTabs variant="setup" onSaved={() => router.refresh()} />
    </main>
  );
}
