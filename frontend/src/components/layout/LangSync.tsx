"use client";

import { useEffect } from "react";
import { useUi } from "@/lib/store";

/** Keeps <html lang dir> in step with the language toggle and restores the saved choice. */
export function LangSync() {
  const lang = useUi((s) => s.lang);
  const setLang = useUi((s) => s.setLang);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("sadd.lang");
      if (saved === "ar" || saved === "en") setLang(saved);
    } catch {}
  }, [setLang]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  return null;
}
