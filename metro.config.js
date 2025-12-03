// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

module.exports = (() => {
  const config = getDefaultConfig(__dirname);

  // Path to your ToastAndroid shim for Web
  const shimPath = path.resolve(__dirname, 'web-shims/ToastAndroid.web.js');

  // Only override ToastAndroid on Web — using Expo-safe resolver pattern
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (
      platform === 'web' &&
      (moduleName === 'react-native/Libraries/Components/ToastAndroid/ToastAndroid' ||
        moduleName.includes('ToastAndroid'))
    ) {
      return {
        type: 'sourceFile',
        filePath: shimPath,
      };
    }

    // Default Expo resolver
    return context.resolveRequest(context, moduleName, platform);
  };

  return config;
})();
