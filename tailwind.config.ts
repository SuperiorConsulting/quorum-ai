import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/hooks/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        quorum: {
          indigo:  '#6366f1',
          violet:  '#8b5cf6',
          amber:   '#f59e0b',
          emerald: '#10b981',
          bg:      '#04050a',
          surface: '#0d0f18',
          border:  'rgba(255,255,255,0.05)',
        },
      },
      fontFamily: {
        sans:  ['Instrument Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono:  ['Syne Mono', 'ui-monospace', 'monospace'],
        display: ['Syne', 'ui-sans-serif', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
}

export default config
