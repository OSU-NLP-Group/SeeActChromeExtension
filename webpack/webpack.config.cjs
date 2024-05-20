//credit to https://betterprogramming.pub/creating-chrome-extensions-with-typescript-914873467b65

const path = require('path');

const {CleanWebpackPlugin} = require('clean-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const root = path.resolve(__dirname, "..");
const pathsToClean = [path.resolve(root, 'dist')];
module.exports = {
    mode: "development",
    context: root,
    entry: {
        //todo eventually revisit the idea of having a separate entry for utils/shared_logging_setup.ts and then
        // having the other entry points depend on it. possibly a similar thing for any other multiply-used utils files
        // like utils/misc.ts
        background: path.resolve(root, "src", "background.ts"),
        popup: path.resolve(root, "src", "popup.ts"),
        page_interaction: path.resolve(root, "src", "page_interaction.ts"),
        options: path.resolve(root, "src", "options.ts")
    },
    devtool: "source-map",
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
        new CleanWebpackPlugin({cleanOnceBeforeBuildPatterns: pathsToClean}),
        new CopyPlugin({
            patterns: [
                {from: path.resolve(root, "manifest.json"), to: path.resolve(root, "dist")},
                {from: "images", to: path.resolve(root, "dist", "images"), context: root},
            ]
        }),
        new HtmlWebpackPlugin({
            template: path.resolve(root, "src", "popup.html"),
            filename: "popup.html",
            chunks: ["popup"],
            showErrors: true,
            inject: "body"
        }),
        new HtmlWebpackPlugin({
            template: path.resolve(root, "src", "options.html"),
            filename: "options.html",
            chunks: ["options"],
            showErrors: true,
            inject: "body"
        })
    ],
};