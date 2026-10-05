import type { Config } from 'tailwindcss';

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
          DEFAULT: '#0f1117',
          950: '#0c0e13',
          900: '#0f1117',
          850: '#13161f',
          800: '#171b26',
          700: '#1e2431',
          600: '#262e3f',
        },
        line: {
          DEFAULT: '#232a3a',
          soft: '#1b2130',
        },
        accent: {
          DEFAULT: '#3ecfcf',
          dim: '#2ea8a8',
          soft: 'rgba(62, 207, 207, 0.12)',
        },
        ink: {
          DEFAULT: '#e6eaf2',
          muted: '#9aa4b8',
          faint: '#5d6679',
          soft: '#7d8795',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.35)',
        glow: '0 0 0 1px rgba(62,207,207,0.25), 0 4px 24px rgba(62,207,207,0.08)',
      },
    },
  },
  plugins: [],
};

export default config;
