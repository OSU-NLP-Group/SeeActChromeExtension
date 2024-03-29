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
        logging: {
            import: path.resolve(root, "src", "utils", "BrowserBackgroundTransport.ts"),
            filename: path.join("utils", "BrowserBackgroundTransport.js")
        },
        background: {
            import: path.resolve(root, "src", "background.ts"),
            dependOn: 'logging'
        },
        popup: {
            import: path.resolve(root, "src", "popup.ts"),
            dependOn: 'logging'
        },
        page_interaction: {
            import: path.resolve(root, "src", "page_interaction.ts"),
            dependOn: 'logging'
        }
    },
    devtool: "source-map",
    output: {
        path: path.join(root, "dist", "src"),
        filename: "[name].js",
        clean: true
    },
    resolve: {
        extensions: [".ts", ".js"],
        fallback: {
            "os": require.resolve("os-browserify/browser"),
            "fs": false,//require.resolve("browserify-fs"),
            "buffer": require.resolve("buffer"),
            "assert": require.resolve("assert/"),
            "path": require.resolve("path-browserify"),
            "url": require.resolve("url/"),
            "stream": require.resolve("stream-browserify"),
            "http": require.resolve("stream-http"),
            "zlib": require.resolve("browserify-zlib"),
            "https": require.resolve("https-browserify")
        }
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
            // chunks: ["todo"],
            showErrors: true,
            inject: false
        }),

    ],
};