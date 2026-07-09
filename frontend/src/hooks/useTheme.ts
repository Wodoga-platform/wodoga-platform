'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

/**
 * Theme hook — reads/sets the `dark` class on <html> and persists the
 * choice to localStorage under 'wodoga-theme'. The initial class is set
 * by the inline script in layout.tsx (before paint, no flash); this hook
 * just keeps React state in sync and provides the toggle.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>('light');

  // On mount, read the actual current state from the DOM (set pre-paint)
  useEffect(() => {
    const isDark = document.documentElement.classList.contains('dark');
    setTheme(isDark ? 'dark' : 'light');
  }, []);

  const apply = (next: Theme) => {
    setTheme(next);
    try {
      if (next === 'dark') document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
      localStorage.setItem('wodoga-theme', next);
    } catch {
      /* localStorage unavailable — theme still applies for this session */
    }
  };

  const toggle = () => apply(theme === 'dark' ? 'light' : 'dark');

  return { theme, toggle, setTheme: apply };
}
