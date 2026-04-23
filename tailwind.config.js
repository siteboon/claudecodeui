/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        /* shadcn semantic vars — mapped to Midnight tokens in src/index.css */
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        /* ── Midnight core palette ──────────────────────────────── */
        midnight: {
          bg:              '#05060A',
          'bg-pure':       '#000000',
          bg2:             '#070709',
          'surface-1':     '#0A0A0C',
          'surface-2':     '#0B0C11',
          'surface-3':     '#16181E',
          tile:            'rgba(255,255,255,0.04)',
          'tile-hover':    'rgba(255,255,255,0.07)',
          border:          'rgba(255,255,255,0.08)',
          'border-bright': 'rgba(255,255,255,0.14)',
          text:            '#FFFFFF',
          'text-soft':     '#F3F4F7',
          text2:           'rgba(255,255,255,0.60)',
          text3:           'rgba(255,255,255,0.40)',
          text4:           'rgba(255,255,255,0.22)',
          'text-muted':    '#A8ACB6',
          accent:          'var(--midnight-accent)',
        },

        /* ── Pastel accent palette ─────────────────────────────── */
        mint:     { DEFAULT: '#A8E6CE', deep: '#0F4A2E' },
        peach:    { DEFAULT: '#FFC5A0', deep: '#4A2108' },
        lavender: { DEFAULT: '#C7B9F0', deep: '#2A1A5C' },
        butter:   { DEFAULT: '#F3DF93', deep: '#3D2E08' },
        blush:    { DEFAULT: '#F4B5BD', deep: '#511622' },
        sky:      { DEFAULT: '#B5D3F0', deep: '#0F2A4D' },

        slateblue: { DEFAULT: '#4A7A9F', 400: '#6B94B5', 500: '#4A7A9F', 600: '#375E7B' },
      },
      fontFamily: {
        display: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Segoe UI', 'Roboto', 'system-ui', 'sans-serif'],
        sans:    ['Inter', '-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Segoe UI', 'Roboto', 'system-ui', 'sans-serif'],
        mono:    ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        'display-xl': ['clamp(3rem, 6vw, 5rem)',       { lineHeight: '0.95', letterSpacing: '-0.04em',  fontWeight: '500' }],
        'display-lg': ['clamp(2.25rem, 4.5vw, 3.5rem)',{ lineHeight: '0.98', letterSpacing: '-0.03em',  fontWeight: '500' }],
        'display':    ['clamp(1.75rem, 3vw, 2.5rem)',  { lineHeight: '1.05', letterSpacing: '-0.025em', fontWeight: '500' }],
        'stat-hero':  ['clamp(2.25rem, 4vw, 3.25rem)', { lineHeight: '0.95', letterSpacing: '-0.035em', fontWeight: '500' }],
        'date-hero':  ['clamp(2.5rem, 4.5vw, 3.75rem)',{ lineHeight: '0.90', letterSpacing: '-0.045em', fontWeight: '500' }],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        '2xl': '1.25rem',
        '3xl': '1.75rem',
        '4xl': '2.25rem',
        'midnight-control': '14px',
        'midnight-card':    '22px',
        'midnight-pill':    '9999px',
        'midnight-sm':   '12px',
        'midnight-md':   '18px',
        'midnight-lg':   '22px',
        'midnight-xl':   '22px',
        'midnight-2xl':  '36px',
      },
      letterSpacing: {
        tightest: '-0.04em',
        micro:    '0.22em',
      },
      backdropBlur: {
        xs:   '2px',
        '3xl':'64px',
      },
      boxShadow: {
        'midnight-tile': '0 10px 30px -8px rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.4)',
        'midnight-lift': '0 20px 50px -12px rgba(0,0,0,0.7), 0 4px 12px rgba(0,0,0,0.5)',
      },
      spacing: {
        'safe-area-inset-bottom': 'env(safe-area-inset-bottom)',
        'mobile-nav': 'var(--mobile-nav-total)',
        'rail': 'var(--desktop-rail-width)',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        fadeUp:       { '0%': { opacity:'0', transform:'translateY(20px)' },   '100%': { opacity:'1', transform:'translateY(0)' } },
        fadeDown:     { '0%': { opacity:'0', transform:'translateY(-12px)' },  '100%': { opacity:'1', transform:'translateY(0)' } },
        fadeIn:       { '0%': { opacity:'0' },                                 '100%': { opacity:'1' } },
        slideInRight: { '0%': { opacity:'0', transform:'translateX(32px)' },   '100%': { opacity:'1', transform:'translateX(0)' } },
        slideInLeft:  { '0%': { opacity:'0', transform:'translateX(-32px)' },  '100%': { opacity:'1', transform:'translateX(0)' } },
        scaleIn:      { '0%': { opacity:'0', transform:'scale(0.92)' },        '100%': { opacity:'1', transform:'scale(1)' } },
        blurIn:       { '0%': { opacity:'0', filter:'blur(16px)' },            '100%': { opacity:'1', filter:'blur(0)' } },
        shimmerSweep: { '0%': { transform:'translateX(-120%) skewX(-12deg)' }, '100%': { transform:'translateX(320%) skewX(-12deg)' } },
        borderSheen:  { '0%': { backgroundPosition:'0% 50%' },                 '100%': { backgroundPosition:'200% 50%' } },
        pulseGlow: {
          '0%, 100%': { opacity:'0.5', boxShadow:'0 0 0 0 rgba(181,211,240,0.4)' },
          '50%':      { opacity:'1',   boxShadow:'0 0 0 8px rgba(181,211,240,0)' },
        },
        float:    { '0%, 100%': { transform:'translateY(0)' },          '50%':  { transform:'translateY(-6px)' } },
        countUp:  { '0%': { opacity:'0', transform:'translateY(12px)' },'100%': { opacity:'1', transform:'translateY(0)' } },
        pulseRing: {
          '0%':   { boxShadow:'0 0 0 0 rgba(181,211,240,0.4)' },
          '70%':  { boxShadow:'0 0 0 10px rgba(181,211,240,0)' },
          '100%': { boxShadow:'0 0 0 0 rgba(181,211,240,0)' },
        },
        'dialog-overlay-show': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'dialog-content-show': {
          from: { opacity: '0', transform: 'translate(-50%, -48%) scale(0.96)' },
          to: { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
        },
      },
      animation: {
        shimmer: 'shimmer 2.8s linear infinite',
        'fade-up':        'fadeUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in':        'fadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-down':      'fadeDown 0.7s cubic-bezier(0.16, 1, 0.3, 1) both',
        'slide-in-right': 'slideInRight 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
        'slide-in-left':  'slideInLeft 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
        'scale-in':       'scaleIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) both',
        'blur-in':        'blurIn 0.8s cubic-bezier(0.16, 1, 0.3, 1) both',
        'shimmer-sweep':  'shimmerSweep 1.2s cubic-bezier(0.4, 0, 0.2, 1)',
        'border-sheen':   'borderSheen 8s linear infinite',
        'pulse-glow':     'pulseGlow 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float':          'float 6s ease-in-out infinite',
        'spin-slow':      'spin 8s linear infinite',
        'count-up':       'countUp 1.2s cubic-bezier(0.16, 1, 0.3, 1) both',
        'pulse-ring':     'pulseRing 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'dialog-overlay-show': 'dialog-overlay-show 150ms ease-out',
        'dialog-content-show': 'dialog-content-show 150ms ease-out',
      },
      transitionTimingFunction: {
        'midnight': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'smooth':   'cubic-bezier(0.16, 1, 0.3, 1)',
        'spring':   'cubic-bezier(0.34, 1.56, 0.64, 1)',
        'swift':    'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      transitionDuration: {
        '400': '400ms',
        '600': '600ms',
        '800': '800ms',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
