const path = require('path');

class LegacyIndexProxyPlugin {
    apply(compiler) {
        compiler.hooks.thisCompilation.tap('LegacyIndexProxyPlugin', (compilation) => {
            compilation.hooks.processAssets.tap(
                {
                    name: 'LegacyIndexProxyPlugin',
                    stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL
                },
                () => {
                    const { RawSource } = compiler.webpack.sources;
                    compilation.emitAsset(
                        'index.js',
                        new RawSource([
                            '\'use strict\';',
                            '// Compatibility shim for Photoshop sessions that still load dist/index.js.',
                            'module.exports = require(\'./runtime.js\');',
                            ''
                        ].join('\n'))
                    );
                }
            );
        });
    }
}

module.exports = (_env, argv = {}) => {
    const mode = argv.mode === 'production' ? 'production' : 'development';

    return {
        mode,
        entry: {
            runtime: './src/index.ts'
        },
        target: ['web', 'es2020'],
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: '[name].js',
            clean: true,
            library: {
                type: 'commonjs2'
            }
        },
        optimization: {
            splitChunks: false,
            runtimeChunk: false
        },
        resolve: {
            extensions: ['.ts', '.js'],
            alias: {
                '@': path.resolve(__dirname, 'src')
            }
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    use: {
                        loader: 'ts-loader',
                        options: {
                            transpileOnly: true,
                            compilerOptions: {
                                declaration: false,
                                declarationMap: false
                            }
                        }
                    },
                    exclude: /node_modules/
                },
                {
                    test: /\.css$/,
                    use: ['style-loader', 'css-loader']
                }
            ]
        },
        externals: {
            photoshop: 'commonjs2 photoshop',
            uxp: 'commonjs2 uxp'
        },
        plugins: [
            new LegacyIndexProxyPlugin()
        ],
        // UXP loads one plugin runtime bundle. Keep an explicit budget so growth
        // is visible without duplicating the runtime for the legacy index entry.
        performance: {
            hints: false,
            maxAssetSize: 700 * 1024,
            maxEntrypointSize: 700 * 1024
        },
        devtool: 'source-map'
    };
};
