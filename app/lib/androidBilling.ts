// app/lib/androidBilling.ts
import { Platform } from 'react-native';

export const ANDROID_SUBSCRIPTION_PRODUCT_ID = 'pro_monthly';

export async function openAndroidSubscription() {
  if (Platform.OS !== 'android') {
    throw new Error('Google Play subscriptions are only available on Android.');
  }

  throw new Error(
    'Google Play billing UI is not connected yet. The next step is moving expo-iap into PaywallScreen with useIAP().'
  );
}