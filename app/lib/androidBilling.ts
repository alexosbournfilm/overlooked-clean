// app/lib/androidBilling.ts
import { Platform } from 'react-native';

export const ANDROID_SUBSCRIPTION_PRODUCT_ID = 'overlooked_pro';

export function assertAndroidBilling() {
  if (Platform.OS !== 'android') {
    throw new Error('Google Play subscriptions are only available on Android.');
  }
}