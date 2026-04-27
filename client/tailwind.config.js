/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand kept as a name for compatibility, mapped to the design's
        // "neutral indigo" data-viz accent. Concrete dark-mode tones come
        // from the global CSS recolor in index.css.
        brand: {
          50:  'oklch(0.72 0.16 260 / 0.10)',
          100: 'oklch(0.72 0.16 260 / 0.18)',
          200: 'oklch(0.72 0.16 260 / 0.40)',
          300: 'oklch(0.72 0.16 260 / 0.50)',
          400: 'oklch(0.72 0.16 260 / 0.60)',
          500: 'oklch(0.72 0.16 260)',
          600: 'oklch(0.72 0.16 260)',
          700: 'oklch(0.66 0.16 260)',
          800: 'oklch(0.85 0.12 260)',
          900: 'oklch(0.92 0.08 260)',
        },
        canvas:   'var(--bg-canvas)',
        surface:  'var(--bg-surface)',
        surface2: 'var(--bg-surface-2)',
        elevated: 'var(--bg-elevated)',
      },
      fontFamily: {
        display: ['Inter Tight', 'ui-sans-serif', 'system-ui'],
        sans:    ['Inter', 'ui-sans-serif', 'system-ui'],
        mono:    ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '14px',
        xl: '20px',
      },
      boxShadow: {
        card: '0 1px 0 oklch(1 0 0 / 0.04) inset, 0 1px 2px oklch(0 0 0 / 0.3)',
        pop:  '0 1px 0 oklch(1 0 0 / 0.05) inset, 0 12px 32px -8px oklch(0 0 0 / 0.5)',
      },
    },
  },
  plugins: [],
};
