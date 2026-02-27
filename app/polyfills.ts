// app/polyfills.ts

// ✅ Fix Safari/Expo Web: some code references `process` (env vars)
// If `process` doesn't exist, Safari throws "Can't find variable: process"
if (typeof (globalThis as any).process === "undefined") {
  (globalThis as any).process = { env: {} };
}

// URL & fetch-related fixes for RN/web
import "react-native-url-polyfill/auto";

// Needed by libs that call crypto.getRandomValues (UUIDs, etc.)
import "react-native-get-random-values";

// Minimal crypto shim for web (Expo SDK 50 + Webpack 5)
try {
  if (
    typeof globalThis !== "undefined" &&
    (typeof (globalThis as any).crypto === "undefined" ||
      typeof (globalThis as any).crypto.getRandomValues === "undefined")
  ) {
    const { getRandomValues } = require("expo-crypto");
    (globalThis as any).crypto = { getRandomValues };
  }
} catch {
  // No-op
}