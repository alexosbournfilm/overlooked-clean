// app/polyfills.ts

// URL & fetch-related fixes for RN/web
import 'react-native-url-polyfill/auto';

// Needed by libs that call crypto.getRandomValues (UUIDs, etc.)
import 'react-native-get-random-values';

// Minimal crypto shim for web (Expo SDK 50 + Webpack 5)
try {
  // If the browser doesn't expose a crypto with getRandomValues,
  // provide one via expo-crypto to satisfy dependencies.
  if (
    typeof globalThis !== 'undefined' &&
    (typeof (globalThis as any).crypto === 'undefined' ||
      typeof (globalThis as any).crypto.getRandomValues === 'undefined')
  ) {
    // Lazy require so native platforms don't bundle this
    const { getRandomValues } = require('expo-crypto');
    (globalThis as any).crypto = { getRandomValues };
  }
} catch {
  // No-op: best-effort polyfill
}
