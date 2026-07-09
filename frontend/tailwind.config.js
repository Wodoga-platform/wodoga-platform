/** @type {import('tailwindcss').Config} */
//
// Wodoga Design System v2.1 — "The Care Thread" + dark mode
// ───────────────────────────────────────────────────────────
// All color tokens now resolve through CSS variables defined in
// src/styles/globals.css (:root = light, .dark = dark). Because every
// page consumes semantic token names, BOTH themes work with zero
// page-file changes. Toggle = 'dark' class on <html>.
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        forest:  { DEFAULT: 'rgb(var(--c-forest) / <alpha-value>)', mid: 'rgb(var(--c-forest-mid) / <alpha-value>)', light: 'rgb(var(--c-forest-light) / <alpha-value>)', pale: 'rgb(var(--c-forest-pale) / <alpha-value>)', ghost: 'rgb(var(--c-forest-ghost) / <alpha-value>)' },
        ink:     { DEFAULT: 'rgb(var(--c-ink) / <alpha-value>)', 2: 'rgb(var(--c-ink-2) / <alpha-value>)', 3: 'rgb(var(--c-ink-3) / <alpha-value>)', 4: 'rgb(var(--c-ink-4) / <alpha-value>)' },
        surface: { DEFAULT: 'rgb(var(--c-surface) / <alpha-value>)', 2: 'rgb(var(--c-surface-2) / <alpha-value>)', border: 'rgb(var(--c-border) / <alpha-value>)', borderLt: 'rgb(var(--c-border-lt) / <alpha-value>)' },
        bg:      'rgb(var(--c-bg) / <alpha-value>)',
        blue:    { DEFAULT: 'rgb(var(--c-blue) / <alpha-value>)', mid: 'rgb(var(--c-blue-mid) / <alpha-value>)', pale: 'rgb(var(--c-blue-pale) / <alpha-value>)', ghost: 'rgb(var(--c-blue-ghost) / <alpha-value>)' },
        amber:   { DEFAULT: 'rgb(var(--c-amber) / <alpha-value>)', mid: 'rgb(var(--c-amber-mid) / <alpha-value>)', pale: 'rgb(var(--c-amber-pale) / <alpha-value>)', ghost: 'rgb(var(--c-amber-ghost) / <alpha-value>)' },
        red:     { DEFAULT: 'rgb(var(--c-red) / <alpha-value>)', mid: 'rgb(var(--c-red-mid) / <alpha-value>)', pale: 'rgb(var(--c-red-pale) / <alpha-value>)', ghost: 'rgb(var(--c-red-ghost) / <alpha-value>)' },
        purple:  { DEFAULT: 'rgb(var(--c-purple) / <alpha-value>)', mid: 'rgb(var(--c-purple-mid) / <alpha-value>)', pale: 'rgb(var(--c-purple-pale) / <alpha-value>)', ghost: 'rgb(var(--c-purple-ghost) / <alpha-value>)' },
        teal:    { DEFAULT: 'rgb(var(--c-teal) / <alpha-value>)', mid: 'rgb(var(--c-teal-mid) / <alpha-value>)', pale: 'rgb(var(--c-teal-pale) / <alpha-value>)', ghost: 'rgb(var(--c-teal-ghost) / <alpha-value>)' },
      },
      fontFamily: {
        display: ['Sora', 'system-ui', 'sans-serif'],
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        mono:    ['"DM Mono"', 'monospace'],
      },
      boxShadow: {
        xs:  '0 1px 2px rgba(13,23,19,0.05)',
        sm:  '0 1px 3px rgba(13,23,19,0.07), 0 1px 8px rgba(13,23,19,0.03)',
        DEFAULT: '0 2px 6px rgba(13,23,19,0.08), 0 4px 16px rgba(13,23,19,0.04)',
        lg:  '0 6px 24px rgba(13,23,19,0.10), 0 2px 6px rgba(13,23,19,0.06)',
        xl:  '0 16px 48px rgba(13,23,19,0.14), 0 4px 12px rgba(13,23,19,0.08)',
      },
      borderRadius: { sm: '5px', DEFAULT: '8px', lg: '12px', xl: '16px' },
      animation: {
        'slide-in-right': 'slideInRight 0.25s ease',
        'modal-in':       'modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1)',
        'toast-in':       'toastIn 0.3s cubic-bezier(0.34,1.56,0.64,1)',
        'fade-in':        'fadeIn 0.2s ease',
      },
      keyframes: {
        slideInRight: { from: { transform: 'translateX(40px)', opacity: '0' }, to: { transform: 'translateX(0)', opacity: '1' } },
        modalIn: { from: { transform: 'scale(0.94) translateY(10px)', opacity: '0' }, to: { transform: 'scale(1) translateY(0)', opacity: '1' } },
        toastIn: { from: { transform: 'translateY(12px) scale(0.95)', opacity: '0' }, to: { transform: 'translateY(0) scale(1)', opacity: '1' } },
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
      },
    },
  },
  plugins: [],
};
