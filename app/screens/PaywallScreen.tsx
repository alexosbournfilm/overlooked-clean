// screens/PaywallScreen.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import {
  useFocusEffect,
  useIsFocused,
  useNavigation,
  CommonActions,
} from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { invalidateMembershipCache } from '../lib/membership';

const PAYMENT_LINK =
  (process.env.EXPO_PUBLIC_STRIPE_PAYMENT_LINK as string | undefined) || '';

function isActive(status?: string | null, currentPeriodEnd?: string | null) {
  if (!status) return false;
  const ok = status === 'active' || status === 'trialing' || status === 'past_due';
  if (!ok) return false;
  if (!currentPeriodEnd) return true;
  return new Date(currentPeriodEnd).getTime() > Date.now() - 5_000;
}

/* -------------------------- match UpgradeModal UI -------------------------- */

const DARK_ELEVATED = '#171717';
const TEXT_IVORY = '#EDEBE6';
const TEXT_MUTED = '#A7A6A2';
const DIVIDER = '#2A2A2A';
const GOLD = '#C6A664';

const SYSTEM_SANS = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: undefined,
  default: undefined,
});

export default function PaywallScreen() {
  const nav = useNavigation<any>();
  const isFocused = useIsFocused();

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasExited = useRef(false);

  const clearPoll = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  // Disable native back gesture & header back while on paywall
  useFocusEffect(
    useCallback(() => {
      const parent = nav.getParent?.();
      parent?.setOptions({ gestureEnabled: false, headerBackVisible: false });
      return () => {
        parent?.setOptions({ gestureEnabled: true, headerBackVisible: true });
      };
    }, [nav])
  );

  // Stripe checkout
  const openCheckout = async () => {
    setSubmitting(true);
    setMessage(null);

    try {
      await supabase.auth.getUser(); // keep session warm

      if (!PAYMENT_LINK) {
        setMessage('Checkout is not configured. Missing EXPO_PUBLIC_STRIPE_PAYMENT_LINK.');
        return;
      }

      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;

      // Prefill email for better conversions
      const url =
        user?.email && PAYMENT_LINK.indexOf('prefilled_email=') === -1
          ? `${PAYMENT_LINK}${PAYMENT_LINK.includes('?') ? '&' : '?'}prefilled_email=${encodeURIComponent(
              user.email
            )}`
          : PAYMENT_LINK;

      if (Platform.OS === 'web') {
        (window as any).location.assign(url);
      } else {
        // On native: open Stripe in browser. The app will re-focus afterwards.
        await WebBrowser.openBrowserAsync(url);
      }
    } catch (e: any) {
      console.error('checkout redirect error', e);
      setMessage(e?.message || 'Could not open checkout.');
    } finally {
      setSubmitting(false);
    }
  };

  // ✅ When Pro becomes active, reset correctly into Auth -> CreateProfile.
  // (CreateProfile is inside AuthStack, so navigating to it directly can fail.)
  const enterCreateProfile = useCallback(() => {
    nav.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [
          {
            name: 'Auth',
            state: { routes: [{ name: 'CreateProfile' }] },
          },
        ],
      })
    );
  }, [nav]);

  // Check status -> go to CreateProfile (only if focused & not exited)
  const checkStatusAndMaybeEnter = useCallback(async () => {
    if (!isFocused || hasExited.current) return;

    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return;

      const { data, error } = await supabase
        .from('users')
        .select('tier, subscription_status, current_period_end')
        .eq('id', uid)
        .maybeSingle();

      if (error) throw error;

      const proByTier = data?.tier === 'pro';
      const proByStatus = isActive(data?.subscription_status, data?.current_period_end);

      if (proByTier || proByStatus) {
        if (!isFocused || hasExited.current) return;

        // ✅ make every screen re-check tier immediately
        invalidateMembershipCache();

        // ✅ correct reset path
        enterCreateProfile();
      }
    } catch (e) {
      console.warn('status check failed', e);
    }
  }, [isFocused, enterCreateProfile]);

  // Auto-poll only while focused (gives Stripe webhook time to update DB)
  useEffect(() => {
    if (!isFocused || hasExited.current) {
      clearPoll();
      return;
    }

    let tries = 0;

    const poll = async () => {
      if (!isFocused || hasExited.current) return;
      tries += 1;

      await checkStatusAndMaybeEnter();

      if (isFocused && !hasExited.current && tries < 20) {
        pollTimerRef.current = setTimeout(poll, 2000);
      }
    };

    poll();
    return () => clearPoll();
  }, [isFocused, checkStatusAndMaybeEnter]);

  // ✅ "Maybe later" should NOT sign users out.
  // It should safely take them back to wherever they came from (UpgradeModal),
  // or fall back to SignIn if there is no back stack.
  const handleBack = useCallback(() => {
    hasExited.current = true;
    clearPoll();

    try {
      if (nav.canGoBack?.()) {
        nav.goBack();
        return;
      }
    } catch {}

    // Fallback: go to SignIn (do NOT sign out here)
    if (Platform.OS === 'web') {
      const signInUrl = Linking.createURL('signin');
      window.location.replace(signInUrl);
      return;
    }

    nav.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Auth', state: { routes: [{ name: 'SignIn' }] } }],
      })
    );
  }, [nav]);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.kicker}>UPGRADE</Text>
        <Text style={styles.title}>Upgrade to Pro</Text>
        <Text style={styles.subtitle}>
          Submit to challenges, apply for paid jobs, and unlock Workshop tools.
        </Text>

        <TouchableOpacity
          onPress={openCheckout}
          style={[styles.buttonBase, styles.proButton, submitting && styles.buttonDisabled]}
          disabled={submitting}
          activeOpacity={submitting ? 1 : 0.9}
        >
          {submitting ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <ActivityIndicator color="#0B0B0B" />
              <Text style={styles.buttonText}>Opening checkout…</Text>
            </View>
          ) : (
            <Text style={styles.buttonText}>Upgrade to Pro</Text>
          )}
        </TouchableOpacity>

        <View style={styles.divider} />

        <View style={styles.benefits}>
          <Text style={styles.benefitItem}>✓ 2 challenge submissions / month</Text>
          <Text style={styles.benefitItem}>✓ Apply for all paid jobs</Text>
          <Text style={styles.benefitItem}>✓ Full access to all workshop products & releases</Text>
        </View>

        {!!message && <Text style={styles.errorText}>{message}</Text>}

        <TouchableOpacity
          style={styles.backLink}
          onPress={handleBack}
          disabled={submitting}
          activeOpacity={0.85}
        >
          <Text style={styles.backText}>Maybe later</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.85)', // match UpgradeModal backdrop
  },

  card: {
    width: '100%',
    maxWidth: 560,
    borderRadius: 24,
    paddingVertical: 22,
    paddingHorizontal: 20,
    backgroundColor: DARK_ELEVATED,
    borderWidth: 1,
    borderColor: DIVIDER,
  },

  kicker: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.8,
    color: GOLD,
    textTransform: 'uppercase',
    marginBottom: 6,
    fontFamily: SYSTEM_SANS,
  },

  title: {
    fontSize: 22,
    fontWeight: '900',
    color: TEXT_IVORY,
    marginBottom: 6,
    fontFamily: SYSTEM_SANS,
  },

  subtitle: {
    fontSize: 13,
    color: TEXT_MUTED,
    marginBottom: 14,
    maxWidth: 520,
    lineHeight: 18,
    fontFamily: SYSTEM_SANS,
  },

  buttonBase: {
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },

  proButton: {
    backgroundColor: GOLD,
  },

  buttonDisabled: {
    opacity: 0.75,
  },

  buttonText: {
    color: '#0B0B0B',
    textAlign: 'center',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.4,
    fontFamily: SYSTEM_SANS,
  },

  divider: {
    height: 1,
    backgroundColor: '#262626',
    marginVertical: 14,
  },

  benefits: {
    gap: 6,
  },

  benefitItem: {
    fontSize: 12.5,
    lineHeight: 18,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },

  errorText: {
    fontSize: 12,
    color: '#FFB3B3',
    marginTop: 12,
    fontFamily: SYSTEM_SANS,
  },

  backLink: {
    marginTop: 14,
    paddingVertical: 6,
    alignItems: 'center',
  },

  backText: {
    color: TEXT_MUTED,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: SYSTEM_SANS,
  },
});
