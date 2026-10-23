/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        fondo: '#0b0f17',
        panel: '#121826',
        borde: '#232c3d',
        acento: '#f59e0b',
        local: '#38bdf8',
        visitante: '#f472b6',
      },
    },
  },
  plugins: [],
};
