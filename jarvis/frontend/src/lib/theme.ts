/** Appearance: dark / light / follow the OS, plus an accent colour. Stored per browser (localStorage). */

export type ThemeMode = "dark" | "light" | "system";

export const ACCENTS: Record<string, { label: string; dark: [string, string]; light: [string, string] }> = {
  cyan: { label: "Циан", dark: ["#4fd1e8", "#8be9f7"], light: ["#0891b2", "#0e7490"] },
  violet: { label: "Фиолетовый", dark: ["#a78bfa", "#c4b5fd"], light: ["#7c3aed", "#6d28d9"] },
  emerald: { label: "Изумрудный", dark: ["#34d399", "#6ee7b7"], light: ["#059669", "#047857"] },
  amber: { label: "Янтарный", dark: ["#f5b945", "#fcd34d"], light: ["#b45309", "#92400e"] },
  rose: { label: "Розовый", dark: ["#fb7185", "#fda4af"], light: ["#e11d48", "#be123c"] },
};

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
}

export function themeMode(): ThemeMode {
  const t = read("jarvis.theme");
  return t === "light" || t === "dark" || t === "system" ? t : "dark";
}

export function accentName(): string {
  const a = read("jarvis.accent");
  return a && a in ACCENTS ? a : "cyan";
}

const media = typeof matchMedia !== "undefined" ? matchMedia("(prefers-color-scheme: light)") : null;

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

export function applyAppearance(mode: ThemeMode = themeMode(), accent: string = accentName()) {
  const root = document.documentElement;
  const resolved = mode === "system" ? (media?.matches ? "light" : "dark") : mode;
  root.dataset.theme = resolved;
  const style = root.style;
  if (accent === "cyan") {
    for (const p of ["--accent", "--accent-strong", "--accent-soft", "--glow", "--chart-1"]) style.removeProperty(p);
    return;
  }
  const [a, strong] = ACCENTS[accent][resolved];
  const rgb = hexToRgb(a);
  style.setProperty("--accent", a);
  style.setProperty("--accent-strong", strong);
  style.setProperty("--accent-soft", `rgb(${rgb} / ${resolved === "dark" ? 0.12 : 0.1})`);
  style.setProperty("--glow", resolved === "dark"
    ? `0 0 0 1px rgb(${rgb} / 0.18), 0 0 40px -12px rgb(${rgb} / 0.35)`
    : `0 0 0 1px rgb(${rgb} / 0.2), 0 8px 30px -12px rgb(${rgb} / 0.35)`);
}

export function setAppearance(mode: ThemeMode, accent: string) {
  write("jarvis.theme", mode);
  write("jarvis.accent", accent);
  applyAppearance(mode, accent);
}

/** Re-apply when the OS switches light/dark while "system" is selected. */
export function watchSystemTheme() {
  media?.addEventListener("change", () => {
    if (themeMode() === "system") applyAppearance();
  });
}
