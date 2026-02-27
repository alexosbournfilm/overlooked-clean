// webpack.config.js
const createExpoWebpackConfigAsync = require('@expo/webpack-config');
const webpack = require('webpack');
const path = require('path');

module.exports = async (env, argv) => {
  const config = await createExpoWebpackConfigAsync(env, argv);

  config.resolve.fallback = {
    ...(config.resolve.fallback || {}),
    crypto: require.resolve('crypto-browserify'),
    stream: require.resolve('stream-browserify'),
    buffer: require.resolve('buffer/'),
    process: require.resolve('process/browser'),
    vm: require.resolve('vm-browserify'),
  };

  config.plugins = [
    ...(config.plugins || []),
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: ['process/browser'],
    }),
  ];

  config.module.rules.push({
    test: /\.html$/i,
    use: 'raw-loader',
  });

  // ✅ PUT IT HERE
  config.resolve.alias = {
    ...(config.resolve.alias || {}),

    '@react-native-vector-icons/material-design-icons':
      '@expo/vector-icons/MaterialCommunityIcons',

    // stub react-native-maps for web
    'react-native-maps': path.resolve(
      __dirname,
      'app/shims/react-native-maps.web.js'
    ),

    // stub ffmpeg-kit-react-native for web
    'ffmpeg-kit-react-native': path.resolve(
      __dirname,
      'app/shims/ffmpeg-kit-react-native.web.js'
    ),
  };

  return config;
};