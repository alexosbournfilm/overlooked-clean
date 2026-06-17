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
  Linking as RNLinking,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import {
  useFocusEffect,
  useIsFocused,
  useNavigation,
  useRoute,
  CommonActions,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Purchases from 'react-native-purchases';
import { supabase } from '../lib/supabase';
import { FUNCTIONS_URL } from '../lib/supabase';
import {
  invalidateMembershipCache,
  getCurrentUserTier,
} from '../lib/membership';
import {
  PRIVACY_POLICY_URL,
  SUBSCRIPTION_PRICE_AMOUNT,
  SUBSCRIPTION_PRICE_CURRENCY_SYMBOL,
  SUBSCRIPTION_PRICE_FALLBACK,
  SUBSCRIPTION_TITLE,
  TERMS_OF_USE_URL,
} from '../lib/legal';
import { useAppTheme } from '../context/ThemeContext';

/* -------------------------- RevenueCat -------------------------- */
const REVENUECAT_ANDROID_PUBLIC_SDK_KEY = 'goog_yNsgMdHFvNRzhpfDwICFHbSXuvC';
const REVENUECAT_IOS_PUBLIC_SDK_KEY = 'appl_dOTwRcKraCRSTIBoaxPUVEEJcWh';

type PlanKey = 'monthly';

type CheckoutSessionResponse = {
  id?: string;
  url?: string;
  provider?: 'stripe' | 'revenuecat' | string;
  action?:
    | 'checkout_created'
    | 'already_subscribed'
    | 'already_canceled_but_active'
    | 'already_has_lifetime'
    | string;
  error?: string;
  message?: string;
  management_url?: string | null;
  store?: string | null;
  cancel_at_period_end?: boolean | null;
  period_end?: string | null;
  subscription_id?: string | null;
  store_managed?: boolean;
};

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
  cancel_at_period_end?: boolean | null;
}) {
  const proByStatus = isActive(row?.subscription_status, row?.current_period_end);

  const expires = row?.premium_access_expires_at;
  const proByGrace =
    !!expires && new Date(expires).getTime() > Date.now() - 5_000;

  if (row?.cancel_at_period_end) {
    return proByStatus || proByGrace;
  }

  const proByTier = row?.tier === 'pro';

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

function getActiveProEntitlement(customerInfo: any) {
  return customerInfo?.entitlements?.active?.pro ?? null;
}

function getEntitlementExpirationIso(entitlement: any): string | null {
  return entitlement?.expirationDate ?? entitlement?.expiresDate ?? null;
}

async function syncProToSupabase(args: {
  userId: string;
  entitlement: any;
}) {
  const expirationIso = getEntitlementExpirationIso(args.entitlement);

  const payload = {
    tier: 'pro',
    is_premium: true,
    subscription_status: 'active',
    cancel_at_period_end: false,
    current_period_end: expirationIso,
    premium_access_expires_at: expirationIso,
  };

  const { error } = await supabase
    .from('users')
    .update(payload)
    .eq('id', args.userId);

  if (error) {
    throw error;
  }
}

async function openExternalManagementUrl(url?: string | null) {
  if (!url) return false;

  try {
    const supported = await RNLinking.canOpenURL(url);
    if (!supported) return false;

    await RNLinking.openURL(url);
    return true;
  } catch (e) {
    console.log('Paywall openExternalManagementUrl error', e);
    return false;
  }
}

/* -------------------------- theme -------------------------- */

const DARK_ELEVATED = '#111114';
const TEXT_IVORY = '#F4EFE6';
const TEXT_MUTED = 'rgba(255,255,255,0.64)';
const TEXT_MUTED_2 = 'rgba(255,255,255,0.46)';
const HAIRLINE = 'rgba(255,255,255,0.10)';
const GOLD = '#C6A664';

const OFFER_TILE_BG = 'rgba(198,166,100,0.14)';
const OFFER_TILE_BORDER = 'rgba(198,166,100,0.28)';

const SYSTEM_SANS = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: undefined,
  default: undefined,
});

type PaywallContext =
  | 'general'
  | 'challenge'
  | 'jobs'
  | 'showreel'
  | 'bootcamp'
  | 'workshop';

type ComparisonRow = {
  feature: string;
  free: string;
  pro: string;
};

type PaywallCopy = {
  eyebrow: string;
  title: string;
  subtitle: string;
  cta: string;
  rows: ComparisonRow[];
};

