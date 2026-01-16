// screens/PaywallScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  AppState,
  AppStateStatus,
  ScrollView,
  SafeAreaView,
  useWindowDimensions,
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
import { FUNCTIONS_URL } from '../lib/supabase';
import { invalidateMembershipCache } from '../lib/membership';

/* -------------------------- Stripe Price IDs (authoritative) -------------------------- */
const STRIPE_PRICE_MONTHLY = 'price_1S1jLxIaba42c4jIsVBQneb0';
const STRIPE_PRICE_YEARLY = 'price_1SnJ7bIaba42c4jIyjgmASbH';
const STRIPE_PRICE_LIFETIME = 'price_1SnJ5vIaba42c4jIf8o7Ys6w';

type PlanKey = 'lifetime' | 'yearly' | 'monthly';

function isActive(status?: string | null, currentPeriodEnd?: string | null) {
  if (!status) return false;
  const ok = status === 'active' || status === 'trialing' || status === 'past_due';
  if (!ok) return false;
  if (!currentPeriodEnd) return true;
  return new Date(currentPeriodEnd).getTime() > Date.now() - 5_000;
}

function hasProAccess(row?: {
  tier?: string | null;
  subscription_status?: string | null;
  current_period_end?: string | null;
  premium_access_expires_at?: string | null;
}) {
  const proByTier = row?.tier === 'pro';
  const proByStatus = isActive(row?.subscription_status, row?.current_period_end);

  const expires = row?.premium_access_expires_at;
  const proByGrace =
    !!expires && new Date(expires).getTime() > Date.now() - 5_000;

  return proByTier || proByStatus || proByGrace;
}

function formatEndDate(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return null;
  }
}

/* -------------------------- match UpgradeModal UI -------------------------- */

const DARK_ELEVATED = '#171717';
const TEXT_IVORY = '#EDEBE6';
const TEXT_MUTED = 'rgba(237,235,230,0.60)';
const TEXT_MUTED_2 = 'rgba(237,235,230,0.42)';
const HAIRLINE = 'rgba(255,255,255,0.09)';
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
  const end = new Date(2026, 0, 31, 23, 59, 59); // Jan 31, 2026
  const now = new Date();
  const ms = end.getTime() - now.getTime();

  if (ms <= 0) {
    return { expired: true, short: 'Offer ended', long: 'Offer ended' };
  }

  const totalMinutes = Math.floor(ms / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);

  const short = days > 0 ? `${days}d ${hours}h left` : `${hours}h left`;
  const long = `Ends Jan 31 • ${short}`;

  return { expired: false, short, long };
}

function extractInvokeError(err: any): string {
  return (
    err?.message ||
    err?.context ||
    err?.details ||
    err?.error ||
    (typeof err === 'string' ? err : '') ||
    'Checkout session failed.'
  );
}

