import { Easing, Platform } from 'react-native';

const OPEN_DURATION = 250;
const CLOSE_DURATION = 190;
const ENTER_OFFSET = Platform.OS === 'web' ? 28 : 44;

export const overlookedTransitionSpec = {
  open: {
    animation: 'timing',
    config: {
      duration: OPEN_DURATION,
      easing: Easing.out(Easing.cubic),
    },
  },
  close: {
    animation: 'timing',
    config: {
      duration: CLOSE_DURATION,
      easing: Easing.in(Easing.cubic),
    },
  },
} as const;

export const forOverlookedSwipeFade = ({ current }: any) => {
  const progress = current.progress;

  return {
    cardStyle: {
      opacity: progress.interpolate({
        inputRange: [0, 0.7, 1],
        outputRange: [0, 0.94, 1],
        extrapolate: 'clamp',
      }),
      transform: [
        {
          translateY: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [ENTER_OFFSET, 0],
            extrapolate: 'clamp',
          }),
        },
        {
          scale: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0.985, 1],
            extrapolate: 'clamp',
          }),
        },
      ],
    },
  };
};

export const getOverlookedStackScreenOptions = (backgroundColor: string) => ({
  headerShown: false,
  cardStyle: { backgroundColor },
  gestureEnabled: true,
  gestureDirection: 'horizontal' as const,
  cardOverlayEnabled: false,
  cardStyleInterpolator: forOverlookedSwipeFade,
  transitionSpec: overlookedTransitionSpec,
});
