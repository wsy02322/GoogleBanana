/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Google Sans', 'Inter', 'system-ui', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
      colors: {
        banana: {
          50: '#fffdf2',
          100: '#fef9c3',
          300: '#fde047',
          400: '#facc15',
          500: '#eab308',
        },
        chatgpt: {
          bg: '#f7f7f8',
          'bg-dark': '#212121',
          surface: '#ececf1',
          'surface-dark': '#2f2f2f',
          composer: '#ffffff',
          'composer-dark': '#303030',
          user: '#f4f4f4',
          'user-dark': '#2f2f2f',
          border: '#e5e5e5',
          'border-dark': '#444444',
          accent: '#10a37f',
          'accent-hover': '#0d8c6d',
        },
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'soft-pop': {
          '0%': { opacity: '0', transform: 'scale(0.92)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out',
        shimmer: 'shimmer 1.5s infinite',
        'soft-pop': 'soft-pop 0.35s ease-out',
      },
    },
  },
  plugins: [],
}
