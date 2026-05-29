/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Wodoga brand palette — matches the existing prototype
        forest:  { DEFAULT: '#1B4332', mid: '#2D6A4F', light: '#40916C', pale: '#D8F3DC', ghost: '#F0FAF2' },
        ink:     { DEFAULT: '#1A1917', 2: '#4A4845', 3: '#8A8784', 4: '#B8B5B0' },
        surface: { DEFAULT: '#FFFFFF', 2: '#F2F0EC', border: '#E4E1DA', borderLt: '#EDEBE6' },
        bg:      '#F7F6F3',
        blue:    { DEFAULT: '#1E3A8A', mid: '#2563EB', pale: '#DBEAFE', ghost: '#EFF6FF' },
        amber:   { DEFAULT: '#92400E', mid: '#D97706', pale: '#FEF3C7', ghost: '#FFFBEB' },
        red:     { DEFAULT: '#991B1B', mid: '#DC2626', pale: '#FEE2E2', ghost: '#FEF2F2' },
        purple:  { DEFAULT: '#4C1D95', mid: '#7C3AED', pale: '#EDE9FE', ghost: '#F5F3FF' },
        teal:    { DEFAULT: '#134E4A', mid: '#0D9488', pale: '#CCFBF1', ghost: '#F0FDFA' },
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        sans:    ['Manrope', 'system-ui', 'sans-serif'],
        mono:    ['"DM Mono"', 'monospace'],
      },
      boxShadow: {
        xs:  '0 1px 2px rgba(0,0,0,0.05)',
        sm:  '0 1px 4px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.04)',
        DEFAULT: '0 2px 8px rgba(0,0,0,0.07), 0 4px 20px rgba(0,0,0,0.05)',
        lg:  '0 8px 32px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.06)',
        xl:  '0 20px 60px rgba(0,0,0,0.14), 0 4px 16px rgba(0,0,0,0.08)',
      },
      borderRadius: {
        sm:  '6px',
        DEFAULT: '10px',
        lg:  '14px',
        xl:  '20px',
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
