import type { Config } from "tailwindcss";

// Every colour comes from the CSS variables in src/styles/index.css (light + dark from the same names).
const c = (v: string) => `rgb(var(--c-${v}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: c("canvas"),
        surface: c("surface"),
        surface2: c("surface2"),
        line: c("line"),
        ink: c("ink"),
        ink2: c("ink2"),
        ink3: c("ink3"),
        accent: { DEFAULT: c("accent"), hover: c("accent-hover"), soft: c("accent-soft"), ink: c("accent-ink") },
        ai: { DEFAULT: c("ai"), soft: c("ai-soft"), ink: c("ai-ink") },
        success: { DEFAULT: c("success"), soft: c("success-soft") },
        landing: { pass: c("landing-pass") },
        warning: { DEFAULT: c("warning"), soft: c("warning-soft") },
        danger: { DEFAULT: c("danger"), soft: c("danger-soft") },
        bar: c("bar"),
        stage: c("stage"),
      },
      borderRadius: { card: "24px", block: "16px" },
      fontFamily: {
        sans: ['"Outfit Variable"', "Outfit", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono Variable"', "ui-monospace", "monospace"],
      },
      fontSize: { display: ["3rem", { lineHeight: "1", letterSpacing: "-0.03em", fontWeight: "500" }] },
      boxShadow: {
        card: "0 1px 2px rgb(0 0 0 / 0.04)",
        float: "0 12px 40px -12px rgb(10 12 20 / 0.28)",
      },
      keyframes: {
        rise: { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        pulseDot: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.35" } },
        haloIn: { from: { opacity: "0.4", transform: "scale(0.85)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: { rise: "rise 0.25s ease-out backwards", "halo-in": "haloIn 0.4s ease-out backwards", "pulse-dot": "pulseDot 1.6s ease-in-out infinite" },
    },
  },
  plugins: [],
} satisfies Config;
