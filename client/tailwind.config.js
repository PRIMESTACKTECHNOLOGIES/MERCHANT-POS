/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./portal-root/**/*.{html,js,ts,jsx,tsx}",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      lineClamp: {
        2: '2',
      },
    },
  },
  plugins: [],
}
