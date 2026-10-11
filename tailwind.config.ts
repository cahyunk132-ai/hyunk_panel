import type { Config } from 'tailwindcss';

/**
 * Warna diambil dari CSS variables (lihat lib/appearance/apply.ts) sehingga seluruh
 * panel mengikuti tema aktif. Format variable: "r g b" → rgb(var(--x) / <alpha-value>).
 */
const c = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        base: {
          DEFAULT: c('bg-primary'),
          950: c('bg-sidebar'),
          900: c('bg-primary'),
          850: c('card'),
          800: c('bg-secondary'),
          700: c('bg-tertiary'),
          600: c('bg-quaternary'),
        },
        line: {
          DEFAULT: c('border'),
          soft: c('border-soft'),
        },
        accent: {
          DEFAULT: c('accent'),
          dim: c('accent-dim'),
          soft: 'rgb(var(--accent) / 0.12)',
        },
        // Teks di atas latar aksen (tombol primary, badge aksen).
        'on-accent': c('on-accent'),
        ink: {
          DEFAULT: c('text-primary'),
          muted: c('text-secondary'),
          faint: c('text-faint'),
          soft: c('text-soft'),
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.35)',
        glow: '0 0 0 1px rgb(var(--accent) / 0.25), 0 4px 24px rgb(var(--accent) / 0.08)',
      },
    },
  },
  plugins: [],
};

export default config;
