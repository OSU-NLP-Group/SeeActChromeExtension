const path = require("path");
const projectRoot = path.resolve(__dirname, "..");

module.exports = {
    plugins: [
        ["tailwindcss", {config: path.resolve(projectRoot, "build_configs", "tailwind.config.cjs")}],
        "autoprefixer"
    ]
}