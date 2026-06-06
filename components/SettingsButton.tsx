// components/SettingsButton.tsx
import React, { useCallback, useRef } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSettingsModal } from '../app/context/SettingsModalContext';
import { useAppTheme } from '../app/context/ThemeContext';
import { useInAppNotifications } from '../app/context/InAppNotificationsContext';

type Props = {
  absolute?: boolean;
  topOffset?: number;   // extra top spacing if a screen’s title sits very high
  rightOffset?: number; // extra right spacing for web
};

export default function SettingsButton({ absolute = true, topOffset = 16, rightOffset = 12 }: Props) {
  const { open } = useSettingsModal();
  const { colors, isLight } = useAppTheme();
  const { unreadCount } = useInAppNotifications();
  const insets = useSafeAreaInsets();
  const scale = useRef(new Animated.Value(1)).current;
  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);

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
      onPress={() => open()}
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
        position: 'relative',
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

      {unreadCount > 0 ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: -5,
            right: -6,
            minWidth: 18,
            height: 18,
            borderRadius: 999,
            paddingHorizontal: 5,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.primary,
            borderWidth: 1,
            borderColor: colors.card,
          }}
        >
          <Text
            style={{
              color: colors.textOnPrimary,
              fontSize: 10,
              lineHeight: 12,
              fontWeight: '900',
            }}
            numberOfLines={1}
          >
            {badgeText}
          </Text>
        </View>
      ) : null}
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
