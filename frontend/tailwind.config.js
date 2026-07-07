/** @type {import('tailwindcss').Config} */
//
// Wodoga Design System v2 — "The Care Thread"
// ─────────────────────────────────────────────
// IMPORTANT ARCHITECTURE NOTE: every token NAME below is preserved from v1.
// All 12+ app pages reference these semantic names (text-ink-3, bg-surface-2,
// border-red-pale, ...). Restyling happens by evolving the VALUES only, which
// restyles the whole app in one file with zero page-file churn.
//
// Direction: clinical precision. Cool, exact neutrals with a faint green
// undertone; a deeper evergreen primary; crisper radii and shadows.
// Full rationale + hex table in BRAND_DESIGN_SYSTEM.md.
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Primary — evergreen, deepened & cooled from v1 forest.
        // DEFAULT passes AA on white for text and button fills.
        forest:  { DEFAULT: '#0D5C46', mid: '#12805F', light: '#2BA37E', pale: '#D6F2E7', ghost: '#F2FBF7' },

        // Neutrals — cool precision with a faint green undertone.
        // ink = text ramp (1 strongest → 4 faintest)
        ink:     { DEFAULT: '#141816', 2: '#3F4643', 3: '#79827D', 4: '#AEB6B1' },
        surface: { DEFAULT: '#FFFFFF', 2: '#F3F5F4', border: '#E2E6E4', borderLt: '#ECEFED' },
        bg:      '#F8FAF9',

        // Status hues — kept from v1 (semantically correct, AA-checked);
        // identity change lives in neutrals + primary, not alert colors.
        blue:    { DEFAULT: '#1E3A8A', mid: '#2563EB', pale: '#DBEAFE', ghost: '#EFF6FF' },
        amber:   { DEFAULT: '#92400E', mid: '#D97706', pale: '#FEF3C7', ghost: '#FFFBEB' },
        red:     { DEFAULT: '#991B1B', mid: '#DC2626', pale: '#FEE2E2', ghost: '#FEF2F2' },
        purple:  { DEFAULT: '#4C1D95', mid: '#7C3AED', pale: '#EDE9FE', ghost: '#F5F3FF' },
        teal:    { DEFAULT: '#134E4A', mid: '#0D9488', pale: '#CCFBF1', ghost: '#F0FDFA' },
      },
      fontFamily: {
        // Sora: geometric, quietly technical display — replaces the editorial
        // serif. Inter: UI/body — chosen for sub-14px legibility and tabular
        // numerals (vitals & doses align in columns). DM Mono retained.
        display: ['Sora', 'system-ui', 'sans-serif'],
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        mono:    ['"DM Mono"', 'monospace'],
      },
      boxShadow: {
        // Crisper, cooler elevation: tighter blur, green-tinted ink.
        xs:  '0 1px 2px rgba(13,23,19,0.05)',
        sm:  '0 1px 3px rgba(13,23,19,0.07), 0 1px 8px rgba(13,23,19,0.03)',
        DEFAULT: '0 2px 6px rgba(13,23,19,0.08), 0 4px 16px rgba(13,23,19,0.04)',
        lg:  '0 6px 24px rgba(13,23,19,0.10), 0 2px 6px rgba(13,23,19,0.06)',
        xl:  '0 16px 48px rgba(13,23,19,0.14), 0 4px 12px rgba(13,23,19,0.08)',
      },
      borderRadius: {
        // One step crisper across the board (10 → 8 default).
        sm:  '5px',
        DEFAULT: '8px',
        lg:  '12px',
        xl:  '16px',
      },
      animation: {
        'slide-in-right': 'slideInRight 0.25s ease',
        'modal-in':       'modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1)',
        'toast-in':       'toastIn 0.3s cubic-bezier(0.34,1.56,0.64,1)',
        'fade-in':        'fadeIn 0.2s ease',
      },
      keyframes: {
        slideInRight: {
          from: { transform: 'translateX(40px)', opacity: '0' },
          to:   { transform: 'translateX(0)',    opacity: '1' },
        },
        modalIn: {
          from: { transform: 'scale(0.94) translateY(10px)', opacity: '0' },
          to:   { transform: 'scale(1) translateY(0)',       opacity: '1' },
        },
        toastIn: {
          from: { transform: 'translateY(12px) scale(0.95)', opacity: '0' },
          to:   { transform: 'translateY(0) scale(1)',       opacity: '1' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
