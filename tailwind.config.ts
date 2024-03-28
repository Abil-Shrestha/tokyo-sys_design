import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
      fontFamily: {
        array: ["var(--font-array)"],
        pramukh: ["var(--font-pramukh)"],
        melodrama: ["var(--font-melodrama)"],
        sligoil: ["var(--font-sligoil)"],
        outward: ["var(--font-outward)"],
        milkman: ["var(--font-milkman)"],
        geistmono: ["var(--font-geistmono)"],
      },
    },
  },
  plugins: [],
};
export default config;
