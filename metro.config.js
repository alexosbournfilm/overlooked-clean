// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Ensure web uses react-native-web instead of react-native internals
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  "react-native": require.resolve("react-native-web"),
};

module.exports = config;