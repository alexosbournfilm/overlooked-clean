// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const { resolve } = require('metro-resolver');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Path to our web shim
const shimPath = path.resolve(__dirname, 'web-shims/ToastAndroid.web.js');

// Keep previous resolver if Expo set one
const prev = config.resolver?.resolveRequest;

config.resolver = config.resolver || {};
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Rewrite react-native-web's ToastAndroid export to our shim on web only
  if (
    platform === 'web' &&
    (moduleName === 'react-native-web/dist/exports/ToastAndroid' ||
      moduleName.endsWith('/dist/exports/ToastAndroid'))
  ) {
    return { type: 'sourceFile', filePath: shimPath };
  }

  // ✅ SAFE FALLBACK
  if (typeof prev === 'function') return prev(context, moduleName, platform);
  return resolve(context, moduleName, platform);
};

module.exports = config;
