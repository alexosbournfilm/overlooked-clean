import React, { useEffect, useState } from 'react';
import {
  NavigationContainer,
  getStateFromPath as rnGetStateFromPath,
  type InitialState
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import AuthStack from './AuthStack';
import MainTabs from './MainTabs';
import { navigationRef, setNavigatorReady } from './navigationRef';
import { linking } from './linking';  // ⭐ USE THE SINGLE SOURCE OF TRUTH

import {
  View,
  ActivityIndicator,
  Linking as RNLinking,
  Platform
} from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import COLORS from '../theme/colors';
import { useAuth } from '../context/AuthProvider';

import PaywallScreen from '../screens/PaywallScreen';
import PaySuccessScreen from '../screens/PaySuccessScreen';
import { supabase } from '../lib/supabase';
import NewPassword from '../screens/NewPassword';

const Stack = createNativeStackNavigator();

type Props = {
  initialAuthRouteName: 'SignIn' | 'CreateProfile';
};

export default function AppNavigator({ initialAuthRouteName }: Props) {
  const { ready, userId, profileComplete } = useAuth();

  const [initialState, setInitialState] = useState<InitialState | undefined>();
  const [navStateReady, setNavStateReady] = useState(false);

  const [isPaid, setIsPaid] = useState<boolean | null>(null);
  const [expired, setExpired] = useState<boolean>(false);
  const [accessExpiresAt, setAccessExpiresAt] = useState<string | null>(null);

  const [allowCreateOnce, setAllowCreateOnce] = useState(false);
  const [paidLocalOk, setPaidLocalOk] = useState(false);

  const navKeyFor = (uid: string) => `NAVIGATION_STATE_v2:${uid}`;
  const STRIPE_OK_KEY = 'STRIPE_ALLOW_CREATE_PROFILE_ONCE';
  const localPaidKey = (uid: string) => `PAID_LOCAL_OK:${uid}`;

  // Paid bookmark
  useEffect(() => {
    (async () => {
      if (!userId) return setPaidLocalOk(false);
      const v = await AsyncStorage.getItem(localPaidKey(userId));
      setPaidLocalOk(v === '1');
    })();
  }, [userId]);

  // Stripe success URL detection
  useEffect(() => {
    let mounted = true;

    const markLocalPaid = async () => {
      if (userId) {
        await AsyncStorage.setItem(localPaidKey(userId), '1');
        if (mounted) setPaidLocalOk(true);
      }
    };

    const checkUrl = async (raw?: string | null) => {
      try {
        const url = raw ?? (await RNLinking.getInitialURL());
        if (!url) return;

        const lower = url.toLowerCase();
        if (lower.includes('create-profile')) {
          await AsyncStorage.setItem(STRIPE_OK_KEY, '1');
          if (mounted) setAllowCreateOnce(true);
          await markLocalPaid();
        }
      } catch {}
    };

    checkUrl(null);
    const sub = RNLinking.addEventListener('url', (event) => {
      checkUrl(event.url);
    });

    (async () => {
      const v = await AsyncStorage.getItem(STRIPE_OK_KEY);
      if (v === '1' && mounted) setAllowCreateOnce(true);
    })();

    return () => {
      mounted = false;
      if (typeof (sub as any).remove === 'function') sub.remove();
    };
  }, [userId]);

  // Clean bypass
  useEffect(() => {
    (async () => {
      if (isPaid && allowCreateOnce) {
        setAllowCreateOnce(false);
        await AsyncStorage.removeItem(STRIPE_OK_KEY);
      }
    })();
  }, [isPaid, allowCreateOnce]);

  // Mark paid after profile completion
  useEffect(() => {
    (async () => {
      if (userId && profileComplete && (allowCreateOnce || !isPaid) && !paidLocalOk) {
        await AsyncStorage.setItem(localPaidKey(userId), '1');
        setPaidLocalOk(true);
      }
    })();
  }, [userId, profileComplete, allowCreateOnce, isPaid, paidLocalOk]);

  // Logout cleanup
  useEffect(() => {
    (async () => {
      if (!userId) {
        setAllowCreateOnce(false);
        setPaidLocalOk(false);
        await AsyncStorage.removeItem(STRIPE_OK_KEY);
      }
    })();
  }, [userId]);

  // Restore navigation state
  useEffect(() => {
    let mounted = true;

    const restore = async () => {
      if (!ready) return;

      if (!userId || !profileComplete) {
        setInitialState(undefined);
        setNavStateReady(true);
        return;
      }

      try {
        const initialUrl = await RNLinking.getInitialURL();
        let isDeepLink = false;

        if (initialUrl) {
          try {
            const parsed = rnGetStateFromPath(initialUrl, (linking as any).config);
            isDeepLink = !!parsed;
          } catch {}
        }

        if (!isDeepLink) {
          const saved = await AsyncStorage.getItem(navKeyFor(userId));
          if (saved && mounted) {
            try {
              setInitialState(JSON.parse(saved));
            } catch {}
          }
        }
      } finally {
        if (mounted) setNavStateReady(true);
      }
    };

    restore();

    return () => {
      mounted = false;
    };
  }, [ready, userId, profileComplete]);

  // Subscription watcher
  useEffect(() => {
    let mounted = true;

    (async () => {
      if (!userId) {
        setIsPaid(null);
        setExpired(false);
        setAccessExpiresAt(null);
        return;
      }

      const { data, error } = await supabase
        .from('users')
        .select('subscription_status, grandfathered, premium_access_expires_at')
        .eq('id', userId)
        .single();

      if (!mounted) return;

      if (error) {
        setIsPaid(false);
        setExpired(false);
        setAccessExpiresAt(null);
        return;
      }

      const now = Date.now();
      const exp = data.premium_access_expires_at
        ? new Date(data.premium_access_expires_at).getTime()
        : null;

      const expired = exp ? exp <= now : false;
      const status = (data.subscription_status || '').toLowerCase();
      const isPaid =
        !expired &&
        (status === 'active' ||
          status === 'trialing' ||
          status === 'past_due' ||
          data.grandfathered);

      setIsPaid(isPaid);
      setExpired(expired);
      setAccessExpiresAt(data.premium_access_expires_at ?? null);

      const channel = supabase
        .channel('user-subscription-nav')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'users',
            filter: `id=eq.${userId}`
          },
          (payload) => {
            const newExp = payload.new.premium_access_expires_at
              ? new Date(payload.new.premium_access_expires_at).getTime()
              : null;

            const newExpired = newExp ? newExp <= Date.now() : false;
            const newStatus = (payload.new.subscription_status || '').toLowerCase();
            const newPaid =
              !newExpired &&
              (newStatus === 'active' ||
                newStatus === 'trialing' ||
                newStatus === 'past_due' ||
                payload.new.grandfathered);

            setIsPaid(newPaid);
            setExpired(newExpired);
            setAccessExpiresAt(payload.new.premium_access_expires_at ?? null);
          }
        )
        .subscribe();

      return () => supabase.removeChannel(channel);
    })();

    return () => {
      mounted = false;
    };
  }, [userId]);

  // Auto signout on expiration
  useEffect(() => {
    (async () => {
      if (userId && expired) {
        try {
          await supabase.auth.signOut();
        } catch {}
      }
    })();
  }, [userId, expired]);

  // Mark navigator destroyed
  useEffect(() => {
    return () => setNavigatorReady(false);
  }, []);

  // Loading UI
  if (!ready || !navStateReady || (userId && isPaid === null)) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: COLORS.background
        }}
      >
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  // Paywall off
  const allowedNow = true;
  const mustShowPaywall = false;

  /**
   * FINAL NAVIGATION
   */
  return (
    <NavigationContainer
  ref={(nav) => {
    // Typescript complains, but this is exactly how React Navigation expects it
    // @ts-expect-error overriding ref current safely
    navigationRef.current = nav;
  }}
      linking={linking}
      initialState={initialState}
      onReady={() => {
        setNavigatorReady(true);
      }}
    >
      {/* NOT LOGGED IN */}
      {!userId ? (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Auth">
            {() => <AuthStack initialRouteName={initialAuthRouteName} />}
          </Stack.Screen>

          <Stack.Screen name="NewPassword" component={NewPassword} />
        </Stack.Navigator>
      ) : mustShowPaywall ? (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Paywall" component={PaywallScreen} />
          <Stack.Screen name="PaySuccess" component={PaySuccessScreen} />
        </Stack.Navigator>
      ) : !profileComplete ? (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Auth">
            {() => <AuthStack initialRouteName="CreateProfile" />}
          </Stack.Screen>
        </Stack.Navigator>
      ) : (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="MainTabs" component={MainTabs} />
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
}
