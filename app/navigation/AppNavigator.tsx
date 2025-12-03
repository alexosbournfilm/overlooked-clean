import React, { useEffect, useState } from 'react';
import {
  NavigationContainer,
  type InitialState,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, ActivityIndicator, Linking as RNLinking } from 'react-native';

import AuthStack from './AuthStack';
import MainTabs from './MainTabs';
import { navigationRef, setNavigatorReady } from './navigationRef';
import { linking } from './linking';
import { useAuth } from '../context/AuthProvider';
import { supabase } from '../lib/supabase';
import COLORS from '../theme/colors';

import PaywallScreen from '../screens/PaywallScreen';
import PaySuccessScreen from '../screens/PaySuccessScreen';
import NewPassword from '../screens/NewPassword';

const Stack = createNativeStackNavigator();

type Props = {
  initialAuthRouteName: 'SignIn' | 'CreateProfile';
};

export default function AppNavigator({ initialAuthRouteName }: Props) {
  const { ready, userId, profileComplete } = useAuth();

  const [initialState, setInitialState] = useState<InitialState | undefined>();
  const [navStateReady, setNavStateReady] = useState(false);

  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  // -----------------------------
  // 1. ABSOLUTELY CRITICAL:
  // Detect Supabase recovery links BEFORE anything else runs
  // -----------------------------
  useEffect(() => {
    const handleUrl = async (url?: string | null) => {
      try {
        const u = url ?? (await RNLinking.getInitialURL());
        if (!u) return;

        const lower = u.toLowerCase();

        // ✨ REAL Supabase reset patterns
        const isSupabaseRecovery =
          lower.includes('type=recovery') ||
          lower.includes('/auth/v1/verify') ||
          lower.includes('access_token') && lower.includes('recovery') ||
          lower.includes('reset-password');

        if (isSupabaseRecovery) {
          // Force navigation to the NewPassword screen
          setIsPasswordRecovery(true);
          setInitialState({
            routes: [{ name: 'NewPassword' }],
          });
        }
      } catch (e) {
        console.log('Recovery parse error:', e);
      }
    };

    handleUrl(null);

    const sub = RNLinking.addEventListener('url', (event) => {
      handleUrl(event.url);
    });

    return () => sub.remove();
  }, []);

  // -----------------------------
  // 2. Restore nav state ONLY if not password recovery
  // -----------------------------
  useEffect(() => {
    let mounted = true;

    const restore = async () => {
      if (!ready) return;

      // If recovery link → DO NOT restore past navigation
      if (isPasswordRecovery) {
        setNavStateReady(true);
        return;
      }

      if (!userId || !profileComplete) {
        setInitialState(undefined);
        setNavStateReady(true);
        return;
      }

      try {
        const saved = await AsyncStorage.getItem(`NAVIGATION_STATE_v2:${userId}`);
        if (saved && mounted) {
          try {
            setInitialState(JSON.parse(saved));
          } catch {}
        }
      } finally {
        if (mounted) setNavStateReady(true);
      }
    };

    restore();
    return () => {
      mounted = false;
    };
  }, [ready, userId, profileComplete, isPasswordRecovery]);

  // -----------------------------
  // 3. Subscription status watcher (unchanged)
  // -----------------------------
  const [isPaid, setIsPaid] = useState<boolean | null>(null);
  const [expired, setExpired] = useState<boolean>(false);

  useEffect(() => {
    if (!userId) {
      setIsPaid(null);
      setExpired(false);
      return;
    }

    let mounted = true;

    (async () => {
      const { data } = await supabase
        .from('users')
        .select('subscription_status, grandfathered, premium_access_expires_at')
        .eq('id', userId)
        .single();

      if (!mounted) return;

      const now = Date.now();
      const exp = data?.premium_access_expires_at
        ? new Date(data.premium_access_expires_at).getTime()
        : null;

      const isExpired = exp ? exp <= now : false;
      const status = (data?.subscription_status || '').toLowerCase();

      const paid =
        !isExpired &&
        (status === 'active' ||
          status === 'trialing' ||
          status === 'past_due' ||
          data?.grandfathered);

      setExpired(isExpired);
      setIsPaid(paid);
    })();

    return () => {
      mounted = false;
    };
  }, [userId]);

  // Auto signout on expiration
  useEffect(() => {
    if (userId && expired) {
      supabase.auth.signOut().catch(() => {});
    }
  }, [userId, expired]);

  // -----------------------------
  // 4. Loading screen
  // -----------------------------
  if (!ready || !navStateReady || (userId && isPaid === null)) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const mustShowPaywall = false;

  // -----------------------------
  // 5. MAIN NAVIGATION
  // Password recovery overrides ALL navigation branches
  // -----------------------------
  return (
    <NavigationContainer
      ref={(nav) => {
        // @ts-ignore
        navigationRef.current = nav;
      }}
      linking={linking}
      initialState={initialState}
      onReady={() => setNavigatorReady(true)}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>

        {/* ALWAYS REGISTER RESET SCREEN */}
        <Stack.Screen name="NewPassword" component={NewPassword} />

        {/* PRIORITY RULE:
            If password recovery → DO NOT SHOW ANY OTHER SCREENS
        */}
        {isPasswordRecovery ? null : !userId ? (
          <>
            <Stack.Screen name="Auth">
              {() => <AuthStack initialRouteName={initialAuthRouteName} />}
            </Stack.Screen>
          </>
        ) : mustShowPaywall ? (
          <>
            <Stack.Screen name="Paywall" component={PaywallScreen} />
            <Stack.Screen name="PaySuccess" component={PaySuccessScreen} />
          </>
        ) : !profileComplete ? (
          <>
            <Stack.Screen name="Auth">
              {() => <AuthStack initialRouteName="CreateProfile" />}
            </Stack.Screen>
          </>
        ) : (
          <>
            <Stack.Screen name="MainTabs" component={MainTabs} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
