/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        fondo: '#18191c',
        panel: '#232428',
        panel2: '#2b2d31',
        borde: '#3a3c42',
        texto: '#e6e6e8',
        tenue: '#9a9ca3',
        acento: '#4f8cff',
        aviso: '#f5a524',
        peligro: '#ef4444',
        ok: '#22c55e',
      },
      fontSize: { xxs: ['10px', '14px'] },
    },
  },
  plugins: [],
};
