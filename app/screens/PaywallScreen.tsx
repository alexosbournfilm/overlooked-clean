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

/* ----------------------------- Stripe pay links ---------------------------- */
/** ✅ Wired to the links you provided */
const PAYMENT_LINK_LIFETIME = 'https://buy.stripe.com/8x27sLaAY67d5gi5YH1sQ03';
const PAYMENT_LINK_YEARLY = 'https://buy.stripe.com/3cI7sL10ofHN7oq0En1sQ02';
const PAYMENT_LINK_MONTHLY = 'https://buy.stripe.com/6oUeVd5gE0MTbEG72L1sQ01';

function isActive(status?: string | null, currentPeriodEnd?: string | null) {
  if (!status) return false;
  const ok = status === 'active' || status === 'trialing' || status === 'past_due';
  if (!ok) return false;
  if (!currentPeriodEnd) return true;
  return new Date(currentPeriodEnd).getTime() > Date.now() - 5_000;
}

/* -------------------------- match UpgradeModal UI -------------------------- */

const DARK_ELEVATED = '#171717';
const SURFACE = '#121212';
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

type PlanKey = 'lifetime' | 'yearly' | 'monthly';

export default function PaywallScreen() {
  const nav = useNavigation<any>();
  const isFocused = useIsFocused();

  const [submittingPlan, setSubmittingPlan] = useState<PlanKey | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<PlanKey>('lifetime');
  const [message, setMessage] = useState<string | null>(null);

  const [offerCountdown, setOfferCountdown] = useState(() => getOfferRemaining());

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasExited = useRef(false);

  const clearPoll = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  // keep countdown updated while on screen
  useEffect(() => {
    if (!isFocused || hasExited.current) return;

    const tick = () => setOfferCountdown(getOfferRemaining());
    tick();

    const id = setInterval(tick, 60 * 1000);
    return () => clearInterval(id);
  }, [isFocused]);

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

  const getPaymentLinkForPlan = (plan: PlanKey) => {
    if (plan === 'lifetime') return PAYMENT_LINK_LIFETIME;
    if (plan === 'yearly') return PAYMENT_LINK_YEARLY;
    return PAYMENT_LINK_MONTHLY;
  };

  // Stripe checkout (plan-aware)
  const openCheckout = async (plan: PlanKey) => {
    setSubmittingPlan(plan);
    setMessage(null);

    try {
      await supabase.auth.getUser(); // keep session warm

      const rawLink = getPaymentLinkForPlan(plan);
      if (!rawLink) {
        setMessage('Checkout is not configured for this plan.');
        return;
      }

      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;

      // Prefill email for better conversions
      const url =
        user?.email && rawLink.indexOf('prefilled_email=') === -1
          ? `${rawLink}${rawLink.includes('?') ? '&' : '?'}prefilled_email=${encodeURIComponent(
              user.email
            )}`
          : rawLink;

      if (Platform.OS === 'web') {
        (window as any).location.assign(url);
      } else {
        await WebBrowser.openBrowserAsync(url);
      }
    } catch (e: any) {
      console.error('checkout redirect error', e);
      setMessage(e?.message || 'Could not open checkout.');
    } finally {
      setSubmittingPlan(null);
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

        invalidateMembershipCache();
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
  const handleBack = useCallback(() => {
    hasExited.current = true;
    clearPoll();

    try {
      if (nav.canGoBack?.()) {
        nav.goBack();
        return;
      }
    } catch {}

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

  const anySubmitting = !!submittingPlan;

  const planTitle =
    selectedPlan === 'lifetime'
      ? '£25 Lifetime'
      : selectedPlan === 'yearly'
        ? '£49.99 / year'
        : '£4.99 / month';

  const ctaText =
    submittingPlan
      ? 'Opening checkout…'
      : selectedPlan === 'lifetime'
        ? 'Get Lifetime'
        : selectedPlan === 'yearly'
          ? 'Choose Yearly'
          : 'Choose Monthly';

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.kicker}>UPGRADE</Text>
        <Text style={styles.title}>Upgrade to Pro</Text>
        <Text style={styles.subtitle}>
          Submit to challenges, apply for paid jobs, and unlock Workshop tools.
        </Text>

        {/* Offer strip */}
        <View style={styles.offerStrip}>
          <View style={styles.offerStripLeft}>
            <Text style={styles.offerStripKicker}>NEW YEAR’S OFFER</Text>
            <Text style={styles.offerStripTitle}>£25 Lifetime</Text>
          </View>

          <View style={styles.offerStripRight}>
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
                selectedPlan === 'lifetime' && styles.planSelected,
              ]}
            >
              <Text style={[styles.planKicker, styles.planKickerHero]}>LIFETIME</Text>
              <View style={styles.planPriceRow}>
                <Text style={styles.planCurrency}>£</Text>
                <Text style={styles.planPriceHero}>25</Text>
              </View>
              <Text style={styles.planSubHero}>
                {offerCountdown.expired ? 'Offer ended' : 'Ends Jan 25'}
              </Text>
            </TouchableOpacity>

            {/* Yearly */}
            <TouchableOpacity
              activeOpacity={0.92}
              onPress={() => setSelectedPlan('yearly')}
              style={[
                styles.planTile,
                styles.planTileSecondary,
                selectedPlan === 'yearly' && styles.planSelectedSecondary,
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
                selectedPlan === 'monthly' && styles.planSelectedSecondary,
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
          onPress={() => openCheckout(selectedPlan)}
          style={[styles.buttonBase, styles.proButton, anySubmitting && styles.buttonDisabled]}
          disabled={anySubmitting}
          activeOpacity={anySubmitting ? 1 : 0.9}
        >
          {anySubmitting ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <ActivityIndicator color="#0B0B0B" />
              <Text style={styles.buttonText}>Opening checkout…</Text>
            </View>
          ) : (
            <Text style={styles.buttonText}>{ctaText}</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.ctaMicro}>
          Selected: <Text style={{ color: GOLD, fontWeight: '900' }}>{planTitle}</Text>
        </Text>

        <View style={styles.divider} />

        <View style={styles.benefits}>
          <Text style={styles.benefitItem}>✓ Submit to the Monthly Film Challenge</Text>
          <Text style={styles.benefitItem}>✓ Apply for all paid jobs</Text>
          <Text style={styles.benefitItem}>✓ Full access to all workshop products & releases</Text>
        </View>

        {!!message && <Text style={styles.errorText}>{message}</Text>}

        <TouchableOpacity
          style={styles.backLink}
          onPress={handleBack}
          disabled={anySubmitting}
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
    maxWidth: 720,
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
    maxWidth: 640,
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
    marginBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },

  offerStripLeft: {
    flex: 1,
    minWidth: 140,
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

  offerStripRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
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
    borderRadius: 18,
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.02)',
    marginBottom: 12,
  },

  planRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },

  planTile: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: HAIRLINE_2,
  },

  planTileHero: {
    backgroundColor: OFFER_TILE_BG,
    borderColor: OFFER_TILE_BORDER,
  },

  planTileSecondary: {
    backgroundColor: 'rgba(255,255,255,0.025)',
    borderColor: 'rgba(255,255,255,0.08)',
  },

  planSelected: {
    borderColor: 'rgba(46,212,122,0.55)',
  },

  planSelectedSecondary: {
    borderColor: 'rgba(198,166,100,0.40)',
  },

  planKicker: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: TEXT_MUTED_2,
    fontFamily: SYSTEM_SANS,
    marginBottom: 6,
  },

  planKickerHero: {
    color: 'rgba(46,212,122,0.95)',
  },

  planPriceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
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

  ctaMicro: {
    marginTop: 8,
    textAlign: 'center',
    fontSize: 11.5,
    color: 'rgba(237,235,230,0.55)',
    fontFamily: SYSTEM_SANS,
  },

  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 14,
  },

  benefits: {
    gap: 6,
  },

  benefitItem: {
    fontSize: 12.5,
    lineHeight: 18,
    color: 'rgba(237,235,230,0.58)',
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
    color: 'rgba(237,235,230,0.60)',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: SYSTEM_SANS,
  },
});
