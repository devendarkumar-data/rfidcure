/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#eef5fc', 100: '#d9e8f8', 200: '#b5d2f0', 300: '#86b5e5', 400: '#4f8fd3', 500: '#2a70bd', 600: '#165aa3', 700: '#0b4a8f', 800: '#0a3d75', 900: '#0b3159' },
      },
      fontFamily: { sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'] },
    },
  },
  plugins: [],
};
