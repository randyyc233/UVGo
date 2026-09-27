import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#087A36',
          dark: '#07562C',
          deeper: '#043D20',
          soft: '#EAF5EC',
        },
        secondary: '#339647',
        accent: '#DDEED7',
        background: '#F8F7F2',
        surface: '#FFFFFF',
        cream: '#F4F0E8',
        border: {
          DEFAULT: '#E3E5DF',
          strong: '#CDD3CA',
        },
        text: {
          primary: '#13271B',
          secondary: '#667168',
          muted: '#8B938D',
          inverse: '#FFFFFF',
        },
        success: {
          DEFAULT: '#15813A',
          soft: '#E8F5E9',
        },
        warning: {
          DEFAULT: '#D97706',
          soft: '#FFF5DE',
        },
        danger: {
          DEFAULT: '#DC2626',
          soft: '#FDECEC',
        },
        info: {
          DEFAULT: '#1769E0',
          soft: '#EAF2FF',
        },
        unavailable: '#D9DCDA',
        // Merchant-supplied PayPal single-button brand colors.
        paypal: { gold: '#FFD140', ink: '#000000' },
      },
      fontFamily: {
        paypal: ['Helvetica Neue', 'Arial', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        card: '1rem',
        control: '0.75rem',
        pill: '9999px',
      },
      boxShadow: {
        card: '0 4px 18px rgba(28, 47, 35, 0.07)',
        floating: '0 10px 32px rgba(28, 47, 35, 0.12)',
        nav: '0 -4px 18px rgba(28, 47, 35, 0.08)',
      },
      maxWidth: {
        app: '90rem',
      },
      minHeight: {
        touch: '2.75rem',
      },
      minWidth: {
        touch: '2.75rem',
      },
    },
  },
  plugins: [],
} satisfies Config;
