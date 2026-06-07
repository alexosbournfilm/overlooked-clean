import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  type ModalProps,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

type SmoothModalProps = Omit<ModalProps, 'animationType' | 'visible'> & {
  visible: boolean;
  children: React.ReactNode;
  enterOffset?: number;
  baseFrameStyle?: StyleProp<ViewStyle>;
  frameStyle?: StyleProp<ViewStyle>;
};

export default function SmoothModal({
  visible,
  children,
  enterOffset = 96,
  transparent = true,
  baseFrameStyle,
  frameStyle,
  ...modalProps
}: SmoothModalProps) {
  const progress = useRef(new Animated.Value(0)).current;
  const [rendered, setRendered] = useState(visible);

  useEffect(() => {
    progress.stopAnimation();

    if (visible) {
      setRendered(true);
      progress.setValue(0);

      Animated.timing(progress, {
        toValue: 1,
        duration: 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }

    if (!rendered) return;

    Animated.timing(progress, {
      toValue: 0,
      duration: 190,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setRendered(false);
    });
  }, [enterOffset, progress, rendered, visible]);

  if (!rendered) return null;

  const animatedFrame = (
    <Animated.View
      style={[
        styles.frame,
        frameStyle,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [enterOffset, 0],
              }),
            },
            {
              scale: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0.985, 1],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );

  return (
    <Modal
      {...modalProps}
      visible={rendered}
      transparent={transparent}
      animationType="none"
    >
      {baseFrameStyle ? (
        <View style={[styles.frame, baseFrameStyle]}>{animatedFrame}</View>
      ) : (
        animatedFrame
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
  },
});