const GENERAL_ROWS: ComparisonRow[] = [
  { feature: 'Browse creator profiles', free: '✓', pro: '✓' },
  { feature: 'Watch films on Featured', free: '✓', pro: '✓' },
  { feature: 'Connect with creatives', free: '✓', pro: '✓' },
  { feature: 'Submit to Monthly Film Challenge', free: '✕', pro: '✓' },
  { feature: 'Upload showreels', free: '✕', pro: '✓ up to 3' },
  { feature: 'Apply for paid jobs', free: '✕', pro: '✓' },
  { feature: 'Access Filmmaking Bootcamp', free: '✕', pro: '✓' },
  { feature: 'Use Workshop tools', free: '✕', pro: '✓' },
  { feature: 'Film planning resources', free: '✕', pro: '✓' },
  { feature: 'Get featured through challenges', free: '✕', pro: '✓' },
  { feature: 'Build a stronger portfolio link', free: 'Limited', pro: '✓' },
];

const PAYWALL_COPY: Record<PaywallContext, PaywallCopy> = {
  general: {
    eyebrow: 'OVERLOOKED PRO',
    title: 'Make films. Build your showreel. Get seen.',
    subtitle:
      'Submit to monthly film challenges, upload your best work, apply for paid roles, and use tools designed to help you actually finish films.',
    cta: `Unlock Pro — ${SUBSCRIPTION_PRICE_FALLBACK}/month`,
    rows: GENERAL_ROWS,
  },
  challenge: {
    eyebrow: 'This is a Pro creator tool',
    title: 'Submit your film with Pro',
    subtitle:
      'Monthly Film Challenge submissions are part of Overlooked Pro. Upgrade to upload your film, get seen on Featured, and compete for next month’s top spot.',
    cta: `Unlock Pro and submit — ${SUBSCRIPTION_PRICE_FALLBACK}/month`,
    rows: [
      { feature: 'Watch challenge films', free: '✓', pro: '✓' },
      { feature: 'Vote on submissions', free: '✓', pro: '✓' },
      { feature: 'Submit your own film', free: '✕', pro: '✓' },
      { feature: 'Appear on Featured', free: '✕', pro: '✓' },
      { feature: 'Compete to become next month’s winner', free: '✕', pro: '✓' },
    ],
  },
  jobs: {
    eyebrow: 'This is a Pro creator tool',
    title: 'Apply for paid roles with Pro',
    subtitle:
      'Paid job applications are reserved for Pro creators, so opportunities stay focused on people actively building their portfolio.',
    cta: `Unlock Pro and apply — ${SUBSCRIPTION_PRICE_FALLBACK}/month`,
    rows: [
      { feature: 'Browse paid jobs', free: '✓', pro: '✓' },
      { feature: 'Save interesting roles', free: '✓', pro: '✓' },
      { feature: 'Apply for paid jobs', free: '✕', pro: '✓' },
      { feature: 'Share portfolio with applications', free: '✕', pro: '✓' },
      { feature: 'Build a stronger creator profile', free: 'Limited', pro: '✓' },
    ],
  },
  showreel: {
    eyebrow: 'This is a Pro creator tool',
    title: 'Build your showreel with Pro',
    subtitle:
      'Pro lets you upload up to 3 showreels, strengthen your public profile, and share a better portfolio link.',
    cta: 'Unlock Pro and upload showreels',
    rows: [
      { feature: 'Create a basic profile', free: '✓', pro: '✓' },
      { feature: 'Add basic profile details', free: '✓', pro: '✓' },
      { feature: 'Upload showreels', free: '✕', pro: '✓ up to 3' },
      { feature: 'Share portfolio link', free: 'Limited', pro: '✓' },
      { feature: 'Stand out to collaborators', free: 'Limited', pro: '✓' },
    ],
  },
  bootcamp: {
    eyebrow: 'This is a Pro creator tool',
    title: 'Unlock the Filmmaking Bootcamp',
    subtitle:
      'Get guided lessons, exercises, and resources to help you plan, shoot, and finish better films.',
    cta: 'Unlock Bootcamp with Pro',
    rows: [
      { feature: 'Browse Overlooked', free: '✓', pro: '✓' },
      { feature: 'Watch public films', free: '✓', pro: '✓' },
      { feature: 'Access Bootcamp lessons', free: '✕', pro: '✓' },
      { feature: 'Use exercises and prompts', free: '✕', pro: '✓' },
      { feature: 'Follow guided filmmaking structure', free: '✕', pro: '✓' },
    ],
  },
  workshop: {
    eyebrow: 'This is a Pro creator tool',
    title: 'Use Workshop tools with Pro',
    subtitle:
      'Unlock planning tools, creative exercises, and film resources built to help you turn ideas into finished films.',
    cta: 'Unlock Workshop tools',
    rows: [
      { feature: 'Browse the community', free: '✓', pro: '✓' },
      { feature: 'View public content', free: '✓', pro: '✓' },
      { feature: 'Use Workshop tools', free: '✕', pro: '✓' },
      { feature: 'Access planning resources', free: '✕', pro: '✓' },
      { feature: 'Develop film ideas faster', free: '✕', pro: '✓' },
    ],
  },
};

