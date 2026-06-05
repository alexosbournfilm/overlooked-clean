// screens/PaySuccessScreen.tsx
import React, { useCallback } from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useNavigation, CommonActions } from '@react-navigation/native';
import { navigationRef } from '../navigation/navigationRef'; // ✅ use the global ref you already have
import { useAppTheme } from '../context/ThemeContext';

export default function PaySuccessScreen() {
  const { colors } = useAppTheme();
  const nav = useNavigation<any>();

  const goToCreateProfile = useCallback(() => {
    // Try multiple strategies so it works regardless of navigator shape.

    // A) Use the global ref if available (most reliable in your app)
    if (navigationRef.isReady()) {
      try {
        navigationRef.dispatch(CommonActions.navigate({ name: 'CreateProfile' }));
        return;
      } catch {}
      try {
        navigationRef.dispatch(
          CommonActions.reset({ index: 0, routes: [{ name: 'CreateProfile' }] })
        );
        return;
      } catch {}
      try {
        // If CreateProfile lives inside an Auth stack
        navigationRef.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'Auth', state: { routes: [{ name: 'CreateProfile' }] } }],
          })
        );
        return;
      } catch {}
    }

    // B) Fall back to the local nav object
    try {
      nav.navigate('CreateProfile');
      return;
    } catch {}
    try {
      nav.dispatch(CommonActions.navigate({ name: 'CreateProfile' }));
      return;
    } catch {}
    try {
      nav.reset({ index: 0, routes: [{ name: 'CreateProfile' }] });
      return;
    } catch {}
    try {
      nav.reset({
        index: 0,
        routes: [{ name: 'Auth', state: { routes: [{ name: 'CreateProfile' }] } }],
      });
    } catch (e) {
      console.warn('Navigation to CreateProfile failed:', e);
    }
  }, [nav]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <TouchableOpacity onPress={goToCreateProfile} style={[styles.cta, { backgroundColor: colors.primary }]} activeOpacity={0.9}>
        <Text style={[styles.ctaText, { color: colors.textOnPrimary }]}>Continue to Create Profile</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  cta: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
  },
  ctaText: {
    fontWeight: '700',
    fontSize: 16,
  },
});
