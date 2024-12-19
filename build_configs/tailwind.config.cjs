const path = require("path");
const projectRoot = path.resolve(__dirname, "..");

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    path.join(projectRoot, "src", "**", "*.html"),
    path.join(projectRoot, "src", "installation_greeting.ts"),
    path.join(projectRoot, "src", "options.ts"),
    path.join(projectRoot, "src", "side_panel.ts")
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}

