import { Platform } from 'react-native';

export const WEB_MOBILE_BREAKPOINT = 768;
export const PHONE_WIDTH_BREAKPOINT = 420;
export const TINY_PHONE_WIDTH_BREAKPOINT = 360;

export function isMobileWebViewport(width: number) {
  return Platform.OS === 'web' && width < WEB_MOBILE_BREAKPOINT;
}

export function usesNativeMobileLayoutOnWeb(width: number) {
  return Platform.OS !== 'web' || isMobileWebViewport(width);
}

export function isPhoneViewport(width: number) {
  return width < PHONE_WIDTH_BREAKPOINT;
}

export function isTinyPhoneViewport(width: number) {
  return width < TINY_PHONE_WIDTH_BREAKPOINT;
}
