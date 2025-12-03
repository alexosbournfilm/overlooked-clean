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

  // Allow importing .html (react-native-web-webview)
  config.module.rules.push({
    test: /\.html$/i,
    use: 'raw-loader',
  });

  // Vercel cannot process custom rewrites for react-native-web.

  config.resolve.alias = {
    ...(config.resolve.alias || {}),
    // Keep only this react-native-vector-icons override:
    '@react-native-vector-icons/material-design-icons':
      '@expo/vector-icons/MaterialCommunityIcons',
  };

  return config;
};
