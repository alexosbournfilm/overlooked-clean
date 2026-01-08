// screens/PaywallScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

/* -------------------------- Stripe Payment Links -------------------------- */
/**
 * Your three Stripe payment links:
 * 1) Lifetime (£25)
 * 2) Yearly (£49.99)
 * 3) Monthly (£4.99)
 */
const STRIPE_LINK_LIFETIME = 'https://buy.stripe.com/8x27sLaAY67d5gi5YH1sQ03';
const STRIPE_LINK_YEARLY = 'https://buy.stripe.com/3cI7sL10ofHN7oq0En1sQ02';
const STRIPE_LINK_MONTHLY = 'https://buy.stripe.com/6oUeVd5gE0MTbEG72L1sQ01';

type PlanKey = 'lifetime' | 'yearly' | 'monthly';

function isActive(status?: string | null, currentPeriodEnd?: string | null) {
  if (!status) return false;
  const ok = status === 'active' || status === 'trialing' || status === 'past_due';
  if (!ok) return false;
  if (!currentPeriodEnd) return true;
  return new Date(currentPeriodEnd).getTime() > Date.now() - 5_000;
}

/* -------------------------- match UpgradeModal UI -------------------------- */

const DARK_ELEVATED = '#171717';
const SURFACE_2 = '#0F0F0F';

const TEXT_IVORY = '#EDEBE6';
const TEXT_MUTED = 'rgba(237,235,230,0.60)';
const TEXT_MUTED_2 = 'rgba(237,235,230,0.42)';

const HAIRLINE = 'rgba(255,255,255,0.09)';
const HAIRLINE_2 = 'rgba(255,255,255,0.06)';

const GOLD = '#C6A664';

const OFFER_ACCENT = '#2ED47A';
const OFFER_STRIP_BG = 'rgba(46,212,122,0.10)';
const OFFER_STRIP_BORDER = 'rgba(46,212,122,0.18)';
const OFFER_TILE_BG = 'rgba(46,212,122,0.12)';
const OFFER_TILE_BORDER = 'rgba(46,212,122,0.22)';

const SYSTEM_SANS = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: undefined,
  default: undefined,
});

// Countdown to Jan 25, 2026 (end of day local time)
function getOfferRemaining() {
  const end = new Date(2026, 0, 25, 23, 59, 59);
  const now = new Date();
  const ms = end.getTime() - now.getTime();

  if (ms <= 0) {
    return { expired: true, short: 'Offer ended', long: 'Offer ended' };
  }

  const totalMinutes = Math.floor(ms / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);

  const short = days > 0 ? `${days}d ${hours}h left` : `${hours}h left`;
  const long = `Ends Jan 25 • ${short}`;

  return { expired: false, short, long };
}

