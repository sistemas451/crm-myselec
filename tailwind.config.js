// Config de Tailwind (antes vivía inline en public/index.html para el CDN).
// La compila scripts/build-frontend.js en cada deploy.
module.exports = {
  content: ['./public/index.html', './public/*.jsx'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Helvetica Neue"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        /* ── Myselec 2022 brand identity ── */
        navy:    { 950: '#00304D', 900: '#004669', 800: '#0A5A82', 700: '#156D98' },
        ink:     { 900: '#231F20', 700: '#3D393A', 500: '#939598', 400: '#BCBEC0', 300: '#D8D9DB' },
        line:    '#E0E2E4',
        surface: '#F4F5F6',
        brand:   '#20759E',
        brandSoft:'#E4F0F7',
        ok:      '#16A76E',
        warn:    '#E5930A',
        bad:     '#D93636',
        purple6: '#7C5AC7',
        sky5:    '#20759E',
        orange5: '#E5760A',
      },
      boxShadow: {
        xs:   '0 1px 2px 0 rgba(0,70,105,0.03)',
        card: '0 1px 3px 0 rgba(0,70,105,0.04), 0 1px 2px -1px rgba(0,70,105,0.06)',
        lift: '0 4px 12px -2px rgba(0,70,105,0.10), 0 2px 4px -2px rgba(0,70,105,0.04)',
        pop:  '0 12px 36px -10px rgba(0,70,105,0.22), 0 4px 10px -4px rgba(0,70,105,0.08)',
        ring: '0 0 0 3px rgba(32,117,158,0.12)',
      },
      animation: {
        'fade-up':    'fadeUp .4s cubic-bezier(.32,.72,0,1) both',
        'fade-in':    'fadeIn .3s ease both',
        'slide-in':   'slideIn .3s cubic-bezier(.32,.72,0,1) both',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        fadeUp:    { from: { opacity: 0, transform: 'translateY(8px)' },  to: { opacity: 1, transform: 'none' } },
        fadeIn:    { from: { opacity: 0 },                                to: { opacity: 1 } },
        slideIn:   { from: { opacity: 0, transform: 'translateX(-6px)' }, to: { opacity: 1, transform: 'none' } },
        pulseSoft: { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.5 } },
      },
    }
  },
};
