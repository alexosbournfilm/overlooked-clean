// components/SettingsButton.tsx
import React from 'react';
import { Pressable, View, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import COLORS from '../app/theme/colors';
import { useSettingsModal } from '../app/context/SettingsModalContext';

type Props = {
  absolute?: boolean;
  topOffset?: number;   // extra top spacing if a screen’s title sits very high
  rightOffset?: number; // extra right spacing for web
};

export default function SettingsButton({ absolute = true, topOffset = 16, rightOffset = 12 }: Props) {
  const { open } = useSettingsModal();
  const insets = useSafeAreaInsets();

  const Button = (
    <Pressable
      onPress={open}
      hitSlop={12}
      style={({ pressed }) => ({
        opacity: pressed ? 0.7 : 1,
        padding: 8,
        borderRadius: 999,
        backgroundColor: COLORS.card,   // small chip so it doesn’t fight text behind it
        borderWidth: 1,
        borderColor: COLORS.border,
        // soft shadow for iOS / elevation for Android
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
      })}
      accessibilityRole="button"
      accessibilityLabel="Open Settings"
    >
      <Ionicons
        name="settings-outline"
        size={22}                          // slightly smaller = less intrusive
        color={COLORS.textPrimary}
      />
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