export default function PaywallScreen() {
  const nav = useNavigation<any>();
  const isFocused = useIsFocused();

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [selectedPlan, setSelectedPlan] = useState<PlanKey>('monthly');
  const [offerCountdown, setOfferCountdown] = useState(() => getOfferRemaining());

  // prevents "flash" by not rendering until we confirm user isn't already Pro
  const [gateChecking, setGateChecking] = useState(true);

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasExited = useRef(false);

  const clearPoll = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  useEffect(() => {
    const tick = () => setOfferCountdown(getOfferRemaining());
    tick();
    const id = setInterval(tick, 60 * 1000);
    return () => clearInterval(id);
  }, []);

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

  const planLabel = useMemo(() => {
    if (selectedPlan === 'lifetime') return 'Choose Lifetime';
    if (selectedPlan === 'yearly') return 'Choose Yearly';
    return 'Choose Monthly';
  }, [selectedPlan]);

  const selectedSubLabel = useMemo(() => {
    if (selectedPlan === 'lifetime') return 'Selected: £25 lifetime';
    if (selectedPlan === 'yearly') return 'Selected: £49.99 / year';
    return 'Selected: £4.99 / month';
  }, [selectedPlan]);

  const selectedPaymentLink = useMemo(() => {
    if (selectedPlan === 'lifetime') return STRIPE_LINK_LIFETIME;
    if (selectedPlan === 'yearly') return STRIPE_LINK_YEARLY;
    return STRIPE_LINK_MONTHLY;
  }, [selectedPlan]);

  const enterFeatured = useCallback(() => {
    // Use your existing main tabs structure; this is the safest "land in app" path.
    nav.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      })
    );
  }, [nav]);

  // If user is already pro, don't show paywall at all (prevents sign-in flash)
  const fastGate = useCallback(async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) {
        setGateChecking(false);
        return;
      }

      const { data, error } = await supabase
        .from('users')
        .select('tier, subscription_status, current_period_end')
        .eq('id', uid)
        .maybeSingle();

      if (!error) {
        const proByTier = data?.tier === 'pro';
        const proByStatus = isActive(data?.subscription_status, data?.current_period_end);
        if (proByTier || proByStatus) {
          invalidateMembershipCache();
          enterFeatured();
          return;
        }
      }
    } catch {
      // ignore
    } finally {
      setGateChecking(false);
    }
  }, [enterFeatured]);

  useEffect(() => {
    if (!isFocused) return;
    hasExited.current = false;
    setGateChecking(true);
    fastGate();
  }, [isFocused, fastGate]);

  // Stripe checkout
  const openCheckout = async () => {
    setSubmitting(true);
    setMessage(null);

    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;

      const user = auth?.user;
      if (!user?.id) {
        setMessage('Not signed in.');
        return;
      }

      const base = selectedPaymentLink;
      if (!base) {
        setMessage('Checkout is not configured.');
        return;
      }

      /**
       * ✅ CRITICAL FIX:
       * Pass client_reference_id so webhook can match the user deterministically.
       * Also pass prefilled_email for Stripe UX.
       *
       * Your webhook already supports:
       * - s.client_reference_id
       * - customer_details.email / customer_email
       */
      const url =
        base +
        (base.includes('?') ? '&' : '?') +
        `client_reference_id=${encodeURIComponent(user.id)}` +
        (user.email ? `&prefilled_email=${encodeURIComponent(user.email)}` : '');

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

  // Check status -> enter app (only if focused & not exited)
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

        invalidateMembershipCache();
        enterFeatured();
      }
    } catch (e) {
      console.warn('status check failed', e);
    }
  }, [isFocused, enterFeatured]);

  // Auto-poll only while focused (gives webhook time to update DB)
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

      if (isFocused && !hasExited.current && tries < 25) {
        pollTimerRef.current = setTimeout(poll, 2000);
      }
    };

    poll();
    return () => clearPoll();
  }, [isFocused, checkStatusAndMaybeEnter]);

  // "Maybe later" back
  const handleBack = useCallback(() => {
    hasExited.current = true;
    clearPoll();

    try {
      if (nav.canGoBack?.()) {
        nav.goBack();
        return;
      }
    } catch {}

    // Fallback: go to SignIn (do NOT sign out)
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

  if (gateChecking) {
    // Prevents any “flash” while we quickly check if already Pro
    return (
      <View style={styles.container}>
        <View style={[styles.card, { alignItems: 'center' }]}>
          <ActivityIndicator color={GOLD} />
          <Text style={{ marginTop: 10, color: TEXT_MUTED, fontFamily: SYSTEM_SANS }}>
            Loading…
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.kicker}>UPGRADE</Text>
        <Text style={styles.title}>Upgrade to Pro</Text>
        <Text style={styles.subtitle}>
          Submit films to the Monthly Film Challenge, apply for paid jobs, and unlock Workshop tools.
        </Text>

        {/* Offer strip */}
        <View style={styles.offerStrip}>
          <View style={{ flex: 1, minWidth: 160 }}>
            <Text style={styles.offerStripKicker}>NEW YEAR’S OFFER</Text>
            <Text style={styles.offerStripTitle}>£25 Lifetime</Text>
          </View>

          <View style={{ alignItems: 'flex-end', justifyContent: 'center', gap: 6 }}>
            <View style={styles.offerDot} />
            <Text style={styles.offerStripMeta}>
              {offerCountdown.expired ? 'Offer ended' : offerCountdown.long}
            </Text>
          </View>
        </View>

        {/* Plan tiles */}
        <View style={styles.plansArea}>
          <View style={styles.planRow}>
            {/* Lifetime */}
            <TouchableOpacity
              activeOpacity={0.92}
              onPress={() => setSelectedPlan('lifetime')}
              style={[
                styles.planTile,
                styles.planTileHero,
                selectedPlan === 'lifetime' ? styles.tileSelected : null,
              ]}
            >
              <Text style={[styles.planKicker, styles.planKickerHero]}>LIFETIME</Text>
              <View style={styles.planPriceRow}>
                <Text style={styles.planCurrency}>£</Text>
                <Text style={styles.planPriceHero}>25</Text>
              </View>
              <Text style={styles.planSubHero}>{offerCountdown.expired ? 'Offer ended' : 'Ends Jan 25'}</Text>
            </TouchableOpacity>

            {/* Yearly */}
            <TouchableOpacity
              activeOpacity={0.92}
              onPress={() => setSelectedPlan('yearly')}
              style={[
                styles.planTile,
                styles.planTileSecondary,
                selectedPlan === 'yearly' ? styles.tileSelected : null,
              ]}
            >
              <Text style={styles.planKicker}>YEARLY</Text>
              <View style={styles.planPriceRow}>
                <Text style={styles.planCurrency}>£</Text>
                <Text style={styles.planPrice}>49.99</Text>
              </View>
              <Text style={styles.planSub}>Cancel anytime</Text>
            </TouchableOpacity>

            {/* Monthly */}
            <TouchableOpacity
              activeOpacity={0.92}
              onPress={() => setSelectedPlan('monthly')}
              style={[
                styles.planTile,
                styles.planTileSecondary,
                selectedPlan === 'monthly' ? styles.tileSelected : null,
              ]}
            >
              <Text style={styles.planKicker}>MONTHLY</Text>
              <View style={styles.planPriceRow}>
                <Text style={styles.planCurrency}>£</Text>
                <Text style={styles.planPrice}>4.99</Text>
              </View>
              <Text style={styles.planSub}>Cancel anytime</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* CTA */}
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
            <Text style={styles.buttonText}>{planLabel}</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.selectedText}>{selectedSubLabel}</Text>

        <View style={styles.divider} />

        {/* Benefits (updated per your note) */}
        <View style={styles.benefits}>
          <Text style={styles.benefitItem}>✓ Submit films to the Monthly Film Challenge</Text>
          <Text style={styles.benefitItem}>✓ Apply for all paid jobs</Text>
          <Text style={styles.benefitItem}>✓ Full access to Workshop tools & downloads</Text>
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
    backgroundColor: 'rgba(0,0,0,0.85)',
  },

  card: {
    width: '100%',
    maxWidth: 920,
    borderRadius: 24,
    paddingVertical: 22,
    paddingHorizontal: 20,
    backgroundColor: DARK_ELEVATED,
    borderWidth: 1,
    borderColor: HAIRLINE,
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
    maxWidth: 720,
    lineHeight: 18,
    fontFamily: SYSTEM_SANS,
  },

  offerStrip: {
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: OFFER_STRIP_BG,
    borderWidth: 1,
    borderColor: OFFER_STRIP_BORDER,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },

  offerStripKicker: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: 'rgba(237,235,230,0.82)',
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
    marginBottom: 2,
  },

  offerStripTitle: {
    fontSize: 14.5,
    fontWeight: '900',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },

  offerDot: {
    width: 7,
    height: 7,
    borderRadius: 99,
    backgroundColor: OFFER_ACCENT,
    opacity: 0.95,
  },

  offerStripMeta: {
    fontSize: 11.5,
    color: 'rgba(237,235,230,0.72)',
    fontFamily: SYSTEM_SANS,
  },

  plansArea: {
    marginTop: 6,
    borderRadius: 18,
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },

  planRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    flexWrap: 'wrap',
  },

  planTile: {
    flex: 1,
    minWidth: 200,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'transparent',
  },

  planTileHero: {
    backgroundColor: OFFER_TILE_BG,
    borderColor: OFFER_TILE_BORDER,
  },

  planTileSecondary: {
    backgroundColor: 'rgba(255,255,255,0.025)',
    borderColor: 'rgba(255,255,255,0.06)',
  },

  tileSelected: {
    borderColor: 'rgba(198,166,100,0.42)',
  },

  planKicker: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: TEXT_MUTED_2,
    fontFamily: SYSTEM_SANS,
  },

  planKickerHero: {
    color: 'rgba(46,212,122,0.95)',
  },

  planPriceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 4,
  },

  planCurrency: {
    fontSize: 13,
    fontWeight: '900',
    color: TEXT_IVORY,
    marginRight: 2,
    marginBottom: 3,
    fontFamily: SYSTEM_SANS,
  },

  planPrice: {
    fontSize: 20,
    fontWeight: '900',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },

  planPriceHero: {
    fontSize: 22,
    fontWeight: '900',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },

  planSub: {
    marginTop: 6,
    fontSize: 11,
    color: TEXT_MUTED_2,
    fontFamily: SYSTEM_SANS,
  },

  planSubHero: {
    marginTop: 6,
    fontSize: 11,
    color: 'rgba(237,235,230,0.74)',
    fontFamily: SYSTEM_SANS,
  },

  buttonBase: {
    marginTop: 14,
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
    fontWeight: '900',
    fontSize: 15,
    letterSpacing: 0.4,
    fontFamily: SYSTEM_SANS,
  },

  selectedText: {
    marginTop: 10,
    textAlign: 'center',
    fontSize: 12,
    color: 'rgba(237,235,230,0.60)',
    fontFamily: SYSTEM_SANS,
  },

  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: 14,
  },

  benefits: {
    gap: 6,
  },

  benefitItem: {
    fontSize: 12.5,
    lineHeight: 18,
    color: 'rgba(237,235,230,0.55)',
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
    color: 'rgba(237,235,230,0.55)',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: SYSTEM_SANS,
  },
});
