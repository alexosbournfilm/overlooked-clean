import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Pressable,
  ActivityIndicator,
  ScrollView,
  useWindowDimensions,
  Linking,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type UserTier } from '../app/lib/supabase';
import { invalidateMembershipCache } from '../app/lib/membership';
import { getMySubscriptionStatus } from '../app/lib/billing';
import { supabase } from '../app/lib/supabase';
import {
  PRIVACY_POLICY_URL,
  SUBSCRIPTION_PRICE_AMOUNT,
  SUBSCRIPTION_PRICE_CURRENCY_SYMBOL,
  SUBSCRIPTION_PRICE_FALLBACK,
  SUBSCRIPTION_TITLE,
  TERMS_OF_USE_URL,
} from '../app/lib/legal';
import { useAppTheme } from '../app/context/ThemeContext';

type UpgradeContext =
  | 'challenge'
  | 'jobs'
  | 'workshop'
  | 'extra_submission'
  | 'showreel'
  | 'bootcamp'
  | undefined;

type Props = {
  visible: boolean;
  onClose: () => void;
  context?: UpgradeContext;
  onSelectPro?: () => void;
};

type BillingSnapshot = {
  hasProAccess: boolean;
  effectiveTier: 'free' | 'pro';
  accessEndsAt: string | null;
  inCancelGracePeriod: boolean;
  isGrandfathered: boolean;
  isActiveSubscriber: boolean;
  hasPaymentProviderSubscriptionRecord?: boolean;
  hasStripeSubscriptionRecord: boolean;
  cancel_at_period_end?: boolean | null;
  current_period_end?: string | null;
  premium_access_expires_at?: string | null;
  stripe_subscription_id?: string | null;
  stripe_customer_id?: string | null;
};

type CancelSubscriptionResponse = {
  ok?: boolean;
  error?: string;
  details?: string;
  message?: string;
  provider?: 'stripe' | 'revenuecat' | string;
  action?:
    | 'stripe_canceled'
    | 'already_scheduled'
    | 'manage_external'
    | 'nothing_to_cancel'
    | string;
  management_url?: string | null;
  store?: string | null;
  cancel_at_period_end?: boolean | null;
  period_end?: string | null;
  is_grandfathered?: boolean;
};

type ResumeSubscriptionResponse = {
  ok?: boolean;
  error?: string;
  details?: string;
  message?: string;
  provider?: 'stripe' | 'revenuecat' | string;
  action?:
    | 'stripe_resumed'
    | 'already_active'
    | 'manage_external'
    | 'nothing_to_resume'
    | string;
  management_url?: string | null;
  store?: string | null;
  cancel_at_period_end?: boolean | null;
  period_end?: string | null;
  is_grandfathered?: boolean;
};

/* -------------------------- shared palette/fonts -------------------------- */

const DARK_ELEVATED = '#0D0D0F';
const SURFACE = '#111114';
const SURFACE_2 = '#16161A';

const TEXT_IVORY = '#F4EFE6';
const TEXT_MUTED = 'rgba(255,255,255,0.66)';
const TEXT_MUTED_2 = 'rgba(255,255,255,0.46)';

const HAIRLINE = 'rgba(255,255,255,0.10)';
const HAIRLINE_2 = 'rgba(255,255,255,0.07)';

const GOLD = '#C6A664';
const GOLD_SOFT = 'rgba(198,166,100,0.16)';

const WARNING_BG = 'rgba(198,166,100,0.12)';
const WARNING_BORDER = 'rgba(198,166,100,0.22)';
const SUCCESS_BG = 'rgba(46,212,122,0.12)';
const SUCCESS_BORDER = 'rgba(46,212,122,0.22)';

const OFFER_TILE_BG = 'rgba(198,166,100,0.14)';
const OFFER_TILE_BORDER = 'rgba(198,166,100,0.28)';

const SYSTEM_SANS = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: undefined,
  default: undefined,
});

type ComparisonRow = {
  feature: string;
  free: string;
  pro: string;
};

const GENERAL_COMPARISON_ROWS: ComparisonRow[] = [
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

function getOfferRemaining() {
  const end = new Date(2026, 0, 31, 23, 59, 59);
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

function getCancellationCountdown(iso?: string | null) {
  if (!iso) {
    return {
      daysLeft: null as number | null,
      short: null as string | null,
      long: null as string | null,
      ended: false,
    };
  }

  try {
    const end = new Date(iso);
    if (Number.isNaN(end.getTime())) {
      return {
        daysLeft: null,
        short: null,
        long: null,
        ended: false,
      };
    }

    const now = new Date();
    const diffMs = end.getTime() - now.getTime();

    if (diffMs <= 0) {
      return {
        daysLeft: 0,
        short: 'Ends today',
        long: 'Your Pro access ends today.',
        ended: true,
      };
    }

    const dayMs = 1000 * 60 * 60 * 24;
    const daysLeft = Math.ceil(diffMs / dayMs);

    const short = daysLeft === 1 ? '1 day left' : `${daysLeft} days left`;
    const long =
      daysLeft === 1
        ? 'Your account will return to Free in 1 day.'
        : `Your account will return to Free in ${daysLeft} days.`;

    return {
      daysLeft,
      short,
      long,
      ended: false,
    };
  } catch {
    return {
      daysLeft: null,
      short: null,
      long: null,
      ended: false,
    };
  }
}

function getDerivedTierFromBilling(
  billing: BillingSnapshot | null | undefined
): UserTier {
  return billing?.hasProAccess || billing?.effectiveTier === 'pro' ? 'pro' : 'free';
}

async function openExternalManagementUrl(url?: string | null) {
  if (!url) return false;

  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) return false;

    await Linking.openURL(url);
    return true;
  } catch (e) {
    console.log('UpgradeModal openExternalManagementUrl error', e);
    return false;
  }
}

async function openAppleSubscriptions() {
  const urls = [
    'itms-apps://apps.apple.com/account/subscriptions',
    'https://apps.apple.com/account/subscriptions',
    'https://support.apple.com/billing',
  ];

  for (const url of urls) {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
        return true;
      }
    } catch (e) {
      console.log('UpgradeModal openAppleSubscriptions error', e);
    }
  }

  return false;
}

async function openGoogleSubscriptions() {
  const urls = [
    'https://play.google.com/store/account/subscriptions',
    'market://details?id=com.android.vending',
  ];

  for (const url of urls) {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
        return true;
      }
    } catch (e) {
      console.log('UpgradeModal openGoogleSubscriptions error', e);
    }
  }

  return false;
}

async function openProviderManagementUrl(url?: string | null, store?: string | null) {
  const openedExternal = await openExternalManagementUrl(url);
  if (openedExternal) return true;

  const normalizedStore = (store || '').toLowerCase();

  if (
    Platform.OS === 'ios' ||
    normalizedStore === 'app_store' ||
    normalizedStore === 'mac_app_store'
  ) {
    return openAppleSubscriptions();
  }

  if (Platform.OS === 'android' || normalizedStore === 'play_store') {
    return openGoogleSubscriptions();
  }

  return false;
}

async function openLegalUrl(url: string) {
  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    }
  } catch (e) {
    console.log('UpgradeModal openLegalUrl error', e);
  }
}

