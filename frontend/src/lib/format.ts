import type { Lang } from "./i18n";

const TZ = "Asia/Qatar";

export function fmtTime(iso: string | Date, lang: Lang, withDate = false): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const locale = lang === "ar" ? "ar-QA-u-nu-latn" : "en-GB";
  return new Intl.DateTimeFormat(locale, {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(withDate ? { weekday: "short", day: "numeric", month: "short", year: "numeric" } : {}),
  }).format(d);
}

/** "Tue 14:30" — compact axis label for multi-day series. */
export function fmtDayTime(iso: string | Date, lang: Lang): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const locale = lang === "ar" ? "ar-QA-u-nu-latn" : "en-GB";
  return new Intl.DateTimeFormat(locale, { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

export function fmtDate(iso: string | Date, lang: Lang): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const locale = lang === "ar" ? "ar-QA-u-nu-latn" : "en-GB";
  return new Intl.DateTimeFormat(locale, { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
}

export function fmtInt(n: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === "ar" ? "ar-QA-u-nu-latn" : "en-US").format(Math.round(n));
}

export function fmtCompact(n: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === "ar" ? "ar-QA-u-nu-latn" : "en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

export function fmtDuration(minutes: number | null | undefined, lang: Lang): string {
  if (minutes == null || Number.isNaN(minutes)) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (lang === "ar") return h > 0 ? `${h} س ${m} د` : `${m} د`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
