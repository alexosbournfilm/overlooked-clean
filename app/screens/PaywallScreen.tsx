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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Purchases from 'react-native-purchases';
import { supabase } from '../lib/supabase';
import { FUNCTIONS_URL } from '../lib/supabase';
import { invalidateMembershipCache } from '../lib/membership';

/* -------------------------- Stripe Price IDs -------------------------- */
const STRIPE_PRICE_MONTHLY = 'price_1S1jLxIaba42c4jIsVBQneb0';

/* -------------------------- RevenueCat -------------------------- */
const REVENUECAT_ANDROID_PUBLIC_SDK_KEY = 'goog_yNsgMdHFvNRzhpfDwICFHbSXuvC';

type PlanKey = 'monthly';

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
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return null;
  }
}

/* -------------------------- theme -------------------------- */

const DARK_ELEVATED = '#171717';
const TEXT_IVORY = '#EDEBE6';
const TEXT_MUTED = 'rgba(237,235,230,0.60)';
const TEXT_MUTED_2 = 'rgba(237,235,230,0.42)';
const HAIRLINE = 'rgba(255,255,255,0.09)';
const GOLD = '#C6A664';

const OFFER_TILE_BG = 'rgba(46,212,122,0.12)';
const OFFER_TILE_BORDER = 'rgba(46,212,122,0.22)';

