//credit to https://betterprogramming.pub/creating-chrome-extensions-with-typescript-914873467b65

const path = require('path');

const {CleanWebpackPlugin} = require('clean-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const WebpackDefinePlugin = require('webpack').DefinePlugin;

/*
maybe at some point try turning this into a webpack.config.ts file, then using templateParameters in each HtmlWebpackPlugin to
 pass in appropriate values from misc.ts for various constants' placeholders (especially URL's and the
 id/defaultModelName strings from the AiProviders object)
 */

const projectRoot = path.resolve(__dirname, "..");
const pathsToClean = [path.resolve(projectRoot, 'dist')];
module.exports = {
    mode: "development",
    context: projectRoot,
    entry: {
        //todo eventually revisit the idea of having a separate entry for utils/shared_logging_setup.ts and then
        // having the other entry points depend on it. possibly a similar thing for any other multiply-used utils files
        // like utils/misc.ts
        background: path.resolve(projectRoot, "src", "background.ts"),
        side_panel: path.resolve(projectRoot, "src", "side_panel.ts"),
        page_interaction: path.resolve(projectRoot, "src", "page_interaction.ts"),
        page_data_collection: path.resolve(projectRoot, "src", "page_data_collection.ts"),
        options: path.resolve(projectRoot, "src", "options.ts"),
        install_greeting: path.resolve(projectRoot, "src", "installation_greeting.ts"),
    },
    devtool: "source-map",
    output: {
        path: path.join(projectRoot, "dist", "src"),
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
                exclude: [path.resolve(projectRoot, 'node_modules'), path.resolve(projectRoot, 'tests')],
                options: {
                    configFile: path.resolve(projectRoot, "build_configs", "tsconfig.json")
                }
            },
            {
                test: /\.css$/i,
                use: [
                    'style-loader',
                    'css-loader',
                    {
                        loader: 'postcss-loader',
                        options: {
                            postcssOptions: {
                                config: path.resolve(projectRoot, "build_configs", "postcss.config.cjs"),
                            }
                        }
                    }
                    ],
                exclude: [path.resolve(projectRoot, 'node_modules'), path.resolve(projectRoot, 'tests')]
            }
        ],
    }
    ,
    plugins: [
        new WebpackDefinePlugin({
             '__BUILD_CONFIG': JSON.stringify({
                      BUILD_TIMESTAMP: new Date().toISOString(),
                 // Semantic Versioning
                 // The -SNAPSHOT suffix is a Maven convention to indicate that the version is a development version,
                 //  and should be temporarily snipped off when doing a build for an official release version
                        BUILD_VERSION: "1.0.1-SNAPSHOT",
                  })
         }),
        new CleanWebpackPlugin({cleanOnceBeforeBuildPatterns: pathsToClean}),
        new CopyPlugin({
            patterns: [
                {from: path.resolve(projectRoot, "manifest.json"), to: path.resolve(projectRoot, "dist")},
                {from: path.resolve(projectRoot, "documents", "privacy_policy.pdf"), to: path.resolve(projectRoot, "dist")},
                {from: path.resolve(projectRoot, "documents", "How_to_annotate_state_changing_actions_with_SeeAct_Chrome_Extension.pdf"), to: path.resolve(projectRoot, "dist")},
                {from: path.resolve(projectRoot, "documents", "user_manual.pdf"), to: path.resolve(projectRoot, "dist")},
                {
                    from: "images", to: path.resolve(projectRoot, "dist", "images"), context: projectRoot,
                    globOptions: {
                        ignore: ["**/accepting_privacy_policy.png", "**/click_load_unpacked.png",
                            "**/loading_dist_into_chrome.png", "**/open_options_menu.png", "**/open_side_panel.png",
                            "**/opening_extensions_dropdown.png", "**/pinning_extension.png", "**/save_options_changes.png",
                            "**/set_ai_api_key.png", "**/unzipping.png"]
                    }
                },
            ]
        }),
        new HtmlWebpackPlugin({
            template: path.resolve(projectRoot, "src", "side_panel.html"),
            filename: "side_panel.html",
            chunks: ["side_panel"],
            showErrors: true,
            inject: "body"
        }),
        new HtmlWebpackPlugin({
            template: path.resolve(projectRoot, "src", "options.html"),
            filename: "options.html",
            chunks: ["options"],
            showErrors: true,
            inject: "body"
        }),
        new HtmlWebpackPlugin({
            template: path.resolve(projectRoot, "src", "installation_greeting.html"),
            filename: "installation_greeting.html",
            chunks: ["install_greeting"],
            showErrors: true,
            inject: "body"
        })
    ]
};