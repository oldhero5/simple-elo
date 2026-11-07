/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  future: {
    // Touch devices otherwise keep :hover styles after a tap.
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      // System fonts only: no web font downloads, which also keeps the app
      // fully usable on a tailnet without internet access.
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