export default function PaywallScreen() {
  const nav = useNavigation<any>();
  const isFocused = useIsFocused();
  const { width, height } = useWindowDimensions();

  const isMobile = width < 520;
  const isTiny = width < 360;

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [selectedPlan, setSelectedPlan] = useState<PlanKey>('monthly');
  const [offerCountdown, setOfferCountdown] = useState(() => getOfferRemaining());

  // prevents "flash" by not rendering until we confirm user isn't already Pro
  const [gateChecking, setGateChecking] = useState(true);

  // NEW: if they’re already Pro or cancelled-but-still-Pro, show a friendly screen
  const [alreadyPro, setAlreadyPro] = useState(false);
  const [proEndsIso, setProEndsIso] = useState<string | null>(null);
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState<boolean>(false);

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
    if (selectedPlan === 'lifetime') return 'Selected: £24.99 lifetime';
    if (selectedPlan === 'yearly') return 'Selected: £49.99 / year';
    return 'Selected: £4.99 / month';
  }, [selectedPlan]);

  const selectedPlanPayload = useMemo(() => {
    if (selectedPlan === 'lifetime') {
      return { plan: 'lifetime' as const, priceId: STRIPE_PRICE_LIFETIME };
    }
    if (selectedPlan === 'yearly') {
      return { plan: 'yearly' as const, priceId: STRIPE_PRICE_YEARLY };
    }
    return { plan: 'monthly' as const, priceId: STRIPE_PRICE_MONTHLY };
  }, [selectedPlan]);

  const enterFeatured = useCallback(() => {
    nav.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      })
    );
  }, [nav]);

  const fetchBillingRow = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return null;

    const { data, error } = await supabase
      .from('users')
      .select('tier, subscription_status, current_period_end, premium_access_expires_at, cancel_at_period_end')
      .eq('id', uid)
      .maybeSingle();

    if (error) return null;

    setProEndsIso((data as any)?.premium_access_expires_at ?? null);
    setCancelAtPeriodEnd(Boolean((data as any)?.cancel_at_period_end));

    return data as any;
  }, []);

  // If user is already pro (or cancelled-but-still-pro), don't show paywall UI
  const fastGate = useCallback(async () => {
    try {
      const row = await fetchBillingRow();
      if (!row) {
        setAlreadyPro(false);
        return;
      }

      const pro = hasProAccess(row);
      if (pro) {
        invalidateMembershipCache();
        // Instead of instantly bouncing (which can feel jarring),
        // show a small "Already Pro" state with a button to enter.
        setAlreadyPro(true);
        return;
      }

      setAlreadyPro(false);
    } catch {
      // ignore
      setAlreadyPro(false);
    }
  }, [fetchBillingRow]);

  useEffect(() => {
    if (!isFocused) return;
    hasExited.current = false;
    setGateChecking(true);

    (async () => {
      await fastGate();
      setGateChecking(false);
    })();
  }, [isFocused, fastGate]);

  // ✅ Best path: supabase.functions.invoke (auto headers/auth handled)
  // ✅ Fallback path: direct fetch to FUNCTIONS_URL with access token
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

      if (!selectedPlanPayload?.priceId) {
        setMessage('Missing Stripe price id for this plan.');
        return;
      }

      const invokeRes = await supabase.functions.invoke('create-checkout-session', {
        body: {
          user_id: user.id,
          email: user.email ?? undefined,
          plan: selectedPlanPayload.plan,
          priceId: selectedPlanPayload.priceId,
        },
      });

      if (invokeRes.error) {
        const primaryMsg = extractInvokeError(invokeRes.error);
        console.warn('[paywall] invoke error:', invokeRes.error);

        if (typeof FUNCTIONS_URL === 'string' && FUNCTIONS_URL.length > 0) {
          try {
            const { data: sessionRes } = await supabase.auth.getSession();
            const token = sessionRes?.session?.access_token;

            const endpoint = `${FUNCTIONS_URL}/create-checkout-session`;

            const resp = await fetch(endpoint, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                ...(token ? { authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({
                user_id: user.id,
                email: user.email ?? undefined,
                plan: selectedPlanPayload.plan,
                priceId: selectedPlanPayload.priceId,
              }),
            });

            const json = await resp.json().catch(() => ({}));
            if (!resp.ok) {
              const msg =
                json?.error ||
                json?.message ||
                `Checkout session failed (HTTP ${resp.status}).`;
              throw new Error(msg);
            }

            const url = json?.url as string | undefined;
            if (!url) throw new Error('No checkout URL returned.');

            if (Platform.OS === 'web') {
              (window as any).location.assign(url);
            } else {
              await WebBrowser.openBrowserAsync(url);
            }
            return;
          } catch (fallbackErr: any) {
            console.warn('[paywall] fallback fetch error:', fallbackErr);
            throw new Error(
              `Checkout failed.\n\nPrimary: ${primaryMsg}\nFallback: ${fallbackErr?.message || 'Unknown error'}`
            );
          }
        }

        throw new Error(primaryMsg);
      }

      const url = (invokeRes.data as any)?.url as string | undefined;
      if (!url) throw new Error('No checkout URL returned.');

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
      const row = await fetchBillingRow();
      if (!row) return;

      const pro = hasProAccess(row);

      if (pro) {
        if (!isFocused || hasExited.current) return;
        invalidateMembershipCache();
        enterFeatured();
      }
    } catch (e) {
      console.warn('status check failed', e);
    }
  }, [isFocused, enterFeatured, fetchBillingRow]);

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

  // ✅ Native: when returning from browser/Stripe, AppState becomes active -> re-check immediately
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const onChange = (state: AppStateStatus) => {
      if (state === 'active') {
        checkStatusAndMaybeEnter();
      }
    };

    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [checkStatusAndMaybeEnter]);

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
      (window as any).location.replace(signInUrl);
      return;
    }

    nav.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Auth', state: { routes: [{ name: 'SignIn' }] } }],
      })
    );
  }, [nav]);

  // ✅ Paywall-fit: clamp height so CTA/benefits never push off-screen
  const cardMaxHeight = Math.min(height * 0.92, 760);

  if (gateChecking) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={[styles.card, { alignItems: 'center', maxHeight: cardMaxHeight }, styles.cardMobileClamp]}>
          <ActivityIndicator color={GOLD} />
          <Text style={{ marginTop: 10, color: TEXT_MUTED, fontFamily: SYSTEM_SANS }}>
            Loading…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ✅ If already pro (or pro until date), don’t show checkout tiles
  if (alreadyPro) {
    const endLabel = proEndsIso ? formatEndDate(proEndsIso) : null;

    return (
      <SafeAreaView style={styles.container}>
        <View style={[styles.card, { maxHeight: cardMaxHeight }, isMobile && styles.cardMobile]}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.cardScrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <Text style={styles.kicker}>PRO</Text>
            <Text style={styles.title}>You already have Pro</Text>

            <Text style={styles.subtitle}>
              {cancelAtPeriodEnd && endLabel
                ? `Your subscription is set to cancel. You’ll keep Pro until ${endLabel}.`
                : 'You’re currently on Pro. No need to upgrade again.'}
            </Text>

            <TouchableOpacity
              onPress={enterFeatured}
              style={[styles.buttonBase, styles.proButton]}
              activeOpacity={0.9}
            >
              <Text style={styles.buttonText}>Go to app</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.backLink}
              onPress={handleBack}
              activeOpacity={0.85}
            >
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.card, { maxHeight: cardMaxHeight }, isMobile && styles.cardMobile]}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.cardScrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <Text style={styles.kicker}>UPGRADE</Text>
          <Text style={styles.title}>Upgrade to Pro</Text>
          <Text style={styles.subtitle}>
            Submit films to the Monthly Film Challenge, apply for paid jobs, and unlock Workshop tools.
          </Text>

          {/* Offer strip */}
          <View style={[styles.offerStrip, isMobile && styles.offerStripMobile]}>
            <View style={{ flex: 1, minWidth: 160 }}>
              <Text style={styles.offerStripKicker}>NEW YEAR’S OFFER</Text>
              <Text style={styles.offerStripTitle}>£24.99 Lifetime</Text>
            </View>

            <View style={[styles.offerStripRight, isMobile && styles.offerStripRightMobile]}>
              <View style={styles.offerDot} />
              <Text style={styles.offerStripMeta}>
                {offerCountdown.expired ? 'Offer ended' : offerCountdown.long}
              </Text>
            </View>
          </View>

          {/* Plan tiles */}
          <View style={styles.plansArea}>
            <View style={[styles.planRow, isMobile && styles.planRowMobile, isTiny && styles.planRowTiny]}>
              {/* Lifetime */}
              <TouchableOpacity
                activeOpacity={0.92}
                onPress={() => setSelectedPlan('lifetime')}
                style={[
                  styles.planTile,
                  styles.planTileHero,
                  selectedPlan === 'lifetime' ? styles.tileSelected : null,
                  isTiny ? styles.planTileTinyStack : null,
                ]}
              >
                <Text style={[styles.planKicker, styles.planKickerHero]}>LIFETIME</Text>
                <View style={styles.planPriceRow}>
                  <Text style={styles.planCurrency}>£</Text>
                  <Text style={styles.planPriceHero}>24.99</Text>
                </View>
                <Text style={styles.planSubHero}>
                  {offerCountdown.expired ? 'Offer ended' : 'Ends Jan 31'}
                </Text>
              </TouchableOpacity>

              {/* Yearly */}
              <TouchableOpacity
                activeOpacity={0.92}
                onPress={() => setSelectedPlan('yearly')}
                style={[
                  styles.planTile,
                  styles.planTileSecondary,
                  selectedPlan === 'yearly' ? styles.tileSelected : null,
                  isTiny ? styles.planTileTinyStack : null,
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
                  isTiny ? styles.planTileTinyStack : null,
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
        </ScrollView>
      </View>
    </SafeAreaView>
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
    paddingVertical: 18,
    paddingHorizontal: 16,
    backgroundColor: DARK_ELEVATED,
    borderWidth: 1,
    borderColor: HAIRLINE,
  },

  // ✅ Slightly tighter on mobile
  cardMobile: {
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },

  // used in the loading card too
  cardMobileClamp: {
    width: '100%',
  },

  cardScrollContent: {
    paddingBottom: 10,
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

  // ✅ Mobile: stack the right side under the title so it doesn’t squeeze
  offerStripMobile: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 10,
  },

  offerStripRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
  },

  offerStripRightMobile: {
    alignItems: 'flex-start',
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

  // ✅ Mobile: allow nicer wrapping; on most phones you’ll get 1-2 tiles per row naturally
  planRowMobile: {
    flexWrap: 'wrap',
  },

  // ✅ Tiny phones: force stack so nothing is cramped
  planRowTiny: {
    flexDirection: 'column',
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

  // ✅ When stacking on tiny screens
  planTileTinyStack: {
    minWidth: '100%' as any,
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
    lineHeight: 16,
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
