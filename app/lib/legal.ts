export const PRIVACY_POLICY_URL = 'https://overlooked.cloud/privacy';
export const TERMS_OF_USE_URL =
  'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

export const SUBSCRIPTION_TITLE = 'Overlooked Pro Monthly';
export const SUBSCRIPTION_LENGTH = 'Monthly';
export const SUBSCRIPTION_PRICE_CURRENCY_SYMBOL = '€';
export const SUBSCRIPTION_PRICE_AMOUNT = '9.99';
export const SUBSCRIPTION_PRICE_FALLBACK = `${SUBSCRIPTION_PRICE_CURRENCY_SYMBOL}${SUBSCRIPTION_PRICE_AMOUNT}`;
export const SUBSCRIPTION_OFFER_PRICE_AMOUNT = '3';
export const SUBSCRIPTION_OFFER_PRICE_FALLBACK = `${SUBSCRIPTION_PRICE_CURRENCY_SYMBOL}${SUBSCRIPTION_OFFER_PRICE_AMOUNT}`;
export const SUBSCRIPTION_OFFER_DISCOUNT = '70% off';
export const SUBSCRIPTION_OFFER_CODE = 'FOUNDERS2026';

export function getSubscriptionOfferRemaining() {
  return {
    expired: false,
    short: 'Ending soon',
    long: 'Ending soon',
    endsLabel: 'Ending soon',
  };
}

export const APP_STORE_DESCRIPTION_EULA_LINE =
  'Terms of Use (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
