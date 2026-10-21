/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#09090b',
        surface: {
          50: '#1c1c21',
          100: '#18181b',
          200: '#121215',
          300: '#0c0c0e',
        },
        border: {
          subtle: '#27272a',
          muted: '#3f3f46',
        },
        primary: {
          DEFAULT: '#6366f1',
          hover: '#4f46e5',
        },
        protected: '#10b981', // Emerald
        risk: '#f43f5e',      // Rose
        warning: '#f59e0b',   // Amber
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
