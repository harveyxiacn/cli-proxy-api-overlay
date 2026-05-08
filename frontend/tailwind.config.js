/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0f1117',
        card: '#1a1d27',
        card2: '#22263a',
        border: '#2d3148',
        accent: '#6c63ff',
        success: '#4ade80',
        warn: '#f59e0b',
        danger: '#ef4444',
        text: '#e2e8f0',
        text2: '#94a3b8',
        text3: '#64748b',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
  ],
}
