// webpack.config.js
const createExpoWebpackConfigAsync = require('@expo/webpack-config');
const webpack = require('webpack');
const path = require('path');

module.exports = async (env, argv) => {
  const config = await createExpoWebpackConfigAsync(env, argv);

  // Node core fallbacks for web
  config.resolve.fallback = {
    ...(config.resolve.fallback || {}),
    crypto: require.resolve('crypto-browserify'),
    stream: require.resolve('stream-browserify'),
    buffer: require.resolve('buffer/'),
    process: require.resolve('process/browser'),
    vm: require.resolve('vm-browserify'),
  };

  // Provide globals some libs expect
  config.plugins = [
    ...(config.plugins || []),
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: ['process/browser'],
    }),
  ];

  // Allow importing .html from node_modules (react-native-web-webview)
  config.module.rules.push({
    test: /\.html$/i,
    use: 'raw-loader',
  });

  // ✅ Web-only shims (NO alias for plain 'react-native-web')
  config.resolve.alias = {
    ...(config.resolve.alias || {}),
    // ToastAndroid shims for web
    'react-native-web/dist/exports/ToastAndroid': path.resolve(
      __dirname,
      'web-shims/ToastAndroid.web.js'
    ),
    'react-native-web/dist/index': path.resolve(
      __dirname,
      'web-shims/react-native-web-extended.js'
    ),
    // Quiet react-native-paper’s first-try icon import
    '@react-native-vector-icons/material-design-icons':
      '@expo/vector-icons/MaterialCommunityIcons',
  };

  return config;
};