function normalizePaywallContext(value: unknown): PaywallContext {
  if (value === 'extra_submission') return 'challenge';
  if (
    value === 'challenge' ||
    value === 'jobs' ||
    value === 'showreel' ||
    value === 'bootcamp' ||
    value === 'workshop'
  ) {
    return value;
  }

  return 'general';
}

export default function PaywallScreen() {
  const { colors } = useAppTheme();
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const isFocused = useIsFocused();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const isMobile = width < 520;
  const isTiny = width < 360;
  const DARK_ELEVATED = colors.card;
  const TEXT_IVORY = colors.textPrimary;
  const TEXT_MUTED = colors.textSecondary;
  const TEXT_MUTED_2 = colors.textMuted;
  const HAIRLINE = colors.border;
  const GOLD = colors.primary;
  const shellStyle = {
    backgroundColor: colors.background,
  };
  const cardStyle = {
    backgroundColor: DARK_ELEVATED,
    borderColor: HAIRLINE,
    shadowColor: colors.shadow,
  };
  const primaryTextStyle = { color: TEXT_IVORY };
  const mutedTextStyle = { color: TEXT_MUTED };
  const paywallContext = normalizePaywallContext(route.params?.context ?? route.params?.feature);
  const paywallCopy = PAYWALL_COPY[paywallContext];

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

  const openLegalUrl = useCallback(async (url: string) => {
    try {
      const supported = await RNLinking.canOpenURL(url);
      if (supported) {
        await RNLinking.openURL(url);
      }
    } catch (e) {
      console.log('openLegalUrl error', e);
    }
  }, []);

  const getSafeMessage = useCallback((rawMessage: string) => {
    if (__DEV__) return rawMessage;

    const lower = rawMessage.toLowerCase();

    const isDeveloperOrStoreConfigError =
      lower.includes('revenuecat') ||
      lower.includes('offering') ||
      lower.includes('api key') ||
      lower.includes('storekit') ||
      lower.includes('native store') ||
      lower.includes('configured') ||
      lower.includes('sandbox');

    if (isDeveloperOrStoreConfigError) {
      return 'Subscription is temporarily unavailable. Please try again later.';
    }

    return rawMessage;
  }, []);

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
    if (Platform.OS === 'web') return;

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

        const apiKey =
          Platform.OS === 'ios'
            ? REVENUECAT_IOS_PUBLIC_SDK_KEY
            : REVENUECAT_ANDROID_PUBLIC_SDK_KEY;

        Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);

        await Purchases.configure({
          apiKey,
          appUserID: user.id,
        });

        const offerings = await Purchases.getOfferings();

        console.log('[RC] offerings', JSON.stringify(offerings, null, 2));
        console.log('[RC] current offering', JSON.stringify(offerings.current, null, 2));
        console.log(
          '[RC] available packages',
          JSON.stringify(offerings.current?.availablePackages ?? [], null, 2)
        );

        const pkg =
          offerings.current?.monthly ??
          offerings.current?.availablePackages?.find(
            (p: any) =>
              p?.product?.identifier === 'com.overlooked.pro.monthly' ||
              p?.identifier === '$rc_monthly'
          ) ??
          offerings.current?.availablePackages?.[0] ??
          null;

        console.log('[RC] selected package', JSON.stringify(pkg, null, 2));

        if (!mounted) return;

        setMonthlyPackage(pkg);
        setRcPriceLabel(pkg?.product?.priceString ?? null);
        setRcReady(true);
      } catch (err: any) {
        if (!mounted) return;
        console.warn('[revenuecat] setup error', err);
        setMessage(
          err?.message
            ? `Could not load subscription offering: ${err.message}`
            : 'Could not load subscription offering.'
        );
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const planLabel = useMemo(() => {
    if (Platform.OS === 'android') return 'Continue with Google Play';
    if (Platform.OS === 'ios') return 'Continue with App Store';
    return 'Unlock Monthly Access';
  }, []);

  const selectedSubLabel = useMemo(() => {
    if ((Platform.OS === 'android' || Platform.OS === 'ios') && rcPriceLabel) {
      return `Monthly access • ${rcPriceLabel}`;
    }
    return `Monthly access • ${SUBSCRIPTION_PRICE_FALLBACK} / month`;
  }, [rcPriceLabel]);

  const selectedPlanPayload = useMemo(() => {
    return { plan: 'monthly' as const };
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

    setProEndsIso(
      (data as any)?.premium_access_expires_at ??
        (data as any)?.current_period_end ??
        null
    );
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

  const handleExistingSubscriptionResponse = useCallback(
    async (result: CheckoutSessionResponse) => {
      const endLabel = result?.period_end ? formatEndDate(result.period_end) : null;

      if (result?.provider === 'revenuecat') {
        const opened = await openExternalManagementUrl(result?.management_url ?? null);

        if (result?.action === 'already_canceled_but_active') {
          setMessage(
            result?.message ||
              (endLabel
                ? `You already have a mobile subscription that remains active until ${endLabel}, including Pro access for up to 3 showreels.`
                : 'You already have a mobile subscription that remains active until the end of the billing period, including Pro access for up to 3 showreels.')
          );
          return;
        }

        if (opened) {
          setMessage(
            result?.message ||
              'You already have a mobile subscription. We opened the store management page for you.'
          );
          return;
        }

        setMessage(
          result?.message ||
            'You already have a mobile subscription. Manage it in Google Play or the App Store.'
        );
        return;
      }

      if (result?.action === 'already_has_lifetime') {
        setMessage(
          result?.message || 'This account already has lifetime Pro access.'
        );
        return;
      }

      if (result?.action === 'already_canceled_but_active') {
        setMessage(
          result?.message ||
            (endLabel
              ? `You already have Pro and it stays active until ${endLabel}, including up to 3 showreels.`
              : 'You already have Pro until the end of your current billing period, including up to 3 showreels.')
        );
        return;
      }

      setMessage(
        result?.message || 'This account already has an active subscription.'
      );
    },
    []
  );

  const openStripeCheckout = async () => {
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) throw authErr;

    const user = auth?.user;
    if (!user?.id) {
      throw new Error('Not signed in.');
    }

    const requestBody = {
      user_id: user.id,
      email: user.email ?? undefined,
      plan: selectedPlanPayload.plan,
    };

    const invokeRes = await supabase.functions.invoke('create-checkout-session', {
      body: requestBody,
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
            body: JSON.stringify(requestBody),
          });

          const json = await resp.json().catch(() => ({}));
          const result = (json ?? {}) as CheckoutSessionResponse;

          if (resp.status === 409) {
            await handleExistingSubscriptionResponse(result);
            return;
          }

          if (!resp.ok) {
            const msg =
              result?.error ||
              result?.message ||
              `Checkout session failed (HTTP ${resp.status}).`;
            throw new Error(msg);
          }

          const url = result?.url as string | undefined;
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

    const result = (invokeRes.data ?? {}) as CheckoutSessionResponse;

    if (
      result?.action === 'already_subscribed' ||
      result?.action === 'already_canceled_but_active' ||
      result?.action === 'already_has_lifetime'
    ) {
      await handleExistingSubscriptionResponse(result);
      return;
    }

    const url = result?.url as string | undefined;
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

      if (!rcReady) {
        throw new Error('RevenueCat is still loading.');
      }

      if (!monthlyPackage) {
        throw new Error(
          'No monthly offering found in RevenueCat yet. Make sure your current offering includes a monthly package linked to the pro entitlement.'
        );
      }

      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;

      const user = auth?.user;
      if (!user?.id) {
        throw new Error('Not signed in.');
      }

      const result = await Purchases.purchasePackage(monthlyPackage);
      const customerInfo = result.customerInfo;

      console.log('[RC] customerInfo after purchase', JSON.stringify(customerInfo, null, 2));

      const entitlement = getActiveProEntitlement(customerInfo);
      const hasPro = !!entitlement;

      if (!hasPro) {
        throw new Error(
          'Purchase completed, but the pro entitlement is not active yet.'
        );
      }

      await syncProToSupabase({
        userId: user.id,
        entitlement,
      });

      invalidateMembershipCache();
      await getCurrentUserTier({ force: true });

      const freshRow = await fetchBillingRow();
      const freshPro = hasProAccess(freshRow ?? undefined);

      if (!freshPro) {
        throw new Error(
          'Purchase succeeded, but your Pro status did not refresh in the database yet.'
        );
      }

      enterFeatured();
      return;
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
          shellStyle,
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
            cardStyle,
            { maxHeight: cardMaxHeight },
            isMobile && styles.cardMobile,
          ]}
        >
          <ActivityIndicator color={GOLD} />
          <Text style={[styles.loadingText, mutedTextStyle]}>Loading…</Text>
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
          shellStyle,
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
            cardStyle,
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
            <Text style={[styles.kicker, { color: GOLD }]}>PRO</Text>
            <Text style={[styles.title, primaryTextStyle]}>You already have Pro</Text>

            <Text style={[styles.subtitle, mutedTextStyle]}>
              {cancelAtPeriodEnd && endLabel
                ? `Your subscription is set to cancel. You’ll keep Pro, including up to 3 showreels, until ${endLabel}.`
                : 'You’re currently on Pro, including up to 3 showreels. No need to upgrade again.'}
            </Text>

            <TouchableOpacity
              onPress={enterFeatured}
              style={[styles.buttonBase, styles.proButton]}
              activeOpacity={0.9}
            >
              <Text style={[styles.buttonText, { color: colors.textOnPrimary }]}>Go to app</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.backLink}
              onPress={handleBack}
              activeOpacity={0.85}
            >
              <Text style={[styles.backText, { color: GOLD }]}>Back</Text>
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
        shellStyle,
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
          cardStyle,
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
          <Text style={[styles.kicker, { color: GOLD }]}>{paywallCopy.eyebrow}</Text>
          <Text style={[styles.title, primaryTextStyle]}>{paywallCopy.title}</Text>
          <Text style={[styles.subtitle, mutedTextStyle]}>{paywallCopy.subtitle}</Text>

          <View style={styles.plansArea}>
            <View
              style={[
                styles.planRow,
                isMobile && styles.planRowMobile,
                isTiny && styles.planRowTiny,
              ]}
            >
              <View
                style={[
                  styles.planTile,
                  styles.freePlanTile,
                  { backgroundColor: colors.mutedCard, borderColor: HAIRLINE },
                  isTiny ? styles.planTileTinyStack : null,
                ]}
              >
                <Text style={[styles.planKicker, { color: GOLD }]}>FREE</Text>
                <Text style={[styles.planTitle, primaryTextStyle]}>Explore the community</Text>
                <Text style={[styles.planBody, mutedTextStyle]}>
                  Browse creators, watch films, and connect with other creatives.
                </Text>
                <Text style={[styles.planLimit, { color: TEXT_MUTED_2 }]}>
                  Good for discovering Overlooked. Limited for creating.
                </Text>
                <View style={styles.freePriceRow}>
                  <Text style={[styles.freePrice, primaryTextStyle]}>FREE</Text>
                  <Text style={[styles.freePriceSub, { color: TEXT_MUTED_2 }]}>forever</Text>
                </View>
              </View>

              <TouchableOpacity
                activeOpacity={0.92}
                onPress={() => setSelectedPlan('monthly')}
                style={[
                  styles.planTile,
                  styles.planTileHero,
                  styles.tileSelected,
                  { backgroundColor: colors.cardAlt, borderColor: colors.borderStrong },
                  isTiny ? styles.planTileTinyStack : null,
                ]}
              >
                <View
                  style={[
                    styles.bestForBadge,
                    { backgroundColor: colors.backgroundAlt, borderColor: colors.borderStrong },
                  ]}
                >
                  <Text style={[styles.bestForText, { color: colors.accent }]}>
                    Best for serious creators
                  </Text>
                </View>
                <Text style={[styles.planKicker, styles.planKickerHero, { color: colors.accent }]}>
                  PRO
                </Text>
                <Text style={[styles.planTitle, primaryTextStyle]}>
                  Everything you need to grow as a filmmaker
                </Text>
                <Text style={[styles.planBody, mutedTextStyle]}>
                  Submit films, build your public portfolio, apply for paid roles, and unlock guided filmmaking tools.
                </Text>
                <View style={styles.planPriceRow}>
                  <Text style={[styles.planCurrency, { color: TEXT_IVORY }]}>
                    {SUBSCRIPTION_PRICE_CURRENCY_SYMBOL}
                  </Text>
                  <Text style={[styles.planPriceHero, { color: TEXT_IVORY }]}>
                    {(Platform.OS === 'android' || Platform.OS === 'ios') && rcPriceLabel
                      ? rcPriceLabel.replace(/[^\d.,]/g, '')
                      : SUBSCRIPTION_PRICE_AMOUNT}
                  </Text>
                </View>

                <Text style={[styles.planSubHero, { color: TEXT_MUTED }]}>
                  Less than one coffee a month.
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={[styles.comparisonBox, { backgroundColor: colors.mutedCard, borderColor: HAIRLINE }]}>
            <View style={styles.comparisonHeader}>
              <Text style={[styles.comparisonTitle, primaryTextStyle]}>Free vs Pro</Text>
              <View style={styles.comparisonStatusGroup}>
                <Text style={[styles.comparisonColumnHeader, { color: TEXT_MUTED_2 }]}>Free</Text>
                <Text style={[styles.comparisonColumnHeader, { color: GOLD }]}>Pro</Text>
              </View>
            </View>

            {paywallCopy.rows.map((row) => {
              const freeLocked = row.free === '✕';
              const proStrong = row.pro.startsWith('✓');

              return (
                <View
                  key={row.feature}
                  style={[styles.comparisonRow, { borderTopColor: HAIRLINE }]}
                >
                  <Text style={[styles.comparisonFeature, mutedTextStyle]}>
                    {row.feature}
                  </Text>
                  <View style={styles.comparisonStatusGroup}>
                    <View
                      style={[
                        styles.statusPill,
                        {
                          backgroundColor: freeLocked
                            ? 'rgba(143,133,120,0.12)'
                            : 'rgba(72,180,113,0.13)',
                          borderColor: freeLocked ? HAIRLINE : 'rgba(72,180,113,0.28)',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusText,
                          { color: freeLocked ? TEXT_MUTED_2 : colors.success },
                        ]}
                      >
                        {row.free}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.statusPill,
                        styles.statusPillPro,
                        {
                          backgroundColor: proStrong
                            ? 'rgba(72,180,113,0.13)'
                            : 'rgba(198,166,100,0.12)',
                          borderColor: proStrong
                            ? 'rgba(72,180,113,0.28)'
                            : colors.borderStrong,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusText,
                          { color: proStrong ? colors.success : GOLD },
                        ]}
                      >
                        {row.pro}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>

          <View
            style={[
              styles.finalCtaBox,
              { backgroundColor: colors.cardAlt, borderColor: colors.borderStrong },
            ]}
          >
            <Text style={[styles.finalCtaTitle, primaryTextStyle]}>
              Ready to start making films?
            </Text>
            <Text style={[styles.finalCtaSub, mutedTextStyle]}>
              Unlock the tools, uploads, and opportunities built for serious creators.
            </Text>
          </View>

          <TouchableOpacity
            onPress={openCheckout}
            style={[styles.buttonBase, styles.proButton, submitting && styles.buttonDisabled]}
            disabled={submitting}
            activeOpacity={submitting ? 1 : 0.9}
          >
            {submitting ? (
              <View style={styles.buttonRow}>
                <ActivityIndicator color={colors.textOnPrimary} />
                <Text style={[styles.buttonText, { color: colors.textOnPrimary }]}>
                  {Platform.OS === 'android'
                    ? 'Opening Google Play…'
                    : Platform.OS === 'ios'
                    ? 'Opening App Store…'
                    : 'Opening checkout…'}
                </Text>
              </View>
            ) : (
              <Text style={[styles.buttonText, { color: colors.textOnPrimary }]}>
                {Platform.OS === 'android' || Platform.OS === 'ios' ? planLabel : paywallCopy.cta}
              </Text>
            )}
          </TouchableOpacity>

          <Text style={[styles.selectedText, { color: TEXT_MUTED }]}>
            Cancel anytime. Auto-renews monthly. {selectedSubLabel}
          </Text>

          <View style={[styles.subscriptionInfoBox, { backgroundColor: colors.mutedCard, borderColor: HAIRLINE }]}>
            <Text style={[styles.subscriptionInfoTitle, primaryTextStyle]}>{SUBSCRIPTION_TITLE}</Text>

            <Text style={[styles.subscriptionInfoText, mutedTextStyle]}>
              Auto-renewable monthly subscription. {rcPriceLabel ?? SUBSCRIPTION_PRICE_FALLBACK} per month. Payment is handled through the checkout method you choose. Your subscription renews automatically unless cancelled before the end of the current period. You can manage or cancel anytime from this membership screen or your payment provider.
            </Text>

            <View style={styles.legalLinksRow}>
              <TouchableOpacity onPress={() => openLegalUrl(TERMS_OF_USE_URL)}>
                <Text style={[styles.legalLinkText, { color: GOLD }]}>Terms of Use</Text>
              </TouchableOpacity>

              <Text style={[styles.legalDivider, { color: TEXT_MUTED_2 }]}>•</Text>

              <TouchableOpacity onPress={() => openLegalUrl(PRIVACY_POLICY_URL)}>
                <Text style={[styles.legalLinkText, { color: GOLD }]}>Privacy Policy</Text>
              </TouchableOpacity>
            </View>
          </View>

          {!!message && (
            <Text style={styles.errorText}>{getSafeMessage(message)}</Text>
          )}

          <TouchableOpacity
            style={styles.backLink}
            onPress={handleBack}
            disabled={submitting}
            activeOpacity={0.85}
          >
            <Text style={[styles.backText, { color: GOLD }]}>Maybe later</Text>
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

  freePlanTile: {
    borderWidth: 1,
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
    color: GOLD,
  },

  bestForBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginBottom: 8,
  },

  bestForText: {
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },

  planTitle: {
    marginTop: 4,
    fontSize: 16,
    lineHeight: 19,
    fontWeight: '900',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },

  planBody: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 17,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },

  planLimit: {
    marginTop: 8,
    fontSize: 11,
    lineHeight: 15,
    color: TEXT_MUTED_2,
    fontFamily: SYSTEM_SANS,
  },

  freePriceRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 7,
  },

  freePrice: {
    fontSize: 19,
    fontWeight: '900',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },

  freePriceSub: {
    fontSize: 11,
    color: TEXT_MUTED_2,
    fontFamily: SYSTEM_SANS,
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
    color: TEXT_MUTED,
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

  comparisonBox: {
    marginTop: 12,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },

  comparisonHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },

  comparisonTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },

  comparisonColumnHeader: {
    width: 76,
    fontSize: 10,
    fontWeight: '900',
    fontFamily: SYSTEM_SANS,
    textAlign: 'center',
  },

  comparisonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderTopWidth: 1,
    paddingVertical: 8,
  },

  comparisonFeature: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },

  comparisonStatusGroup: {
    width: 160,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },

  statusPill: {
    width: 76,
    minHeight: 25,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },

  statusPillPro: {
    width: 76,
  },

  statusText: {
    fontSize: 10.5,
    fontWeight: '900',
    fontFamily: SYSTEM_SANS,
    textAlign: 'center',
  },

  finalCtaBox: {
    marginTop: 12,
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },

  finalCtaTitle: {
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },

  finalCtaSub: {
    marginTop: 5,
    fontSize: 12.5,
    lineHeight: 17,
    textAlign: 'center',
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },

  subscriptionInfoBox: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },

  subscriptionInfoTitle: {
    color: TEXT_IVORY,
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 6,
    fontFamily: SYSTEM_SANS,
  },

  subscriptionInfoText: {
    color: 'rgba(237,235,230,0.58)',
    fontSize: 11.5,
    lineHeight: 16,
    marginBottom: 6,
    fontFamily: SYSTEM_SANS,
  },

  legalLinksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    gap: 8,
    flexWrap: 'wrap',
  },

  legalLinkText: {
    color: GOLD,
    fontSize: 12,
    fontWeight: '800',
    textDecorationLine: 'underline',
    fontFamily: SYSTEM_SANS,
  },

  legalDivider: {
    color: 'rgba(237,235,230,0.38)',
    fontSize: 12,
    fontWeight: '700',
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
