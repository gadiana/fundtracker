import { useEffect, useState } from 'react';

/**
 * Light or dark mode and an accent color, chosen per device (kept in this browser). The colors
 * live in themes.css; public/theme-init.js applies the saved choice before the page first paints.
 */
export type ThemeMode = 'light' | 'dark' | 'system';
export interface Theme {
  mode: ThemeMode;
  accent: string;
}

export const ACCENTS = [
  { id: 'indigo', label: 'Indigo', swatch: 'oklch(51.1% 0.262 276.966)' },
  { id: 'blue', label: 'Blue', swatch: 'oklch(54.6% 0.245 262.881)' },
  { id: 'teal', label: 'Teal', swatch: 'oklch(60% 0.118 184.704)' },
  { id: 'green', label: 'Green', swatch: 'oklch(59.6% 0.145 163.225)' },
  { id: 'purple', label: 'Purple', swatch: 'oklch(54.1% 0.281 293.009)' },
  { id: 'rose', label: 'Rose', swatch: 'oklch(58.6% 0.253 17.585)' },
  { id: 'orange', label: 'Orange', swatch: 'oklch(64.6% 0.222 41.116)' },
] as const;

const KEY = 'sft-theme';
const DEFAULT: Theme = { mode: 'system', accent: 'indigo' };
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

export function readTheme(): Theme {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Theme> | null;
    return {
      mode: saved?.mode === 'light' || saved?.mode === 'dark' ? saved.mode : 'system',
      accent: ACCENTS.some((a) => a.id === saved?.accent) ? saved!.accent! : DEFAULT.accent,
    };
  } catch {
    return DEFAULT;
  }
}

const isDark = (t: Theme) => t.mode === 'dark' || (t.mode === 'system' && darkQuery().matches);

/** Puts the theme on <html>; colors ease over when `animate` is on. */
export function applyTheme(t: Theme, animate = false) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add('theme-changing');
    window.setTimeout(() => root.classList.remove('theme-changing'), 250);
  }
  root.dataset.mode = isDark(t) ? 'dark' : 'light';
  root.dataset.accent = t.accent;
  // the phone's status bar follows along
  const bar = document.querySelector('meta[name="theme-color"]');
  if (bar) bar.setAttribute('content', isDark(t) ? '#0f172b' : (ACCENTS.find((a) => a.id === t.accent)?.swatch ?? '#4338ca'));
}

/** The current theme and a setter that saves and applies it. Follows the device in "system" mode. */
export function useTheme() {
  const [theme, setThemeState] = useState(readTheme);

  useEffect(() => {
    if (theme.mode !== 'system') return;
    const query = darkQuery();
    const onChange = () => applyTheme(theme, true);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = (change: Partial<Theme>) => {
    const next = { ...theme, ...change };
    localStorage.setItem(KEY, JSON.stringify(next));
    applyTheme(next, true);
    setThemeState(next);
  };
  return [theme, setTheme] as const;
}
