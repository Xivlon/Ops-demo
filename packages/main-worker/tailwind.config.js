/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './templates/**/*.html',
    './src/**/*.ts',
  ],
  safelist: [
    'bg-yellow-500',
    'bg-blue-500',
    'bg-purple-500',
    'bg-green-500',
    'bg-red-500',
    'bg-slate-500',
    'bg-orange-500',
    'bg-amber-500',
    'bg-cyan-500',
  ],
  theme: {
    extend: {
      colors: {
        koda: {
          base: '#101318',
          panel: '#1B2129',
          card: '#1f2630',
          line: '#2a3140',
          gold: '#7FB4A8',
          golddim: '#3f5a54',
          red: '#e2472f',
          cream: '#E8DCC8',
          ink: '#101318',
          mute: '#7d8590',
        },
      },
      fontFamily: {
        sans: ['"Space Grotesk"', 'sans-serif'],
        mono: ['"Space Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};
