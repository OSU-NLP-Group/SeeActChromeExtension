//credit to https://betterprogramming.pub/creating-chrome-extensions-with-typescript-914873467b65

const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const root = path.resolve(__dirname, "..");
module.exports = {
    mode: "production",
    context: root,
    entry: {
        background: path.resolve(root, "src", "background.ts"),
    },
    output: {
        path: path.join(root, "dist", "src"),
        filename: "[name].js",
        clean: true
    },
    resolve: {
        extensions: [".ts", ".js"],
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                loader: "ts-loader",
                exclude: [path.resolve(root, 'node_modules'), path.resolve(root, 'tests')]
            },
        ],
    }
    ,
    plugins: [
        new CopyPlugin({
            patterns: [
                {from: path.resolve(root, "public"), to: path.resolve(root, "dist")},
                {from: "images", to: path.resolve(root, "dist", "images"), context: root},
                {
                    from: "src/**/*",
                    to: path.resolve(root, "dist", "[path][name][ext]"),//todo see if the [path] is doing what I want and where that syntax is defined
                    context: root,
                    filter: filepath => filepath.endsWith(".html")
                    //todo why don't I need to set context here?
                }]
        }),
    ],
};