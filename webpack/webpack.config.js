//credit to https://betterprogramming.pub/creating-chrome-extensions-with-typescript-914873467b65

const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
module.exports = {
    mode: "production",
    entry: {
        background: path.resolve(__dirname, "..", "src", "background.ts"),
    },
    output: {
        //why doesn't this have .. and dist in separate strings?
        // todo test that change after successful extension build/load
        path: path.join(__dirname, "../dist"),
        filename: "[name].js",
    },
    resolve: {
        extensions: [".ts", ".js"],
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                loader: "ts-loader",
                exclude: [path.resolve(__dirname, "..", 'node_modules'), path.resolve(__dirname, "..", 'tests')]
            },
        ],
    }
    ,
    plugins: [
        new CopyPlugin({
            patterns: [{from: "public"}, {from: "images"}]
        }),
    ],
};