export const UpgradeModal: React.FC<Props> = ({
  visible,
  onClose,
  context,
  onSelectPro,
}) => {
  const { colors, isLight } = useAppTheme();
  const nav = useNavigation<any>();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const isMobile = width < 520;
  const isTiny = width < 360;
  const isDesktopWeb = Platform.OS === 'web' && !isMobile;

  const [selectedTier, setSelectedTier] = useState<UserTier>('pro');
  const [currentTier, setCurrentTier] = useState<UserTier | null>(null);

  const [upgrading, setUpgrading] = useState(false);
  const [downgrading, setDowngrading] = useState(false);
  const [restoringPro, setRestoringPro] = useState(false);

  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);

  const [downgradeConfirmVisible, setDowngradeConfirmVisible] = useState(false);
  const [downgradeConfirmError, setDowngradeConfirmError] = useState<string | null>(null);

  const [periodEndIso, setPeriodEndIso] = useState<string | null>(null);
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState<boolean>(false);

  const [billingState, setBillingState] = useState<BillingSnapshot | null>(null);

  const [offerCountdown, setOfferCountdown] = useState(() => getOfferRemaining());
  const [cancelCountdown, setCancelCountdown] = useState(() =>
    getCancellationCountdown(null)
  );

  useEffect(() => {
    if (!visible) return;

    const tick = () => setOfferCountdown(getOfferRemaining());
    tick();

    const id = setInterval(tick, 60 * 1000);
    return () => clearInterval(id);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;

    const tick = () => {
      setCancelCountdown(getCancellationCountdown(periodEndIso));
    };

    tick();

    const id = setInterval(tick, 60 * 1000);
    return () => clearInterval(id);
  }, [visible, periodEndIso]);

  useEffect(() => {
    if (!visible) return;

    let mounted = true;

    (async () => {
      try {
        setErrorText(null);
        setSuccessText(null);
        setDowngradeConfirmError(null);

        const billing = (await getMySubscriptionStatus()) as BillingSnapshot;
        if (!mounted) return;

        const derivedTier = getDerivedTierFromBilling(billing);

        setBillingState(billing);
        setCurrentTier(derivedTier);
        setSelectedTier(derivedTier);
        setPeriodEndIso(
          billing.current_period_end ??
            billing.accessEndsAt ??
            billing.premium_access_expires_at ??
            null
        );
        setCancelAtPeriodEnd(Boolean(billing.cancel_at_period_end));
      } catch (err) {
        console.log('UpgradeModal load error', (err as any)?.message || err);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [visible]);

  const title = 'Make films. Build your showreel. Get seen.';
  const subtitle =
    'Submit to monthly film challenges, upload your best work, apply for paid roles, and use tools designed to help you actually finish films.';

  const isActuallyPro =
    Boolean(billingState?.hasProAccess) ||
    billingState?.effectiveTier === 'pro' ||
    currentTier === 'pro';

  const currentTierLabel = isActuallyPro ? 'Pro' : 'Free';
  const isProDisabled = isActuallyPro && !cancelAtPeriodEnd;
  const endDateLabel = periodEndIso ? formatEndDate(periodEndIso) : null;

  const isGrandfathered = Boolean(billingState?.isGrandfathered);
  const isActiveSubscriber = Boolean(billingState?.isActiveSubscriber);
  const inCancelGracePeriod = Boolean(billingState?.inCancelGracePeriod);

  const canCancelRenewal =
    !isGrandfathered &&
    (
      isActiveSubscriber ||
      inCancelGracePeriod ||
      Boolean(billingState?.hasPaymentProviderSubscriptionRecord) ||
      Boolean(billingState?.stripe_subscription_id) ||
      Boolean(billingState?.stripe_customer_id)
    );

  const canKeepPro = !isGrandfathered && isActuallyPro && cancelAtPeriodEnd;

  const downgradeLossBullets = useMemo(() => {
    return [
      'Uploading films to the Monthly Film Challenge will be locked (Pro only).',
      'Extra showreel uploads will be locked. Free accounts can keep 1 showreel; Pro supports up to 3.',
      'Paid job applications will be locked (Pro only).',
      'The full Filmmaking Bootcamp will be locked (Pro only).',
      'Workshop tools and film resources that help you make films will be locked (Pro only).',
    ];
  }, [context]);

  const refreshBillingState = async () => {
    invalidateMembershipCache();

    const refreshedBilling = (await getMySubscriptionStatus()) as BillingSnapshot;
    const derivedTier = getDerivedTierFromBilling(refreshedBilling);

    setBillingState(refreshedBilling);
    setCurrentTier(derivedTier);
    setSelectedTier(derivedTier);
    setPeriodEndIso(
      refreshedBilling.current_period_end ??
        refreshedBilling.accessEndsAt ??
        refreshedBilling.premium_access_expires_at ??
        null
    );
    setCancelAtPeriodEnd(Boolean(refreshedBilling.cancel_at_period_end));

    return refreshedBilling;
  };

  const doUpgradeToPro = async () => {
    try {
      setUpgrading(true);
      setErrorText(null);
      setSuccessText(null);

      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!userRes?.user?.id) throw new Error('Not signed in');

      invalidateMembershipCache();
      if (onSelectPro) onSelectPro();

      onClose();
      nav.navigate('Paywall', { context: context === 'extra_submission' ? 'challenge' : context });
    } catch (err: any) {
      console.log('UpgradeModal upgrade start error', err?.message || err);
      setErrorText(err?.message || 'Could not start checkout');
    } finally {
      setUpgrading(false);
    }
  };

  const openDowngradeConfirm = () => {
    setDowngradeConfirmError(null);
    setSuccessText(null);
    setDowngradeConfirmVisible(true);
  };

  const handleFreeTierPress = async () => {
    setErrorText(null);
    setSuccessText(null);
    setSelectedTier('free');

    if (isActuallyPro) {
      openDowngradeConfirm();
      return;
    }

    if (currentTier === 'free' && billingState) return;

    try {
      const latestBilling = await refreshBillingState();
      const latestTier = getDerivedTierFromBilling(latestBilling);

      if (latestTier === 'pro') {
        setSelectedTier('free');
        openDowngradeConfirm();
      }
    } catch (err: any) {
      console.log('UpgradeModal free tier check error', err?.message || err);
      setErrorText('Could not check your membership. Try again.');
    }
  };

  const doDowngradeToFree = async () => {
    try {
      setDowngrading(true);
      setDowngradeConfirmError(null);
      setSuccessText(null);

      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!userRes?.user?.id) throw new Error('Not signed in');

      const latestBilling = (await getMySubscriptionStatus()) as BillingSnapshot;
      setBillingState(latestBilling);
      setPeriodEndIso(
        latestBilling.current_period_end ??
          latestBilling.accessEndsAt ??
          latestBilling.premium_access_expires_at ??
          null
      );
      setCancelAtPeriodEnd(Boolean(latestBilling.cancel_at_period_end));

      if (latestBilling.isGrandfathered) {
        setDowngradeConfirmError(
          "This account has grandfathered Pro access. There isn't a monthly renewal to cancel."
        );
        return;
      }

      const hasCancelableSubscription =
        latestBilling.isActiveSubscriber ||
        latestBilling.inCancelGracePeriod ||
        Boolean((latestBilling as any).hasPaymentProviderSubscriptionRecord) ||
        Boolean(latestBilling.stripe_subscription_id) ||
        Boolean(latestBilling.stripe_customer_id);

      if (!hasCancelableSubscription && Platform.OS === 'web') {
        setDowngradeConfirmError(
          'No active monthly renewal was found for this account.'
        );
        return;
      }

      const { data: fnData, error: fnError } = await supabase.functions.invoke(
        'cancel-subscription',
        { body: {} }
      );

      if (fnError) throw fnError;

      const result = (fnData ?? {}) as CancelSubscriptionResponse;

      if (result?.ok === false) {
        throw new Error(result?.error || result?.message || 'Could not cancel renewal');
      }

      if (result?.action === 'manage_external') {
        const refreshedBilling = await refreshBillingState();
        const latestEnd =
          result?.period_end ??
          refreshedBilling.current_period_end ??
          refreshedBilling.accessEndsAt ??
          refreshedBilling.premium_access_expires_at ??
          null;
        const latestEndLabel = latestEnd ? formatEndDate(latestEnd) : null;

        if (result?.cancel_at_period_end) {
          setDowngradeConfirmVisible(false);
          setSuccessText(
            latestEndLabel
              ? `Your renewal is cancelled. You’ll keep Pro, including up to 3 showreels, until ${latestEndLabel}. After that, Pro features will end.`
              : 'Your renewal is cancelled. You’ll keep Pro, including up to 3 showreels, until the end of your billing period. After that, Pro features will end.'
          );
          return;
        }

        const opened = await openProviderManagementUrl(
          result?.management_url ?? null,
          result?.store ?? null
        );

        const externalMessage =
          result?.message ||
          (opened
            ? 'Your subscription is managed by your mobile app store. We opened the store management page so you can cancel renewal there.'
            : 'Your subscription is managed by your mobile app store. Please cancel renewal in Google Play or the App Store.');

        setDowngradeConfirmError(externalMessage);
        return;
      }

      const refreshedBilling = await refreshBillingState();
      const latestEnd =
        result?.period_end ??
        refreshedBilling.current_period_end ??
        refreshedBilling.accessEndsAt ??
        refreshedBilling.premium_access_expires_at ??
        null;
      const latestEndLabel = latestEnd ? formatEndDate(latestEnd) : null;

      setDowngradeConfirmVisible(false);
      setSuccessText(
        latestEndLabel
          ? `Your renewal has been cancelled. You’ll keep Pro, including up to 3 showreels, until ${latestEndLabel}. After that, Pro features will end.`
          : 'Your renewal has been cancelled. You’ll keep Pro, including up to 3 showreels, until the end of your billing period. After that, Pro features will end.'
      );
    } catch (err: any) {
      console.log('UpgradeModal downgrade error', err?.message || err);
      setDowngradeConfirmError(err?.message || 'Downgrade failed');
    } finally {
      setDowngrading(false);
    }
  };

  const doKeepPro = async () => {
    try {
      setRestoringPro(true);
      setErrorText(null);
      setSuccessText(null);
      setDowngradeConfirmError(null);

      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!userRes?.user?.id) throw new Error('Not signed in');

      const latestBilling = (await getMySubscriptionStatus()) as BillingSnapshot;
      setBillingState(latestBilling);
      setPeriodEndIso(
        latestBilling.current_period_end ??
          latestBilling.accessEndsAt ??
          latestBilling.premium_access_expires_at ??
          null
      );
      setCancelAtPeriodEnd(Boolean(latestBilling.cancel_at_period_end));

      if (latestBilling.isGrandfathered) {
        setSuccessText('Your Pro access is already active.');
        setDowngradeConfirmVisible(false);
        return;
      }

      if (!latestBilling.cancel_at_period_end) {
        const refreshed = await refreshBillingState();
        const derivedTier = getDerivedTierFromBilling(refreshed);
        if (derivedTier === 'pro') {
          setSuccessText('Your Pro subscription is already active.');
        } else {
          setSuccessText('Your Pro subscription is already set to continue.');
        }
        setDowngradeConfirmVisible(false);
        return;
      }

      const { data: fnData, error: fnError } = await supabase.functions.invoke(
        'resume-subscription',
        { body: {} }
      );

      if (fnError) throw fnError;

      const result = (fnData ?? {}) as ResumeSubscriptionResponse;

      if (result?.ok === false) {
        throw new Error(result?.error || result?.message || 'Could not keep Pro');
      }

      if (result?.action === 'manage_external') {
        const refreshedBilling = await refreshBillingState();

        if (!result?.cancel_at_period_end) {
          setDowngradeConfirmVisible(false);
          setSuccessText('Your cancellation was removed. Your Pro subscription will continue.');
          return;
        }

        const opened = await openProviderManagementUrl(
          result?.management_url ?? null,
          result?.store ?? null
        );

        const externalMessage =
          result?.message ||
          (opened
            ? 'Your subscription is managed by your mobile app store. We opened the store management page so you can turn renewal back on there.'
            : 'Your subscription is managed by your mobile app store. Please turn renewal back on in Google Play or the App Store.');

        setDowngradeConfirmError(externalMessage);
        setPeriodEndIso(
          result?.period_end ??
            refreshedBilling.current_period_end ??
            refreshedBilling.accessEndsAt ??
            refreshedBilling.premium_access_expires_at ??
            null
        );
        return;
      }

      await refreshBillingState();

      setDowngradeConfirmVisible(false);
      setSuccessText('Your cancellation was removed. Your Pro subscription will continue.');
    } catch (err: any) {
      console.log('UpgradeModal keep pro error', err?.message || err);
      const msg = err?.message || 'Could not keep Pro';
      setErrorText(msg);
      setDowngradeConfirmError(msg);
    } finally {
      setRestoringPro(false);
    }
  };

  const ctaLabel =
    isActuallyPro && cancelAtPeriodEnd
      ? restoringPro
        ? 'Cancelling cancellation…'
        : 'Cancel cancellation'
      : isProDisabled
      ? "You're on Pro"
      : upgrading
      ? 'Opening checkout…'
      : `Unlock Pro — ${SUBSCRIPTION_PRICE_FALLBACK}/month`;

  const horizontalPad = isMobile ? 10 : 20;
  const verticalPadTop = Math.max(insets.top + 8, 14);
  const verticalPadBottom = Math.max(insets.bottom + 8, 14);

  const cardMaxHeight = Math.min(
    height - verticalPadTop - verticalPadBottom,
    isMobile ? 700 : 820
  );

  const confirmIntroText = isGrandfathered
    ? 'This account has grandfathered Pro access. There is no monthly renewal to cancel.'
    : cancelAtPeriodEnd
    ? `Your Pro renewal is already cancelled.${
        endDateLabel
          ? ` You’ll keep Pro, including up to 3 showreels, until ${endDateLabel}, then switch to Free.`
          : ` You’ll keep Pro, including up to 3 showreels, until the end of your current billing period.`
      }`
    : `Your Pro subscription will be cancelled so you won’t be charged again.${
        endDateLabel
          ? ` You’ll keep Pro, including up to 3 showreels, until ${endDateLabel}, then switch to Free.`
          : ` You’ll keep Pro, including up to 3 showreels, until the end of your current billing period.`
      }`;

  const confirmPrimaryButtonLabel = isGrandfathered
    ? 'Close'
    : downgrading
    ? 'Cancelling…'
    : cancelAtPeriodEnd
    ? 'Cancellation scheduled'
    : 'Cancel renewal';

  const confirmCancelDisabled =
    downgrading ||
    restoringPro ||
    isGrandfathered ||
    cancelAtPeriodEnd ||
    (!canCancelRenewal && Platform.OS === 'web');

  const confirmCancelLabel = isGrandfathered
    ? 'No renewal to cancel'
    : cancelAtPeriodEnd
    ? 'Cancellation scheduled'
    : !canCancelRenewal && Platform.OS === 'web'
    ? 'No active renewal found'
    : Platform.OS === 'ios'
    ? 'Manage in Apple'
    : Platform.OS === 'android'
    ? 'Manage in Google Play'
    : confirmPrimaryButtonLabel;

  const modalSurface = colors.card;
  const modalSoftSurface = colors.backgroundAlt;
  const modalMutedSurface = isLight ? colors.mutedCard : SURFACE;
  const proSurface = isLight ? '#F6ECD8' : SURFACE_2;
  const proBadgeSurface = isLight ? '#E7D6B4' : '#211C13';
  const proAccentText = colors.accent;
  const membershipText = colors.textPrimary;
  const membershipSubText = colors.textSecondary;
  const membershipMutedText = colors.textMuted;

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={onClose}
        presentationStyle="overFullScreen"
        statusBarTranslucent
      >
        <View
          style={[
            styles.backdrop,
            { backgroundColor: colors.overlay },
            {
              paddingTop: verticalPadTop,
              paddingBottom: verticalPadBottom,
              paddingHorizontal: horizontalPad,
            },
          ]}
        >
          <Pressable
            pointerEvents={downgradeConfirmVisible ? 'none' : 'auto'}
            style={styles.modalDismissLayer}
            onPress={onClose}
          />

          <Pressable
            onPress={() => {}}
            style={[
              styles.card,
              { maxHeight: cardMaxHeight },
              {
                backgroundColor: modalSurface,
                borderColor: colors.border,
                shadowColor: colors.shadow,
              },
              isDesktopWeb && styles.cardDesktop,
              isMobile && styles.cardMobile,
              downgradeConfirmVisible && styles.cardBehindConfirm,
            ]}
          >
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.cardScrollContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View style={styles.topBar}>
                <View style={styles.logoCluster}>
                  <Text style={[styles.brandText, { color: membershipMutedText }]}>OVERLOOKED PRO</Text>
                  <Text style={[styles.kicker, { color: colors.primary }]}>CREATOR TOOLKIT</Text>
                </View>

                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={onClose}
                  style={[styles.closeButton, { backgroundColor: modalSoftSurface, borderColor: colors.border }]}
                  disabled={upgrading || downgrading || restoringPro}
                >
                  <Text style={[styles.closeText, { color: membershipSubText }]}>×</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.heroBlock}>
                <View
                  style={[
                    styles.heroBadge,
                    { backgroundColor: modalSoftSurface, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.heroBadgeText, { color: colors.primary }]}>
                    OVERLOOKED PRO
                  </Text>
                </View>
                <Text
                  style={[
                    styles.title,
                    { color: membershipText },
                    isDesktopWeb && styles.titleDesktop,
                  ]}
                >
                  {title}
                </Text>
                <Text
                  style={[
                    styles.subtitle,
                    { color: membershipSubText },
                    isDesktopWeb && styles.subtitleDesktop,
                  ]}
                >
                  {subtitle}
                </Text>
                <Text
                  style={[
                    styles.emotionalLine,
                    { color: membershipMutedText },
                    isDesktopWeb && styles.emotionalLineDesktop,
                  ]}
                >
                  Built for creators who are ready to stop waiting and start making.
                </Text>

                <View style={styles.metaRow}>
                  {currentTier ? (
                    <View style={[styles.metaPill, { backgroundColor: modalSoftSurface, borderColor: colors.border }]}>
                      <Text style={[styles.metaLabel, { color: membershipMutedText }]}>Current</Text>
                      <Text style={[styles.metaValue, { color: membershipText }]}>{currentTierLabel}</Text>
                    </View>
                  ) : null}

                  {!offerCountdown.expired ? (
                    <View style={[styles.metaPill, styles.offerPill, { backgroundColor: isLight ? '#F4E7CB' : GOLD_SOFT, borderColor: colors.borderStrong }]}>
                      <Text style={[styles.metaLabel, { color: colors.primary }]}>Offer</Text>
                      <Text style={[styles.metaValue, { color: membershipText }]}>{offerCountdown.short}</Text>
                    </View>
                  ) : null}

                  {isActuallyPro && cancelAtPeriodEnd && endDateLabel ? (
                    <View style={[styles.metaPill, { backgroundColor: modalSoftSurface, borderColor: colors.border }]}>
                      <Text style={[styles.metaLabel, { color: membershipMutedText }]}>Cancels</Text>
                      <Text style={[styles.metaValue, { color: membershipText }]}>{endDateLabel}</Text>
                    </View>
                  ) : null}
                </View>
              </View>

              {isActuallyPro && cancelAtPeriodEnd ? (
                <View style={[styles.countdownBanner, { backgroundColor: isLight ? '#F7EDDC' : WARNING_BG, borderColor: colors.borderStrong }]}>
                  <View style={styles.countdownBannerTopRow}>
                    <Text style={[styles.countdownPill, { color: colors.primary }]}>CANCELLATION SCHEDULED</Text>
                    {cancelCountdown.short ? (
                      <Text style={[styles.countdownDays, { color: membershipText }]}>{cancelCountdown.short}</Text>
                    ) : null}
                  </View>

                  <Text style={[styles.countdownTitle, { color: membershipText }]}>
                    {endDateLabel
                      ? `Pro ends on ${endDateLabel}`
                      : 'Pro returns to Free at the end of your billing period'}
                  </Text>

                  <View style={[styles.inlineActionRow, isMobile && styles.inlineActionRowMobile]}>
                    <TouchableOpacity
                      activeOpacity={0.92}
                      onPress={restoringPro ? undefined : doKeepPro}
                      style={[
                        styles.inlineActionBtn,
                        styles.inlineActionPrimary,
                        restoringPro && styles.buttonDisabled,
                      ]}
                      disabled={restoringPro}
                    >
                      {restoringPro ? (
                        <ActivityIndicator size="small" color="#0B0B0B" />
                      ) : (
                        <Text style={styles.inlineActionPrimaryText}>Cancel cancellation</Text>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      activeOpacity={0.92}
                      onPress={() => setDowngradeConfirmVisible(true)}
                      style={[styles.inlineActionBtn, styles.inlineActionSecondary, { backgroundColor: modalSoftSurface, borderColor: colors.border }]}
                      disabled={restoringPro}
                    >
                      <Text style={[styles.inlineActionSecondaryText, { color: membershipText }]}>View cancellation</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}

              {successText ? (
                <View style={[styles.successBanner, { backgroundColor: isLight ? '#EAF7EE' : SUCCESS_BG, borderColor: isLight ? '#BBD7C4' : SUCCESS_BORDER }]}>
                  <Text style={[styles.successBannerText, { color: membershipText }]}>{successText}</Text>
                </View>
              ) : null}

              {errorText ? <Text style={[styles.errorText, { color: isLight ? '#9B2C2C' : '#FFB3B3' }]}>{errorText}</Text> : null}

              <View style={[styles.tiersStack, isDesktopWeb && styles.tiersStackDesktop]}>
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={handleFreeTierPress}
                  style={[
                    styles.compactTier,
                    styles.freeCompact,
                    { backgroundColor: modalMutedSurface, borderColor: colors.border },
                    selectedTier === 'free' && [
                      styles.tierCardSelected,
                      isLight && { borderColor: colors.borderStrong },
                    ],
                    !isActuallyPro && styles.tierCardCurrentFree,
                    isDesktopWeb && styles.compactTierDesktop,
                  ]}
                >
                  <View style={styles.compactTierLeft}>
                    <Text style={[styles.tierSmallLabel, { color: colors.primary }]}>FREE</Text>
                    <Text style={[styles.compactTierName, { color: membershipText }]}>
                      Explore the community
                    </Text>
                    <Text style={[styles.compactTierSub, { color: membershipSubText }]}>
                      Browse creators, watch films, and connect with other creatives.
                    </Text>
                    <Text style={[styles.compactTierLimit, { color: membershipMutedText }]}>
                      Good for discovering Overlooked. Limited for creating.
                    </Text>
                  </View>

                  <View style={styles.compactTierRight}>
                    <Text style={[styles.compactPrice, { color: membershipText }]}>FREE</Text>
                    <Text style={[styles.compactPriceSub, { color: membershipMutedText }]}>forever</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.92}
                  onPress={() => {
                    setErrorText(null);
                    setSuccessText(null);
                    setSelectedTier('pro');
                  }}
                  style={[
                    styles.proTier,
                    { backgroundColor: proSurface, borderColor: colors.borderStrong },
                    selectedTier === 'pro' && [
                      styles.tierCardSelectedPro,
                      isLight && {
                        backgroundColor: '#F4E7CB',
                        borderColor: '#C9A45C',
                      },
                    ],
                    isActuallyPro && [
                      styles.tierCardCurrentPro,
                      isLight && {
                        shadowColor: colors.shadow,
                        shadowOpacity: 0.16,
                      },
                    ],
                    isDesktopWeb && styles.proTierDesktop,
                  ]}
                >
                  <View style={styles.proHeader}>
                    <View style={styles.compactTierLeft}>
                      <Text style={[styles.tierSmallLabelGold, { color: proAccentText }]}>PRO</Text>
                      <View
                        style={[
                          styles.bestForBadge,
                          { backgroundColor: isLight ? '#E8D6B3' : GOLD_SOFT },
                        ]}
                      >
                        <Text style={[styles.bestForText, { color: proAccentText }]}>
                          Best for serious creators
                        </Text>
                      </View>
                      <Text style={[styles.proTitle, { color: membershipText }]}>
                        Everything you need to grow as a filmmaker
                      </Text>
                      <Text style={[styles.compactTierSub, { color: membershipSubText }]}>
                        Submit films, build your public portfolio, apply for paid roles, and unlock guided filmmaking tools.
                      </Text>
                    </View>

                    <View style={[styles.priceBadge, { backgroundColor: proBadgeSurface, borderColor: colors.borderStrong }]}>
                      <Text style={[styles.planKickerHero, { color: proAccentText }]}>MONTHLY</Text>
                      <View style={styles.planPriceRow}>
                        <Text style={[styles.planCurrency, { color: membershipText }]}>
                          {SUBSCRIPTION_PRICE_CURRENCY_SYMBOL}
                        </Text>
                        <Text style={[styles.planPriceHero, { color: membershipText }]}>
                          {SUBSCRIPTION_PRICE_AMOUNT}
                        </Text>
                      </View>
                      <Text style={[styles.planSubHero, { color: membershipSubText }]}>per month</Text>
                    </View>
                  </View>

                  <Text style={[styles.valueLine, { color: membershipSubText }]}>
                    Less than one coffee a month.
                  </Text>

                  <View style={styles.featureGrid}>
                    <Text style={[styles.featureItem, { color: membershipSubText }]}>✓ Monthly Film Challenge uploads</Text>
                    <Text style={[styles.featureItem, { color: membershipSubText }]}>✓ Up to 3 profile showreels</Text>
                    <Text style={[styles.featureItem, { color: membershipSubText }]}>✓ Paid job applications</Text>
                    <Text style={[styles.featureItem, { color: membershipSubText }]}>✓ Full Filmmaking Bootcamp</Text>
                    <Text style={[styles.featureItem, { color: membershipSubText }]}>✓ Workshop tools and film resources</Text>
                    <Text style={[styles.featureItem, { color: membershipSubText }]}>✓ Focused lessons and exercises</Text>
                    <Text style={[styles.featureItem, { color: membershipSubText }]}>✓ Plan, develop, and make films</Text>
                  </View>

                  <View style={[styles.proCardCta, { backgroundColor: colors.primary }]}>
                    <Text style={[styles.proCardCtaText, { color: colors.textOnPrimary }]}>
                      Unlock Pro — {SUBSCRIPTION_PRICE_FALLBACK}/month
                    </Text>
                  </View>
                  <Text style={[styles.cancelAnytimeText, { color: membershipMutedText }]}>
                    Cancel anytime.
                  </Text>
                </TouchableOpacity>
              </View>

              <View
                style={[
                  styles.comparisonBox,
                  { backgroundColor: modalSoftSurface, borderColor: colors.border },
                ]}
              >
                <View style={styles.comparisonHeader}>
                  <Text style={[styles.comparisonTitle, { color: membershipText }]}>Free vs Pro</Text>
                  <View style={styles.comparisonStatusGroup}>
                    <Text style={[styles.comparisonColumnHeader, { color: membershipMutedText }]}>
                      Free
                    </Text>
                    <Text style={[styles.comparisonColumnHeader, { color: colors.primary }]}>
                      Pro
                    </Text>
                  </View>
                </View>

                {GENERAL_COMPARISON_ROWS.map((row) => {
                  const freeLocked = row.free === '✕';
                  const proStrong = row.pro.startsWith('✓');

                  return (
                    <View
                      key={row.feature}
                      style={[styles.comparisonRow, { borderTopColor: colors.border }]}
                    >
                      <Text
                        style={[styles.comparisonFeature, { color: membershipSubText }]}
                      >
                        {row.feature}
                      </Text>
                      <View style={styles.comparisonStatusGroup}>
                        <View
                          style={[
                            styles.statusPill,
                            {
                              backgroundColor: freeLocked
                                ? 'rgba(143,133,120,0.12)'
                                : isLight
                                ? '#EAF4EC'
                                : 'rgba(72,180,113,0.13)',
                              borderColor: freeLocked
                                ? colors.border
                                : isLight
                                ? '#BCD9C2'
                                : 'rgba(72,180,113,0.28)',
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.statusText,
                              {
                                color: freeLocked
                                  ? membershipMutedText
                                  : isLight
                                  ? '#2F7A48'
                                  : '#72D188',
                              },
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
                                ? isLight
                                  ? '#EAF4EC'
                                  : 'rgba(72,180,113,0.13)'
                                : 'rgba(198,166,100,0.12)',
                              borderColor: proStrong
                                ? isLight
                                  ? '#BCD9C2'
                                  : 'rgba(72,180,113,0.28)'
                                : colors.borderStrong,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.statusText,
                              {
                                color: proStrong
                                  ? isLight
                                    ? '#2F7A48'
                                    : '#72D188'
                                  : colors.primary,
                              },
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
                  { backgroundColor: isLight ? '#F6ECD8' : '#15120D', borderColor: colors.borderStrong },
                ]}
              >
                <Text style={[styles.finalCtaTitle, { color: membershipText }]}>
                  Ready to start making films?
                </Text>
                <Text style={[styles.finalCtaSub, { color: membershipSubText }]}>
                  Unlock the tools, uploads, and opportunities built for serious creators.
                </Text>
              </View>

              <TouchableOpacity
                style={[
                  styles.buttonBase,
                  styles.proButton,
                  ((selectedTier !== 'pro' && !canKeepPro) ||
                    (isProDisabled && !canKeepPro) ||
                    upgrading ||
                    restoringPro) &&
                    styles.buttonDisabled,
                ]}
                onPress={
                  canKeepPro
                    ? doKeepPro
                    : selectedTier !== 'pro' || isProDisabled || upgrading || restoringPro
                    ? undefined
                    : doUpgradeToPro
                }
                activeOpacity={
                  selectedTier !== 'pro' || (isProDisabled && !canKeepPro) || upgrading || restoringPro
                    ? 1
                    : 0.92
                }
              >
                <Text
                  style={[
                    styles.buttonText,
                    ((selectedTier !== 'pro' && !canKeepPro) ||
                      (isProDisabled && !canKeepPro) ||
                      upgrading ||
                      restoringPro) &&
                      styles.buttonTextDisabled,
                  ]}
                >
                  {ctaLabel}
                </Text>
              </TouchableOpacity>

              <Text style={[styles.reassuranceText, { color: membershipMutedText }]}>
                Cancel anytime. Auto-renews monthly.
              </Text>

              <View style={[styles.subscriptionInfoBox, { backgroundColor: modalSoftSurface, borderColor: colors.border }]}>
                <Text style={[styles.subscriptionInfoTitle, { color: membershipText }]}>{SUBSCRIPTION_TITLE}</Text>
                <Text style={[styles.subscriptionInfoText, { color: membershipSubText }]}>
                  Auto-renewable monthly subscription. {SUBSCRIPTION_PRICE_FALLBACK} per month. Payment is handled through the checkout method you choose. Your subscription renews automatically unless cancelled before the end of the current period. You can manage or cancel anytime from this membership screen or your payment provider.
                </Text>
                <View style={styles.legalLinksRow}>
                  <TouchableOpacity onPress={() => openLegalUrl(TERMS_OF_USE_URL)}>
                    <Text style={[styles.legalLinkText, { color: colors.primary }]}>Terms of Use</Text>
                  </TouchableOpacity>
                  <Text style={[styles.legalDivider, { color: membershipMutedText }]}>•</Text>
                  <TouchableOpacity onPress={() => openLegalUrl(PRIVACY_POLICY_URL)}>
                    <Text style={[styles.legalLinkText, { color: colors.primary }]}>Privacy Policy</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity
                onPress={onClose}
                style={styles.laterButton}
                disabled={upgrading || downgrading || restoringPro}
              >
                <Text style={styles.laterText}>Maybe later</Text>
              </TouchableOpacity>
            </ScrollView>
          </Pressable>

          {downgradeConfirmVisible ? (
            <View
              pointerEvents="box-none"
              style={[
                styles.confirmOverlay,
                { backgroundColor: colors.overlay },
                {
                  paddingTop: verticalPadTop,
                  paddingBottom: verticalPadBottom,
                  paddingHorizontal: horizontalPad,
                },
              ]}
            >
              <Pressable
                style={styles.modalDismissLayer}
                onPress={() => {
                  if (!downgrading && !restoringPro) setDowngradeConfirmVisible(false);
                }}
              />

              <Pressable
                onPress={() => {}}
                style={[
                  styles.confirmCard,
                  { maxHeight: Math.min(height - verticalPadTop - verticalPadBottom, 620) },
                  { backgroundColor: modalSurface, borderColor: colors.border, shadowColor: colors.shadow },
                  isMobile && styles.confirmCardMobile,
                ]}
              >
                <ScrollView
                  style={styles.scroll}
                  contentContainerStyle={styles.confirmScrollContent}
                  showsVerticalScrollIndicator={false}
                  bounces={false}
                >
                  <Text style={[styles.confirmTitle, { color: membershipText }]}>
                    {isGrandfathered
                      ? 'Pro access'
                      : cancelAtPeriodEnd
                      ? 'Cancellation scheduled'
                      : 'Cancel renewal?'}
                  </Text>

                  <Text style={[styles.confirmSub, { color: membershipSubText }]}>{confirmIntroText}</Text>

                  {!isGrandfathered && cancelAtPeriodEnd ? (
                    <View style={[styles.confirmStatusCard, { backgroundColor: modalSoftSurface, borderColor: colors.border }]}>
                      <Text style={[styles.confirmStatusLabel, { color: colors.primary }]}>
                        {cancelCountdown.short || 'Scheduled'}
                      </Text>
                      <Text style={[styles.confirmStatusBody, { color: membershipSubText }]}>
                        {endDateLabel
                          ? `You’ll stay on Pro, including up to 3 showreels, until ${endDateLabel}. After that, Pro features end and your account returns to Free.`
                          : 'You’ll stay on Pro, including up to 3 showreels, until the end of your current billing period. After that, Pro features end and your account returns to Free.'}
                      </Text>
                    </View>
                  ) : null}

                  {!isGrandfathered ? (
                    <View style={styles.confirmList}>
                      <Text style={[styles.confirmItem, { color: membershipSubText }]}>After Pro ends, you’ll lose access to:</Text>
                      {downgradeLossBullets.map((t, idx) => (
                        <Text key={`${idx}-${t}`} style={[styles.confirmItem, { color: membershipSubText }]}>
                          • {t}
                        </Text>
                      ))}
                    </View>
                  ) : null}

                  {downgradeConfirmError ? (
                    <Text style={[styles.errorText, { color: isLight ? '#9B2C2C' : '#FFB3B3' }]}>{downgradeConfirmError}</Text>
                  ) : null}

                  <View style={[styles.confirmButtonsRow, isMobile && styles.confirmButtonsRowMobile]}>
                    <Pressable
                      disabled={downgrading || restoringPro}
                      onPress={
                        isGrandfathered
                          ? () => setDowngradeConfirmVisible(false)
                          : cancelAtPeriodEnd
                          ? doKeepPro
                          : () => setDowngradeConfirmVisible(false)
                      }
                      style={({ pressed }) => [
                        styles.confirmBtn,
                        styles.confirmBtnGhost,
                        { backgroundColor: modalSoftSurface, borderColor: colors.border },
                        pressed && !downgrading && !restoringPro ? { opacity: 0.9 } : null,
                        downgrading || restoringPro ? { opacity: 0.5 } : null,
                      ]}
                    >
                      <View style={styles.confirmDangerInner}>
                        {restoringPro && cancelAtPeriodEnd ? (
                          <ActivityIndicator size="small" color={TEXT_IVORY} />
                        ) : null}
                        <Text style={[styles.confirmBtnGhostText, { color: membershipText }]}>
                          {isGrandfathered ? 'Done' : cancelAtPeriodEnd ? 'Cancel cancellation' : 'Keep Pro'}
                        </Text>
                      </View>
                    </Pressable>

                    <Pressable
                      disabled={confirmCancelDisabled}
                      onPress={isGrandfathered || cancelAtPeriodEnd ? undefined : doDowngradeToFree}
                      style={({ pressed }) => [
                        styles.confirmBtn,
                        styles.confirmBtnDanger,
                        confirmCancelDisabled && styles.buttonDisabled,
                        pressed &&
                        !downgrading &&
                        !restoringPro &&
                        !isGrandfathered &&
                        (canCancelRenewal || Platform.OS !== 'web') &&
                        !cancelAtPeriodEnd
                          ? { opacity: 0.9 }
                          : null,
                        downgrading || restoringPro ? { opacity: 0.7 } : null,
                      ]}
                    >
                      <View style={styles.confirmDangerInner}>
                        {downgrading && !isGrandfathered && !cancelAtPeriodEnd ? (
                          <ActivityIndicator size="small" color="#0B0B0B" />
                        ) : null}
                        <Text
                          style={[
                            styles.confirmBtnDangerText,
                            confirmCancelDisabled && styles.buttonTextDisabled,
                          ]}
                        >
                          {confirmCancelLabel}
                        </Text>
                      </View>
                    </Pressable>
                  </View>

                  <Text style={[styles.confirmFoot, { color: membershipMutedText }]}>
                    {isGrandfathered
                      ? 'Your Pro access remains active.'
                      : cancelAtPeriodEnd
                      ? 'You can cancel the cancellation any time before the period ends.'
                      : 'Tip: you can re-subscribe any time.'}
                  </Text>
                </ScrollView>
              </Pressable>
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.90)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  modalDismissLayer: {
    ...StyleSheet.absoluteFillObject,
  },

  confirmOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.54)',
  },

  cardBehindConfirm: {
    opacity: 0.45,
  },

  scroll: {
    flexGrow: 0,
    width: '100%',
  },

  card: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    borderRadius: 28,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: DARK_ELEVATED,
    borderWidth: 1,
    borderColor: HAIRLINE,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
    elevation: 16,
  },

  cardDesktop: {
    maxWidth: 760,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },

  cardMobile: {
    maxWidth: 356,
    borderRadius: 26,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },

  cardScrollContent: {
    paddingBottom: 4,
    flexGrow: 1,
  },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    minHeight: 30,
  },

  logoCluster: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 30,
  },

  brandText: {
    color: 'rgba(241,239,232,0.38)',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2.4,
    fontFamily: SYSTEM_SANS,
    textAlign: 'center',
  },

  closeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: HAIRLINE_2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  closeText: {
    color: TEXT_MUTED,
    fontSize: 20,
    lineHeight: 22,
    fontWeight: '700',
    fontFamily: SYSTEM_SANS,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },

  heroBlock: {
    marginBottom: 9,
    alignItems: 'center',
  },

  heroBadge: {
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderWidth: 1,
    marginBottom: 8,
  },

  heroBadgeText: {
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },

  kicker: {
    marginTop: 2,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.5,
    color: GOLD,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
    textAlign: 'center',
  },

  title: {
    fontSize: 21,
    lineHeight: 23,
    fontWeight: '900',
    color: TEXT_IVORY,
    marginBottom: 6,
    letterSpacing: -0.45,
    fontFamily: SYSTEM_SANS,
    textAlign: 'center',
  },

  titleDesktop: {
    fontSize: 25,
    lineHeight: 29,
  },

  subtitle: {
    fontSize: 11.5,
    color: TEXT_MUTED,
    lineHeight: 15,
    fontFamily: SYSTEM_SANS,
    textAlign: 'center',
    maxWidth: 310,
  },

  subtitleDesktop: {
    maxWidth: 620,
    fontSize: 12.6,
    lineHeight: 18,
  },

  emotionalLine: {
    marginTop: 6,
    fontSize: 10.8,
    lineHeight: 14,
    fontFamily: SYSTEM_SANS,
    textAlign: 'center',
    maxWidth: 310,
  },

  emotionalLineDesktop: {
    maxWidth: 620,
  },

  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: 9,
  },

  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: 1,
    borderColor: HAIRLINE_2,
  },

  offerPill: {
    backgroundColor: GOLD_SOFT,
    borderColor: 'rgba(198,166,100,0.22)',
  },

  metaLabel: {
    color: TEXT_MUTED_2,
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },

  metaValue: {
    color: TEXT_IVORY,
    fontSize: 11,
    fontWeight: '900',
    fontFamily: SYSTEM_SANS,
  },

  currentTierText: {
    fontSize: 12,
    color: TEXT_MUTED,
    marginBottom: 14,
    fontFamily: SYSTEM_SANS,
  },

  currentTierName: {
    color: GOLD,
    fontWeight: '900',
  },

  countdownBanner: {
    marginBottom: 10,
    borderRadius: 18,
    paddingVertical: 11,
    paddingHorizontal: 12,
    backgroundColor: WARNING_BG,
    borderWidth: 1,
    borderColor: WARNING_BORDER,
  },

  countdownBannerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 5,
    flexWrap: 'wrap',
  },

  countdownPill: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: GOLD,
    fontFamily: SYSTEM_SANS,
  },

  countdownDays: {
    fontSize: 11,
    fontWeight: '900',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },

  countdownTitle: {
    fontSize: 12.5,
    fontWeight: '900',
    color: TEXT_IVORY,
    marginBottom: 2,
    fontFamily: SYSTEM_SANS,
  },

  countdownText: {
    fontSize: 11,
    lineHeight: 15,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },

  inlineActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 9,
  },

  inlineActionRowMobile: {
    flexDirection: 'row',
  },

  inlineActionBtn: {
    flex: 1,
    minHeight: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },

  inlineActionPrimary: {
    backgroundColor: GOLD,
  },

  inlineActionSecondary: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: HAIRLINE,
  },

  inlineActionPrimaryText: {
    color: '#0B0B0B',
    fontWeight: '900',
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
  },

  inlineActionSecondaryText: {
    color: TEXT_IVORY,
    fontWeight: '900',
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
  },

  successBanner: {
    marginBottom: 8,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: SUCCESS_BG,
    borderWidth: 1,
    borderColor: SUCCESS_BORDER,
  },

  successBannerText: {
    color: TEXT_IVORY,
    fontSize: 11.5,
    lineHeight: 15,
    fontFamily: SYSTEM_SANS,
  },

  errorText: {
    fontSize: 11.5,
    color: '#FFB3B3',
    marginTop: 6,
    marginBottom: 6,
    fontFamily: SYSTEM_SANS,
  },

  tiersStack: {
    gap: 9,
    marginBottom: 10,
  },

  tiersStackDesktop: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
  },

  compactTier: {
    borderRadius: 18,
    paddingVertical: 11,
    paddingHorizontal: 12,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: HAIRLINE_2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  compactTierDesktop: {
    flex: 0.92,
    alignSelf: 'stretch',
  },

  freeCompact: {
    backgroundColor: 'rgba(255,255,255,0.035)',
  },

  compactTierLeft: {
    flex: 1,
    paddingRight: 10,
  },

  compactTierRight: {
    alignItems: 'flex-end',
  },

  tierSmallLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: 'rgba(198,166,100,0.62)',
    marginBottom: 3,
    fontFamily: SYSTEM_SANS,
  },

  tierSmallLabelGold: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: GOLD,
    marginBottom: 3,
    fontFamily: SYSTEM_SANS,
  },

  compactTierName: {
    fontSize: 15,
    fontWeight: '900',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },

  compactTierSub: {
    marginTop: 2,
    fontSize: 11,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
    lineHeight: 15,
  },

  compactTierLimit: {
    marginTop: 6,
    fontSize: 10.2,
    lineHeight: 13,
    color: TEXT_MUTED_2,
    fontFamily: SYSTEM_SANS,
  },

  compactPrice: {
    fontSize: 18,
    fontWeight: '900',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },

  compactPriceSub: {
    marginTop: 1,
    fontSize: 10,
    color: TEXT_MUTED_2,
    fontFamily: SYSTEM_SANS,
  },

  proTier: {
    borderRadius: 21,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: SURFACE_2,
    borderWidth: 1,
    borderColor: 'rgba(198,166,100,0.22)',
  },

  proTierDesktop: {
    flex: 1.35,
    alignSelf: 'stretch',
  },

  proHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },

  proTitle: {
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '900',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },

  bestForBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginBottom: 7,
  },

  bestForText: {
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },

  priceBadge: {
    minWidth: 104,
    borderRadius: 16,
    paddingVertical: 9,
    paddingHorizontal: 9,
    backgroundColor: '#211C13',
    borderWidth: 1,
    borderColor: OFFER_TILE_BORDER,
    justifyContent: 'center',
    alignItems: 'center',
  },

  featureGrid: {
    gap: 4,
  },

  valueLine: {
    marginTop: -4,
    marginBottom: 9,
    fontSize: 11,
    fontWeight: '800',
    fontFamily: SYSTEM_SANS,
  },

  featureItem: {
    fontSize: 10.4,
    lineHeight: 13.5,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },

  featureItemMuted: {
    fontSize: 11.5,
    lineHeight: 18,
    color: 'rgba(237,235,230,0.45)',
    fontFamily: SYSTEM_SANS,
  },

  proCardCta: {
    marginTop: 10,
    minHeight: 36,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },

  proCardCtaText: {
    fontSize: 12.5,
    fontWeight: '900',
    fontFamily: SYSTEM_SANS,
    textAlign: 'center',
  },

  cancelAnytimeText: {
    marginTop: 6,
    fontSize: 10.5,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },

  comparisonBox: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 10,
    marginBottom: 10,
  },

  comparisonHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },

  comparisonTitle: {
    fontSize: 14,
    fontWeight: '900',
    fontFamily: SYSTEM_SANS,
  },

  comparisonColumnHeader: {
    width: 72,
    fontSize: 10,
    fontWeight: '900',
    fontFamily: SYSTEM_SANS,
    textAlign: 'center',
  },

  comparisonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderTopWidth: 1,
    paddingVertical: 7,
  },

  comparisonFeature: {
    flex: 1,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: SYSTEM_SANS,
  },

  comparisonStatusGroup: {
    width: 152,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },

  statusPill: {
    width: 72,
    minHeight: 24,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },

  statusPillPro: {
    width: 72,
  },

  statusText: {
    fontSize: 10.2,
    fontWeight: '900',
    fontFamily: SYSTEM_SANS,
    textAlign: 'center',
  },

  finalCtaBox: {
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 10,
  },

  finalCtaTitle: {
    fontSize: 15,
    fontWeight: '900',
    fontFamily: SYSTEM_SANS,
    textAlign: 'center',
  },

  finalCtaSub: {
    marginTop: 4,
    fontSize: 11.5,
    lineHeight: 16,
    fontFamily: SYSTEM_SANS,
    textAlign: 'center',
  },

  reassuranceText: {
    marginTop: 7,
    fontSize: 11,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },

  subscriptionInfoBox: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: HAIRLINE_2,
    backgroundColor: 'rgba(255,255,255,0.035)',
    padding: 12,
    marginTop: 10,
    marginBottom: 10,
  },

  subscriptionInfoTitle: {
    fontSize: 12.5,
    color: TEXT_IVORY,
    fontWeight: '900',
    letterSpacing: 0.4,
    fontFamily: SYSTEM_SANS,
  },

  subscriptionInfoText: {
    marginTop: 6,
    fontSize: 11.5,
    lineHeight: 16,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },

  legalLinksRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },

  legalLinkText: {
    color: GOLD,
    fontSize: 12,
    fontWeight: '900',
    fontFamily: SYSTEM_SANS,
  },

  legalDivider: {
    color: TEXT_MUTED_2,
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
  },

  tierCardSelected: {
    borderColor: 'rgba(255,255,255,0.18)',
  },

  tierCardSelectedPro: {
    borderColor: 'rgba(198,166,100,0.42)',
    backgroundColor: '#1A1710',
  },

  tierCardCurrentFree: {
    borderColor: 'rgba(198,166,100,0.16)',
  },

  tierCardCurrentPro: {
    borderColor: 'rgba(198,166,100,0.46)',
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
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
  },

  planRowMobile: {
    flexWrap: 'wrap',
  },

  planTile: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0,
    minWidth: 96,
  },

  planTileTiny: {
    minWidth: '100%' as any,
  },

  planTileHero: {
    backgroundColor: OFFER_TILE_BG,
    borderWidth: 1,
    borderColor: OFFER_TILE_BORDER,
    paddingVertical: 10,
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
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: GOLD,
    fontFamily: SYSTEM_SANS,
  },

  planPriceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 1,
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
    fontSize: 24,
    fontWeight: '900',
    color: TEXT_IVORY,
    letterSpacing: -0.7,
    fontFamily: SYSTEM_SANS,
  },

  planSubHero: {
    marginTop: 2,
    fontSize: 10,
    color: 'rgba(237,235,230,0.70)',
    fontFamily: SYSTEM_SANS,
  },

  buttonBase: {
    marginTop: 0,
    paddingVertical: 13,
    borderRadius: 999,
  },

  proButton: {
    backgroundColor: GOLD,
  },

  buttonDisabled: {
    backgroundColor: '#333333',
  },

  buttonText: {
    color: '#000000',
    textAlign: 'center',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 0.2,
    fontFamily: SYSTEM_SANS,
  },

  buttonTextDisabled: {
    color: TEXT_MUTED,
  },

  laterButton: {
    marginTop: 8,
    paddingVertical: 4,
  },

  laterText: {
    textAlign: 'center',
    color: TEXT_MUTED,
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
  },

  confirmCard: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    borderRadius: 24,
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: DARK_ELEVATED,
    borderWidth: 1,
    borderColor: HAIRLINE,
    overflow: 'hidden',
  },

  confirmCardMobile: {
    maxWidth: 356,
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },

  confirmScrollContent: {
    paddingBottom: 4,
    flexGrow: 1,
  },

  confirmTitle: {
    fontSize: 19,
    fontWeight: '900',
    color: TEXT_IVORY,
    marginBottom: 8,
    fontFamily: SYSTEM_SANS,
  },

  confirmSub: {
    fontSize: 12.5,
    color: TEXT_MUTED,
    lineHeight: 17,
    marginBottom: 12,
    fontFamily: SYSTEM_SANS,
  },

  confirmStatusCard: {
    marginBottom: 12,
    borderRadius: 16,
    paddingVertical: 11,
    paddingHorizontal: 12,
    backgroundColor: WARNING_BG,
    borderWidth: 1,
    borderColor: WARNING_BORDER,
  },

  confirmStatusLabel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: GOLD,
    marginBottom: 5,
    fontFamily: SYSTEM_SANS,
  },

  confirmStatusBody: {
    fontSize: 12,
    lineHeight: 17,
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },

  confirmList: {
    gap: 5,
    marginBottom: 10,
  },

  confirmItem: {
    fontSize: 12,
    color: TEXT_IVORY,
    lineHeight: 17,
    fontFamily: SYSTEM_SANS,
  },

  confirmButtonsRow: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 12,
  },

  confirmButtonsRowMobile: {
    flexDirection: 'column',
  },

  confirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },

  confirmBtnGhost: {
    borderWidth: 1,
    borderColor: HAIRLINE,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },

  confirmBtnGhostText: {
    color: TEXT_IVORY,
    fontWeight: '900',
    fontSize: 13,
    fontFamily: SYSTEM_SANS,
  },

  confirmBtnDanger: {
    backgroundColor: GOLD,
    borderWidth: 1,
    borderColor: '#000000',
  },

  confirmDangerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  confirmBtnDangerText: {
    color: '#0B0B0B',
    fontWeight: '900',
    fontSize: 13,
    fontFamily: SYSTEM_SANS,
    letterSpacing: 0.2,
  },

  confirmFoot: {
    marginTop: 10,
    fontSize: 11.5,
    color: TEXT_MUTED,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },
});
