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
import { useFocusEffect, useIsFocused, useNavigation, CommonActions } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import COLORS from '../theme/colors';

const PAYMENT_LINK =
  (process.env.EXPO_PUBLIC_STRIPE_PAYMENT_LINK as string | undefined) || '';

function isActive(status?: string | null, currentPeriodEnd?: string | null) {
  if (!status) return false;
  const ok = status === 'active' || status === 'trialing' || status === 'past_due';
  if (!ok) return false;
  if (!currentPeriodEnd) return true;
  return new Date(currentPeriodEnd).getTime() > Date.now() - 5_000;
}

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
      const url =
        user?.email && PAYMENT_LINK.indexOf('prefilled_email=') === -1
          ? `${PAYMENT_LINK}${PAYMENT_LINK.includes('?') ? '&' : '?'}prefilled_email=${encodeURIComponent(
              user.email
            )}`
          : PAYMENT_LINK;

      if (Platform.OS === 'web') {
        (window as any).location.assign(url);
      } else {
        await WebBrowser.openBrowserAsync(url);
      }
    } catch (e: any) {
      console.error('checkout redirect error', e);
      setMessage(e?.message || 'Could not open checkout.');
    } finally {
      setSubmitting(false);
    }
  };

  // Check status -> go to CreateProfile (only if focused & not exited)
  const checkStatusAndMaybeEnter = useCallback(async () => {
    if (!isFocused || hasExited.current) return;
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return;

      const { data, error } = await supabase
        .from('users')
        .select('subscription_status,current_period_end')
        .eq('id', uid)
        .maybeSingle();

      if (error) throw error;

      if (isActive(data?.subscription_status, data?.current_period_end)) {
        if (!isFocused || hasExited.current) return;
        nav.reset({ index: 0, routes: [{ name: 'CreateProfile' }] });
      }
    } catch (e) {
      console.warn('status check failed', e);
    }
  }, [isFocused, nav]);

  // Auto-poll only while focused
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

  // Back: stop poll, mark exit, sign out, and HARD-redirect to /signin on web
  const handleBack = useCallback(async () => {
    hasExited.current = true;
    clearPoll();

    try {
      await supabase.auth.signOut();
    } catch {}

    if (Platform.OS === 'web') {
      // Build your deep link to the SignIn route and replace the URL,
      // so any lingering /pay/success or other link is wiped from history.
      const signInUrl = Linking.createURL('signin');
      window.location.replace(signInUrl); // 🔒 hard replace prevents rehydration jumps
      return;
    }

    // Native: reset stack to Auth -> SignIn
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
        <Text style={styles.h1}>Join OverLooked for Free</Text>

        <TouchableOpacity
          onPress={openCheckout}
          style={[styles.btn, submitting && styles.btnDisabled]}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>Join for Free</Text>
          )}
        </TouchableOpacity>

        {!!message && <Text style={styles.smallNote}>{message}</Text>}

        <TouchableOpacity style={styles.backLink} onPress={handleBack}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background, padding: 16 },
  card: { width: '100%', maxWidth: 520, backgroundColor: '#fff', borderRadius: 16, padding: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border, alignItems: 'center' },
  h1: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary, textAlign: 'center', marginBottom: 20 },
  btn: { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 24, alignItems: 'center', minWidth: 180 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  smallNote: { marginTop: 12, fontSize: 13, color: COLORS.textSecondary, textAlign: 'center' },
  backLink: { marginTop: 20, alignItems: 'center' },
  backText: { color: COLORS.primary, fontWeight: '700', fontSize: 15 },
});
