/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./menu.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        "surface": "#fcf9f4",
        "on-secondary": "#ffffff",
        "on-secondary-fixed-variant": "#76330d",
        "on-surface": "#1c1c19",
        "error-container": "#ffdad6",
        "surface-variant": "#e5e2dd",
        "surface-bright": "#fcf9f4",
        "secondary-fixed-dim": "#ffb693",
        "tertiary": "#663400",
        "on-primary-fixed-variant": "#7a3000",
        "on-primary-fixed": "#341000",
        "on-background": "#1c1c19",
        "primary-fixed": "#ffdbcb",
        "surface-container-low": "#f6f3ee",
        "on-error": "#ffffff",
        "on-primary-container": "#ffc2a5",
        "on-secondary-container": "#76340e",
        "primary-fixed-dim": "#ffb693",
        "on-error-container": "#93000a",
        "surface-container-high": "#ebe8e3",
        "surface-container": "#f0ede9",
        "primary-container": "#92400e",
        "tertiary-fixed-dim": "#ffb77d",
        "inverse-primary": "#ffb693",
        "surface-container-highest": "#e5e2dd",
        "surface-dim": "#dcdad5",
        "on-tertiary-fixed": "#2f1500",
        "primary": "#712c00",
        "inverse-surface": "#31302d",
        "on-tertiary": "#ffffff",
        "tertiary-fixed": "#ffdcc3",
        "outline-variant": "#dcc1b6",
        "error": "#ba1a1a",
        "outline": "#887269",
        "secondary-container": "#fd9e70",
        "on-primary": "#ffffff",
        "on-tertiary-fixed-variant": "#6e3900",
        "surface-tint": "#9a4614",
        "secondary": "#944a23",
        "secondary-fixed": "#ffdbcc",
        "surface-container-lowest": "#ffffff",
        "on-tertiary-container": "#ffc395",
        "on-secondary-fixed": "#351000",
        "background": "#fcf9f4",
        "tertiary-container": "#884800",
        "inverse-on-surface": "#f3f0eb",
        "on-surface-variant": "#55433a"
      },
      borderRadius: {
        "DEFAULT": "1rem",
        "lg": "2rem",
        "xl": "3rem",
        "full": "9999px"
      }
    }
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/container-queries')
  ]
}
