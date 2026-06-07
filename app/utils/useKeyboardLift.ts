import { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Keyboard, Platform } from 'react-native';

type KeyboardLiftOptions = {
  enabled?: boolean;
  extraSpacing?: number;
  maxLift?: number;
};

function getKeyboardHeight(event: any) {
  const eventHeight = Math.max(0, Number(event?.endCoordinates?.height || 0));
  const screenY = Number(event?.endCoordinates?.screenY);
  const screenHeight = Dimensions.get('screen').height;
  const screenDerivedHeight =
    Number.isFinite(screenY) && screenY > 0 ? Math.max(0, screenHeight - screenY) : 0;
  const metricsHeight = Math.max(0, Number((Keyboard as any).metrics?.()?.height || 0));

  return Math.max(eventHeight, screenDerivedHeight, metricsHeight);
}

export function useKeyboardLift({
  enabled = true,
  extraSpacing = 0,
  maxLift,
}: KeyboardLiftOptions = {}) {
  const translateY = useRef(new Animated.Value(0)).current;
  const baselineWindowHeightRef = useRef(Dimensions.get('window').height);
  const resetBaselineTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardLift, setKeyboardLift] = useState(0);

  useEffect(() => {
    const dimensionsSub = Dimensions.addEventListener('change', ({ window }) => {
      if (!keyboardVisible) {
        baselineWindowHeightRef.current = window.height;
      }
    });

    return () => dimensionsSub.remove();
  }, [keyboardVisible]);

  useEffect(() => {
    if (!enabled || Platform.OS === 'web') {
      setKeyboardVisible(false);
      setKeyboardLift(0);
      translateY.stopAnimation();
      translateY.setValue(0);
      return;
    }

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const animateTo = (nextLift: number, event?: any) => {
      try {
        Keyboard.scheduleLayoutAnimation?.(event);
      } catch {}

      const duration =
        typeof event?.duration === 'number'
          ? Math.max(120, Math.min(event.duration, 280))
          : nextLift > 0
          ? 190
          : 170;

      Animated.timing(translateY, {
        toValue: -nextLift,
        duration,
        easing: nextLift > 0 ? Easing.out(Easing.cubic) : Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start();
    };

    const onShow = (event: any) => {
      if (resetBaselineTimeoutRef.current) {
        clearTimeout(resetBaselineTimeoutRef.current);
        resetBaselineTimeoutRef.current = null;
      }

      const currentWindowHeight = Dimensions.get('window').height;
      const windowShrink = Math.max(0, baselineWindowHeightRef.current - currentWindowHeight);
      const rawKeyboardHeight = getKeyboardHeight(event);
      const remainingOverlay = Math.max(0, rawKeyboardHeight - windowShrink);
      const nextLift = Math.max(
        0,
        Math.min(
          typeof maxLift === 'number' ? maxLift : Number.POSITIVE_INFINITY,
          remainingOverlay + extraSpacing
        )
      );

      setKeyboardVisible(true);
      setKeyboardLift(nextLift);
      animateTo(nextLift, event);
    };

    const onHide = (event: any) => {
      setKeyboardVisible(false);
      setKeyboardLift(0);
      animateTo(0, event);

      resetBaselineTimeoutRef.current = setTimeout(() => {
        baselineWindowHeightRef.current = Dimensions.get('window').height;
      }, 80);
    };

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);

    return () => {
      showSub.remove();
      hideSub.remove();
      if (resetBaselineTimeoutRef.current) {
        clearTimeout(resetBaselineTimeoutRef.current);
        resetBaselineTimeoutRef.current = null;
      }
    };
  }, [enabled, extraSpacing, maxLift, translateY]);

  return {
    keyboardVisible,
    keyboardLift,
    keyboardLiftStyle:
      enabled && Platform.OS !== 'web'
        ? {
            transform: [{ translateY }],
          }
        : undefined,
  };
}