const SYSTEM_SANS = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: undefined,
  default: undefined,
});

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
  const insets = useSafeAreaInsets();

  const isMobile = width < 520;
  const isTiny = width < 360;

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [selectedPlan, setSelectedPlan] = useState<PlanKey>('monthly');

  const [gateChecking, setGateChecking] = useState(true);

  const [alreadyPro, setAlreadyPro] = useState(false);
  const [proEndsIso, setProEndsIso] = useState<string | null>(null);
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState<boolean>(false);

  const [rcReady, setRcReady] = useState(false);
  const [monthlyPackage, setMonthlyPackage] = useState<any | null>(null);
  const [rcPriceLabel, setRcPriceLabel] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasExited = useRef(false);

  const clearPoll = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  useFocusEffect(
    useCallback(() => {
      const parent = nav.getParent?.();
      parent?.setOptions({ gestureEnabled: false, headerBackVisible: false });
      return () => {
        parent?.setOptions({ gestureEnabled: true, headerBackVisible: true });
      };
    }, [nav])
  );

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    let mounted = true;

    (async () => {
      try {
        const { data: auth, error } = await supabase.auth.getUser();
        if (error) throw error;

        const user = auth?.user;
        if (!user?.id) {
          if (mounted) {
            setMessage('You must be signed in to load your subscription options.');
          }
          return;
        }

        Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);

        await Purchases.configure({
          apiKey: REVENUECAT_ANDROID_PUBLIC_SDK_KEY,
          appUserID: user.id,
        });

        const offerings = await Purchases.getOfferings();

        const pkg =
          offerings.current?.monthly ??
          offerings.current?.availablePackages?.find(
            (p: any) =>
              p?.packageType === 'MONTHLY' ||
              p?.identifier === '$rc_monthly' ||
              p?.packageType?.toLowerCase?.() === 'monthly'
          ) ??
          null;

        if (!mounted) return;

        setMonthlyPackage(pkg);
        setRcPriceLabel(pkg?.product?.priceString ?? null);
        setRcReady(true);
      } catch (err: any) {
        if (!mounted) return;
        console.warn('[revenuecat] setup error', err);
        setMessage(err?.message || 'Could not load subscription offering.');
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const planLabel = useMemo(() => {
    if (Platform.OS === 'android') return 'Continue with Google Play';
    return 'Unlock Monthly Access';
  }, []);

  const selectedSubLabel = useMemo(() => {
    if (Platform.OS === 'android' && rcPriceLabel) {
      return `Monthly access • ${rcPriceLabel}`;
    }
    return 'Monthly access • £4.99 / month';
  }, [rcPriceLabel]);

  const selectedPlanPayload = useMemo(() => {
    return { plan: 'monthly' as const, priceId: STRIPE_PRICE_MONTHLY };
  }, []);

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
      .select(
        'tier, subscription_status, current_period_end, premium_access_expires_at, cancel_at_period_end'
      )
      .eq('id', uid)
      .maybeSingle();

    if (error) return null;

    setProEndsIso((data as any)?.premium_access_expires_at ?? null);
    setCancelAtPeriodEnd(Boolean((data as any)?.cancel_at_period_end));

    return data as any;
  }, []);

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
        setAlreadyPro(true);
        return;
      }

      setAlreadyPro(false);
    } catch {
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

  const openStripeCheckout = async () => {
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) throw authErr;

    const user = auth?.user;
    if (!user?.id) {
      throw new Error('Not signed in.');
    }

    if (!selectedPlanPayload?.priceId) {
      throw new Error('Missing Stripe price id for this plan.');
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
            `Checkout failed.\n\nPrimary: ${primaryMsg}\nFallback: ${
              fallbackErr?.message || 'Unknown error'
            }`
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
  };

  const openCheckout = async () => {
    setSubmitting(true);
    setMessage(null);

    try {
      if (Platform.OS === 'web') {
        await openStripeCheckout();
        return;
      }

      if (Platform.OS === 'android') {
        if (!rcReady) {
          throw new Error('RevenueCat is still loading.');
        }

        if (!monthlyPackage) {
          throw new Error(
            'No monthly offering found in RevenueCat yet. Make sure your current offering includes a monthly package linked to the pro entitlement.'
          );
        }

        const result = await Purchases.purchasePackage(monthlyPackage);
        const customerInfo = result.customerInfo;

        const hasPro = !!customerInfo?.entitlements?.active?.pro;

        if (!hasPro) {
          throw new Error(
            'Purchase completed, but the pro entitlement is not active yet.'
          );
        }

        invalidateMembershipCache();
        enterFeatured();
        return;
      }

      throw new Error('Subscriptions for this platform are not set up yet.');
    } catch (e: any) {
      console.error('checkout redirect error', e);

      const cancelled =
        e?.userCancelled === true ||
        e?.code === 'PURCHASE_CANCELLED' ||
        e?.code === '1';

      if (cancelled) {
        setMessage('Purchase cancelled.');
      } else {
        setMessage(e?.message || 'Could not open checkout.');
      }
    } finally {
      setSubmitting(false);
    }
  };

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

  const horizontalPad = isMobile ? 14 : 20;
  const topPad = Math.max(insets.top + 12, 20);
  const bottomPad = Math.max(insets.bottom + 12, 20);

  const cardMaxHeight = Math.min(
    height - topPad - bottomPad,
    isMobile ? 700 : 760
  );

  if (gateChecking) {
    return (
      <View
        style={[
          styles.container,
          {
            paddingTop: topPad,
            paddingBottom: bottomPad,
            paddingHorizontal: horizontalPad,
          },
        ]}
      >
        <View
          style={[
            styles.card,
            styles.cardLoading,
            { maxHeight: cardMaxHeight },
            isMobile && styles.cardMobile,
          ]}
        >
          <ActivityIndicator color={GOLD} />
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      </View>
    );
  }

  if (alreadyPro) {
    const endLabel = proEndsIso ? formatEndDate(proEndsIso) : null;

    return (
      <View
        style={[
          styles.container,
          {
            paddingTop: topPad,
            paddingBottom: bottomPad,
            paddingHorizontal: horizontalPad,
          },
        ]}
      >
        <View
          style={[
            styles.card,
            { maxHeight: cardMaxHeight },
            isMobile && styles.cardMobile,
          ]}
        >
          <ScrollView
            style={styles.scroll}
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
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: topPad,
          paddingBottom: bottomPad,
          paddingHorizontal: horizontalPad,
        },
      ]}
    >
      <View
        style={[
          styles.card,
          { maxHeight: cardMaxHeight },
          isMobile && styles.cardMobile,
        ]}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.cardScrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <Text style={styles.kicker}>UPGRADE</Text>
          <Text style={styles.title}>Unlock your full filmmaking access</Text>
          <Text style={styles.subtitle}>
            Upload your films, apply for paid jobs, and unlock the full Filmmaking Bootcamp — a premium space to train across every major film discipline through high-level lessons, practical exercises, and powerful Workshop tools built to help you actually make films.
          </Text>

          <View style={styles.plansArea}>
            <View
              style={[
                styles.planRow,
                isMobile && styles.planRowMobile,
                isTiny && styles.planRowTiny,
              ]}
            >
              <TouchableOpacity
                activeOpacity={0.92}
                onPress={() => setSelectedPlan('monthly')}
                style={[
                  styles.planTile,
                  styles.planTileHero,
                  styles.tileSelected,
                  isTiny ? styles.planTileTinyStack : null,
                ]}
              >
                <Text style={[styles.planKicker, styles.planKickerHero]}>MONTHLY</Text>
                <View style={styles.planPriceRow}>
                  <Text style={styles.planCurrency}>£</Text>
                  <Text style={styles.planPriceHero}>
                    {Platform.OS === 'android' && rcPriceLabel
                      ? rcPriceLabel.replace(/[^\d.,]/g, '')
                      : '4.99'}
                  </Text>
                </View>
                <Text style={styles.planSubHero}>
                  {Platform.OS === 'android'
                    ? 'Google Play subscription'
                    : 'Cancel anytime'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            onPress={openCheckout}
            style={[styles.buttonBase, styles.proButton, submitting && styles.buttonDisabled]}
            disabled={submitting}
            activeOpacity={submitting ? 1 : 0.9}
          >
            {submitting ? (
              <View style={styles.buttonRow}>
                <ActivityIndicator color="#0B0B0B" />
                <Text style={styles.buttonText}>
                  {Platform.OS === 'android' ? 'Checking Google Play…' : 'Opening checkout…'}
                </Text>
              </View>
            ) : (
              <Text style={styles.buttonText}>{planLabel}</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.selectedText}>
            {selectedSubLabel}
            {Platform.OS === 'android'
              ? rcReady
                ? monthlyPackage
                  ? ' • RevenueCat offering loaded'
                  : ' • Waiting for RevenueCat offering'
                : ' • Connecting to RevenueCat'
              : ''}
          </Text>

          <View style={styles.divider} />

          <View style={styles.benefits}>
            <Text style={styles.benefitItem}>✓ Upload films to the Monthly Film Challenge</Text>
            <Text style={styles.benefitItem}>✓ Apply for paid jobs across Overlooked</Text>
            <Text style={styles.benefitItem}>✓ Unlock the full Filmmaking Bootcamp</Text>
            <Text style={styles.benefitItem}>✓ Learn every major film discipline through focused lessons and exercises</Text>
            <Text style={styles.benefitItem}>✓ Train with practical exercises inspired by academic film and acting courses</Text>
            <Text style={styles.benefitItem}>✓ Use all Workshop tools and resources to help you develop, plan, and make films</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.88)',
  },

  scroll: {
    width: '100%',
    flexGrow: 0,
  },

  card: {
    width: '100%',
    maxWidth: 920,
    alignSelf: 'center',
    borderRadius: 24,
    paddingVertical: 18,
    paddingHorizontal: 16,
    backgroundColor: DARK_ELEVATED,
    borderWidth: 1,
    borderColor: HAIRLINE,
    overflow: 'hidden',
  },

  cardMobile: {
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },

  cardLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 160,
  },

  cardScrollContent: {
    paddingBottom: 10,
    flexGrow: 1,
  },

  loadingText: {
    marginTop: 10,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
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

  planRowMobile: {
    flexWrap: 'wrap',
  },

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

  planTileTinyStack: {
    minWidth: '100%' as any,
  },

  planTileHero: {
    backgroundColor: OFFER_TILE_BG,
    borderColor: OFFER_TILE_BORDER,
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

  planPriceHero: {
    fontSize: 22,
    fontWeight: '900',
    color: TEXT_IVORY,
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

  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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