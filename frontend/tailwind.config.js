/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./components/**/*.{js,ts,jsx,tsx,mdx}', './app/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: '#000000',
        panel: '#0f0f0f',
        signal: '#7aebff',
        alert: '#ff6666',
        amber: '#ffcb47',
        t1: '#ffffff',
        t2: 'rgba(255,255,255,0.78)',
        t3: 'rgba(255,255,255,0.62)',
        line: 'rgba(255,255,255,0.14)',
        'line-strong': 'rgba(255,255,255,0.28)',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
      },
      letterSpacing: { tightest: '-0.04em', tele: '0.06em' },
    },
  },
  plugins: [],
}
