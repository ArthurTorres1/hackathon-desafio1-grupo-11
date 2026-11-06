import { useEffect, useRef, useState } from 'react';

export default function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const explicit = useRef(false);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#101e19' : '#f5f2e9');
  }, [theme]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => {
      let saved: string | null = null;
      try { saved = localStorage.getItem('foresttrace-theme'); } catch { /* Storage is optional. */ }
      if (saved === 'light' || saved === 'dark') setTheme(saved);
      else if (!explicit.current) setTheme(media.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', sync); window.addEventListener('storage', sync);
    return () => { media.removeEventListener('change', sync); window.removeEventListener('storage', sync); };
  }, []);
  return <button id="ft-theme-toggle" type="button" className="ft-btn theme-toggle" aria-pressed={theme === 'dark'} aria-label={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'} onClick={() => {
    explicit.current = true;
    const next = theme === 'dark' ? 'light' : 'dark'; setTheme(next);
    try { localStorage.setItem('foresttrace-theme', next); } catch { /* Keep the choice for this page. */ }
  }}><span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span><span>{theme === 'dark' ? 'Modo claro' : 'Modo escuro'}</span></button>;
}
