// components/SettingsButton.tsx
import React, { useCallback, useRef } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSettingsModal } from '../app/context/SettingsModalContext';
import { useAppTheme } from '../app/context/ThemeContext';

type Props = {
  absolute?: boolean;
  topOffset?: number;   // extra top spacing if a screen’s title sits very high
  rightOffset?: number; // extra right spacing for web
};

export default function SettingsButton({ absolute = true, topOffset = 16, rightOffset = 12 }: Props) {
  const { open } = useSettingsModal();
  const { colors, isLight } = useAppTheme();
  const insets = useSafeAreaInsets();
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = useCallback(
    (value: number, duration: number) => {
      Animated.timing(scale, {
        toValue: value,
        duration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    },
    [scale]
  );

  const Button = (
    <Pressable
      onPress={open}
      onPressIn={() => animateTo(0.92, 90)}
      onPressOut={() => animateTo(1, 150)}
      hitSlop={12}
      style={({ pressed }) => ({
        opacity: pressed ? 0.7 : 1,
        padding: 8,
        borderRadius: 999,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        // soft shadow for iOS / elevation for Android
        shadowColor: colors.shadow,
        shadowOpacity: isLight ? 0.14 : 0.08,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
      })}
      accessibilityRole="button"
      accessibilityLabel="Open Settings"
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Ionicons
          name="settings-outline"
          size={22}                          // slightly smaller = less intrusive
          color={colors.textPrimary}
        />
      </Animated.View>
    </Pressable>
  );

  if (!absolute) return Button;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: insets.top + topOffset,      // nudge down to clear headings
        right: rightOffset,               // small gutter
        zIndex: 9999,
      }}
    >
      {Button}
    </View>
  );
}
