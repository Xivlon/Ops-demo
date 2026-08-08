/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './templates/**/*.html',
    './src/**/*.ts',
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
