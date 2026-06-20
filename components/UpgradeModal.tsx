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
  SUBSCRIPTION_PRICE_AMOUNT,
  SUBSCRIPTION_PRICE_CURRENCY_SYMBOL,
  SUBSCRIPTION_PRICE_FALLBACK,
  SUBSCRIPTION_TITLE,
  TERMS_OF_USE_URL,
} from '../app/lib/legal';
import { useAppTheme } from '../app/context/ThemeContext';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import PrivacyPolicyModal from './PrivacyPolicyModal';

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
  { feature: 'Film uploads', free: '1', pro: 'Unlimited' },
  { feature: 'Profile showreels', free: '1', pro: '3' },
  { feature: 'Monthly Film Challenge', free: 'View', pro: 'Submit' },
  { feature: 'Creator Challenge submissions', free: 'View', pro: 'Unlimited' },
  { feature: 'Paid job applications', free: '✕', pro: '✓' },
  { feature: 'Filmmaking Bootcamp', free: '✕', pro: '✓' },
  { feature: 'Workshop tools', free: '✕', pro: '✓' },
];

const FREE_INCLUDED_FEATURES = [
  'Browse creators',
  'Connect with collaborators',
  'Upload 1 film',
  '1 profile showreel',
];

const FREE_LOCKED_FEATURES = [
  'More film uploads',
  'Challenge submissions',
  'Jobs, Bootcamp, and Workshop',
];

const PRO_HIGHLIGHTS = [
  'Unlimited film uploads',
  '3 profile showreels',
  'Monthly Film Challenge submissions',
  'Unlimited creator challenge submissions',
  'Exercises taken directly from film and acting schools',
  'Ever-growing filmmaking tools and resources',
];

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
  const [privacyPolicyVisible, setPrivacyPolicyVisible] = useState(false);

  const [periodEndIso, setPeriodEndIso] = useState<string | null>(null);
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState<boolean>(false);

  const [billingState, setBillingState] = useState<BillingSnapshot | null>(null);

  const [cancelCountdown, setCancelCountdown] = useState(() =>
    getCancellationCountdown(null)
  );

  useEffect(() => {
    if (!visible) setPrivacyPolicyVisible(false);
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
        setSelectedTier('pro');
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

  const title = 'Build your portfolio with Pro';
  const subtitle =
    'Share unlimited films, build a sharper portfolio, meet collaborators, and train with exercises taken directly from film and acting schools: the practical best parts, without the fluff.';

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
    setSelectedTier('pro');
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

  const handleFreeTierPress = () => {
    setErrorText(null);
    setSuccessText(null);

    if (!isActuallyPro) {
      setSelectedTier('pro');
      return;
    }

    setSelectedTier('free');
    openDowngradeConfirm();
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
    isMobile ? 720 : 880
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

  const modalSurface = isLight ? '#FFFEFA' : colors.card;
  const modalSoftSurface = isLight ? '#FAF7F0' : colors.backgroundAlt;
  const modalMutedSurface = isLight ? '#FFFFFF' : SURFACE;
  const modalBorder = isLight ? '#EEE3D1' : colors.border;
  const modalBorderStrong = isLight ? '#D8BF86' : colors.borderStrong;
  const modalShadow = isLight ? 'rgba(76, 55, 21, 0.22)' : colors.shadow;
  const premiumGold = isLight ? '#BF9135' : colors.primary;
  const premiumGoldSoft = isLight ? '#FFF6DF' : GOLD_SOFT;
  const proSurface = isLight ? '#FFFFFF' : SURFACE_2;
  const proBadgeSurface = isLight ? '#FFFBF2' : '#211C13';
  const proAccentText = isLight ? '#17130D' : colors.accent;
  const membershipText = isLight ? '#17130D' : colors.textPrimary;
  const membershipSubText = isLight ? '#5E564B' : colors.textSecondary;
  const membershipMutedText = isLight ? '#918675' : colors.textMuted;
  const buttonGradientColors = (isLight
    ? ['#E8C878', '#BE9032']
    : [colors.primary, '#B68E3E']) as [string, string];
  const successSurface = isLight ? '#EFF8F1' : SUCCESS_BG;
  const successBorder = isLight ? '#CFE6D5' : SUCCESS_BORDER;
  const warningSurface = isLight ? '#FFF8E8' : WARNING_BG;

  const renderStatusValue = (
    value: string,
    tone: 'free' | 'pro',
    locked: boolean,
    strong: boolean
  ) => {
    if (value === '✓') {
      return (
        <Ionicons
          name="checkmark"
          size={14}
          color={isLight ? '#2E7A4A' : '#72D188'}
        />
      );
    }

    if (value === '✕') {
      return (
        <Text
          style={[
            styles.statusText,
            { color: isLight ? '#B4A895' : membershipMutedText },
          ]}
        >
          -
        </Text>
      );
    }

    return (
      <Text
        style={[
          styles.statusText,
          {
            color:
              tone === 'pro' && !strong
                ? proAccentText
                : locked
                ? membershipMutedText
                : isLight
                ? '#2E7A4A'
                : '#72D188',
          },
        ]}
      >
        {value}
      </Text>
    );
  };

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
            { backgroundColor: isLight ? 'rgba(26, 22, 16, 0.38)' : colors.overlay },
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
                borderColor: modalBorder,
                shadowColor: modalShadow,
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
                <View style={styles.topBarSpacer} />

                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={onClose}
                  style={[
                    styles.closeButton,
                    {
                      backgroundColor: isLight ? '#FFFFFF' : modalSoftSurface,
                      borderColor: modalBorder,
                    },
                  ]}
                  disabled={upgrading || downgrading || restoringPro}
                >
                  <Text style={[styles.closeText, { color: membershipSubText }]}>×</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.heroBlock}>
                <View
                  style={[
                    styles.heroBadge,
                    {
                      backgroundColor: isLight ? '#FFFFFF' : modalSoftSurface,
                      borderColor: isLight ? '#E3CEA0' : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.heroBadgeText, { color: proAccentText }]}>
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

                <View style={styles.metaRow}>
                  {currentTier ? (
                    <View
                      style={[
                        styles.metaPill,
                        {
                          backgroundColor: isLight ? '#FFFFFF' : modalSoftSurface,
                          borderColor: modalBorder,
                        },
                      ]}
                    >
                      <Text style={[styles.metaLabel, { color: membershipMutedText }]}>Current</Text>
                      <Text style={[styles.metaValue, { color: membershipText }]}>{currentTierLabel}</Text>
                    </View>
                  ) : null}

                  {isActuallyPro && cancelAtPeriodEnd && endDateLabel ? (
                    <View
                      style={[
                        styles.metaPill,
                        {
                          backgroundColor: isLight ? '#FFFFFF' : modalSoftSurface,
                          borderColor: modalBorder,
                        },
                      ]}
                    >
                      <Text style={[styles.metaLabel, { color: membershipMutedText }]}>Cancels</Text>
                      <Text style={[styles.metaValue, { color: membershipText }]}>{endDateLabel}</Text>
                    </View>
                  ) : null}
                </View>
              </View>

              {isActuallyPro && cancelAtPeriodEnd ? (
                <View
                  style={[
                    styles.countdownBanner,
                    { backgroundColor: warningSurface, borderColor: modalBorderStrong },
                  ]}
                >
                  <View style={styles.countdownBannerTopRow}>
                    <Text style={[styles.countdownPill, { color: proAccentText }]}>CANCELLATION SCHEDULED</Text>
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
                      style={[
                        styles.inlineActionBtn,
                        styles.inlineActionSecondary,
                        {
                          backgroundColor: isLight ? '#FFFFFF' : modalSoftSurface,
                          borderColor: modalBorder,
                        },
                      ]}
                      disabled={restoringPro}
                    >
                      <Text style={[styles.inlineActionSecondaryText, { color: membershipText }]}>View cancellation</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}

              {successText ? (
                <View style={[styles.successBanner, { backgroundColor: successSurface, borderColor: successBorder }]}>
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
                    { backgroundColor: modalMutedSurface, borderColor: modalBorder },
                    selectedTier === 'free' && [
                      styles.tierCardSelected,
                      isLight && { borderColor: modalBorderStrong },
                    ],
                    !isActuallyPro && styles.tierCardCurrentFree,
                    isDesktopWeb && styles.compactTierDesktop,
                  ]}
                >
                  <View>
                    <Text style={[styles.tierSmallLabel, { color: membershipMutedText }]}>FREE</Text>
                    <Text style={[styles.compactTierName, { color: membershipText }]}>
                      Free account
                    </Text>
                    <Text style={[styles.compactTierSub, { color: membershipSubText }]}>
                      Start with the essentials for a simple creator profile.
                    </Text>

                    <View style={styles.compactFeatureList}>
                      {FREE_INCLUDED_FEATURES.map((item) => (
                        <View key={item} style={styles.featureItemRow}>
                          <View
                            style={[
                              styles.featureIcon,
                              {
                                backgroundColor: isLight
                                  ? '#EFF8F2'
                                  : 'rgba(72,180,113,0.13)',
                              },
                            ]}
                          >
                            <Ionicons
                              name="checkmark"
                              size={12}
                              color={isLight ? '#2E7A4A' : '#72D188'}
                            />
                          </View>
                          <Text style={[styles.featureItem, { color: membershipSubText }]}>
                            {item}
                          </Text>
                        </View>
                      ))}
                    </View>

                    <View style={[styles.compactLockedList, { borderTopColor: modalBorder }]}>
                      {FREE_LOCKED_FEATURES.map((item) => (
                        <View key={item} style={styles.featureItemRow}>
                          <View
                            style={[
                              styles.featureIcon,
                              styles.featureIconLocked,
                              {
                                backgroundColor: isLight
                                  ? '#F7F2EA'
                                  : 'rgba(143,133,120,0.12)',
                              },
                            ]}
                          >
                            <Ionicons name="lock-closed" size={11} color={membershipMutedText} />
                          </View>
                          <Text style={[styles.featureItem, { color: membershipMutedText }]}>
                            {item}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>

                  <View style={[styles.compactPriceFooter, { borderTopColor: modalBorder }]}>
                    <Text style={[styles.compactPrice, { color: membershipText }]}>
                      {SUBSCRIPTION_PRICE_CURRENCY_SYMBOL}0
                    </Text>
                    <Text style={[styles.compactPriceSub, { color: membershipMutedText }]}>
                      / month
                    </Text>
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
                    {
                      backgroundColor: proSurface,
                      borderColor: modalBorderStrong,
                      shadowColor: modalShadow,
                    },
                    selectedTier === 'pro' && [
                      styles.tierCardSelectedPro,
                      isLight && {
                        backgroundColor: '#FFFFFF',
                        borderColor: premiumGold,
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
                      <View style={styles.proLabelRow}>
                        <Text style={[styles.tierSmallLabelGold, { color: proAccentText }]}>PRO</Text>
                        <View
                          style={[
                            styles.bestForBadge,
                            {
                              backgroundColor: premiumGoldSoft,
                              borderColor: isLight ? '#EBD39B' : 'transparent',
                            },
                          ]}
                        >
                          <Text style={[styles.bestForText, { color: proAccentText }]}>
                            Best for serious creators
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.proTitle, { color: membershipText }]}>
                        Portfolio, training, and tools
                      </Text>
                      <Text style={[styles.compactTierSub, { color: membershipSubText }]}>
                        Share unlimited films, build a sharper portfolio, meet collaborators, and train with focused filmmaking exercises.
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.priceBadge,
                        {
                          backgroundColor: proBadgeSurface,
                          borderColor: isLight ? '#E7D5A8' : colors.borderStrong,
                          shadowColor: modalShadow,
                        },
                      ]}
                    >
                      <Text style={[styles.planKickerHero, { color: proAccentText }]}>MONTHLY</Text>
                      <View style={styles.planPriceRow}>
                        <Text style={[styles.planCurrency, { color: membershipText }]}>
                          {SUBSCRIPTION_PRICE_CURRENCY_SYMBOL}
                        </Text>
                        <Text style={[styles.planPriceHero, { color: membershipText }]}>
                          {SUBSCRIPTION_PRICE_AMOUNT}
                        </Text>
                      </View>
                      <Text style={[styles.planSubHero, { color: membershipSubText }]}>
                        per month
                      </Text>
                    </View>
                  </View>

                  <View style={styles.featureGrid}>
                    {PRO_HIGHLIGHTS.map((item) => (
                      <View key={item} style={styles.featureItemRow}>
                        <View
                          style={[
                            styles.featureIcon,
                            {
                              backgroundColor: isLight
                                ? '#F0F8F2'
                                : 'rgba(72,180,113,0.13)',
                            },
                          ]}
                        >
                          <Ionicons
                            name="checkmark"
                            size={12}
                            color={isLight ? '#2E7A4A' : '#72D188'}
                          />
                        </View>
                        <Text style={[styles.featureItem, { color: membershipSubText }]}>
                          {item}
                        </Text>
                      </View>
                    ))}
                  </View>
                </TouchableOpacity>
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
                <LinearGradient
                  colors={buttonGradientColors}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.buttonGradient}
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
                </LinearGradient>
              </TouchableOpacity>

              <Text style={[styles.reassuranceText, { color: membershipMutedText }]}>
                Cancel anytime. Auto-renews monthly.
              </Text>

              <View
                style={[
                  styles.comparisonBox,
                  {
                    backgroundColor: isLight ? '#FFFFFF' : modalSoftSurface,
                    borderColor: modalBorder,
                  },
                ]}
              >
                <View style={styles.comparisonHeader}>
                  <Text style={[styles.comparisonTitle, { color: membershipText }]}>Free vs Pro</Text>
                  <View style={styles.comparisonStatusGroup}>
                    <Text style={[styles.comparisonColumnHeader, { color: membershipMutedText }]}>
                      Free
                    </Text>
                    <Text style={[styles.comparisonColumnHeader, { color: proAccentText }]}>
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
                      style={[styles.comparisonRow, { borderTopColor: isLight ? '#F0E8DC' : colors.border }]}
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
                                ? isLight
                                  ? '#F8F5EF'
                                  : 'rgba(143,133,120,0.12)'
                                : isLight
                                ? '#EFF8F2'
                                : 'rgba(72,180,113,0.13)',
                              borderColor: freeLocked
                                ? modalBorder
                                : isLight
                                ? '#D1E7D6'
                                : 'rgba(72,180,113,0.28)',
                            },
                          ]}
                        >
                          {renderStatusValue(row.free, 'free', freeLocked, row.free === '✓')}
                        </View>
                        <View
                          style={[
                            styles.statusPill,
                            styles.statusPillPro,
                            {
                              backgroundColor: proStrong
                                ? isLight
                                  ? '#EFF8F2'
                                  : 'rgba(72,180,113,0.13)'
                                : premiumGoldSoft,
                              borderColor: proStrong
                                ? isLight
                                  ? '#D1E7D6'
                                  : 'rgba(72,180,113,0.28)'
                                : modalBorderStrong,
                            },
                          ]}
                        >
                          {renderStatusValue(row.pro, 'pro', false, proStrong)}
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>

              <View
                style={[
                  styles.subscriptionInfoBox,
                  {
                    backgroundColor: 'transparent',
                    borderColor: isLight ? '#EEE5D7' : colors.border,
                  },
                ]}
              >
                <Text style={[styles.subscriptionInfoTitle, { color: membershipText }]}>{SUBSCRIPTION_TITLE}</Text>
                <Text style={[styles.subscriptionInfoText, { color: membershipSubText }]}>
                  {SUBSCRIPTION_PRICE_FALLBACK}/month. Auto-renews monthly. Cancel anytime.
                </Text>
                <View style={styles.legalLinksRow}>
                  <TouchableOpacity onPress={() => openLegalUrl(TERMS_OF_USE_URL)}>
                    <Text style={[styles.legalLinkText, { color: proAccentText }]}>Terms of Use</Text>
                  </TouchableOpacity>
                  <Text style={[styles.legalDivider, { color: membershipMutedText }]}>•</Text>
                  <TouchableOpacity onPress={() => setPrivacyPolicyVisible(true)}>
                    <Text style={[styles.legalLinkText, { color: proAccentText }]}>Privacy Policy</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity
                onPress={onClose}
                style={styles.laterButton}
                disabled={upgrading || downgrading || restoringPro}
              >
                <Text style={[styles.laterText, { color: membershipMutedText }]}>Maybe later</Text>
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
                      <Text style={[styles.confirmStatusLabel, { color: membershipText }]}>
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
      <PrivacyPolicyModal
        visible={privacyPolicyVisible}
        onClose={() => setPrivacyPolicyVisible(false)}
      />
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
    maxWidth: 520,
    alignSelf: 'center',
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 18,
    backgroundColor: DARK_ELEVATED,
    borderWidth: 1,
    borderColor: HAIRLINE,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },

  cardDesktop: {
    maxWidth: 900,
    paddingVertical: 26,
    paddingHorizontal: 26,
  },

  cardMobile: {
    maxWidth: 390,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },

  cardScrollContent: {
    paddingBottom: 8,
    flexGrow: 1,
  },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginBottom: 2,
    minHeight: 34,
  },

  topBarSpacer: {
    flex: 1,
  },

  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: HAIRLINE_2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  closeText: {
    color: TEXT_MUTED,
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '700',
    fontFamily: SYSTEM_SANS,
  },

  heroBlock: {
    marginBottom: 22,
    alignItems: 'center',
    paddingHorizontal: 8,
  },

  heroBadge: {
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderWidth: 1,
    marginBottom: 13,
  },

  heroBadgeText: {
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },

  title: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '800',
    color: TEXT_IVORY,
    marginBottom: 10,
    fontFamily: SYSTEM_SANS,
    textAlign: 'center',
  },

  titleDesktop: {
    fontSize: 36,
    lineHeight: 42,
  },

  subtitle: {
    fontSize: 13.2,
    color: TEXT_MUTED,
    lineHeight: 19,
    fontFamily: SYSTEM_SANS,
    textAlign: 'center',
    maxWidth: 520,
  },

  subtitleDesktop: {
    maxWidth: 720,
    fontSize: 14.5,
    lineHeight: 22,
  },

  offerBanner: {
    width: '100%',
    maxWidth: 560,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginTop: 18,
    alignItems: 'center',
  },

  offerBannerDesktop: {
    maxWidth: 640,
    paddingVertical: 16,
    paddingHorizontal: 18,
  },

  offerBannerTop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginBottom: 9,
  },

  offerBadge: {
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 11,
  },

  offerBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    fontFamily: SYSTEM_SANS,
  },

  offerCountdownText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    fontFamily: SYSTEM_SANS,
    textAlign: 'center',
  },

  offerBannerTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
    fontFamily: SYSTEM_SANS,
    textAlign: 'center',
  },

  offerPriceWas: {
    textDecorationLine: 'line-through',
    textDecorationStyle: 'solid',
    fontWeight: '700',
  },

  offerPriceNow: {
    fontWeight: '800',
  },

  offerBannerText: {
    marginTop: 5,
    fontSize: 12.6,
    lineHeight: 18,
    fontFamily: SYSTEM_SANS,
    textAlign: 'center',
  },

  offerCodePill: {
    marginTop: 11,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  offerCodeLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },

  offerCodeValue: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
    fontFamily: SYSTEM_SANS,
  },

  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
  },

  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 10,
    minHeight: 34,
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
    fontSize: 9.5,
    fontWeight: '900',
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },

  metaValue: {
    color: TEXT_IVORY,
    fontSize: 11.5,
    fontWeight: '900',
    fontFamily: SYSTEM_SANS,
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
    gap: 14,
    marginBottom: 16,
  },

  tiersStackDesktop: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 16,
  },

  compactTier: {
    borderRadius: 12,
    paddingVertical: 20,
    paddingHorizontal: 20,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: HAIRLINE_2,
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: 18,
  },

  compactTierDesktop: {
    flex: 0.86,
    alignSelf: 'stretch',
  },

  freeCompact: {
    backgroundColor: 'rgba(255,255,255,0.035)',
  },

  compactTierLeft: {
    flex: 1,
    paddingRight: 16,
    minWidth: 0,
  },

  tierSmallLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: 'rgba(198,166,100,0.62)',
    marginBottom: 8,
    fontFamily: SYSTEM_SANS,
  },

  tierSmallLabelGold: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: GOLD,
    fontFamily: SYSTEM_SANS,
  },

  compactTierName: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '800',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },

  compactTierSub: {
    marginTop: 7,
    fontSize: 13,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
    lineHeight: 19,
  },

  compactFeatureList: {
    marginTop: 16,
    gap: 9,
  },

  compactLockedList: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    gap: 8,
  },

  compactPriceFooter: {
    paddingTop: 14,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },

  compactPrice: {
    fontSize: 24,
    fontWeight: '800',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },

  compactPriceSub: {
    fontSize: 12,
    color: TEXT_MUTED_2,
    fontFamily: SYSTEM_SANS,
  },

  proTier: {
    borderRadius: 12,
    paddingVertical: 22,
    paddingHorizontal: 22,
    backgroundColor: SURFACE_2,
    borderWidth: 1,
    borderColor: 'rgba(198,166,100,0.22)',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },

  proTierDesktop: {
    flex: 1.48,
    alignSelf: 'stretch',
  },

  proHeader: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: 18,
    marginBottom: 18,
    flexWrap: 'wrap',
  },

  proLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    marginBottom: 9,
  },

  proTitle: {
    fontSize: 21,
    lineHeight: 25,
    fontWeight: '800',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },

  bestForBadge: {
    alignSelf: 'flex-start',
    borderRadius: 7,
    borderWidth: 1,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },

  bestForText: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },

  priceBadge: {
    minWidth: 164,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: '#211C13',
    borderWidth: 1,
    borderColor: OFFER_TILE_BORDER,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    flexShrink: 0,
  },

  featureGrid: {
    gap: 10,
  },

  featureItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },

  featureIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -1,
    flexShrink: 0,
  },

  featureIconLocked: {
    opacity: 0.92,
  },

  featureItem: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },

  comparisonBox: {
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 14,
  },

  comparisonHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },

  comparisonTitle: {
    fontSize: 16,
    fontWeight: '900',
    fontFamily: SYSTEM_SANS,
  },

  comparisonColumnHeader: {
    width: 88,
    fontSize: 10.5,
    fontWeight: '900',
    fontFamily: SYSTEM_SANS,
    textAlign: 'center',
  },

  comparisonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: 1,
    paddingVertical: 10,
  },

  comparisonFeature: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 17,
    fontFamily: SYSTEM_SANS,
  },

  comparisonStatusGroup: {
    width: 184,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    flexShrink: 0,
  },

  statusPill: {
    width: 88,
    minHeight: 28,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },

  statusPillPro: {
    width: 88,
  },

  statusText: {
    fontSize: 10.8,
    lineHeight: 13,
    fontWeight: '900',
    fontFamily: SYSTEM_SANS,
    textAlign: 'center',
  },

  reassuranceText: {
    marginTop: 10,
    marginBottom: 14,
    fontSize: 12,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },

  subscriptionInfoBox: {
    borderTopWidth: 1,
    borderColor: HAIRLINE_2,
    backgroundColor: 'transparent',
    paddingTop: 14,
    paddingHorizontal: 2,
    marginTop: 4,
    marginBottom: 6,
  },

  subscriptionInfoTitle: {
    fontSize: 12,
    color: TEXT_IVORY,
    fontWeight: '900',
    fontFamily: SYSTEM_SANS,
  },

  subscriptionInfoText: {
    marginTop: 5,
    fontSize: 11.5,
    lineHeight: 17,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },

  legalLinksRow: {
    marginTop: 9,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },

  legalLinkText: {
    color: GOLD,
    fontSize: 11.5,
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
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
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
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: TEXT_MUTED_2,
    fontFamily: SYSTEM_SANS,
  },

  planKickerHero: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: GOLD,
    fontFamily: SYSTEM_SANS,
  },

  planPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 4,
  },

  planWasPrice: {
    marginTop: 8,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    fontFamily: SYSTEM_SANS,
    textAlign: 'center',
  },

  planWasPriceStrike: {
    textDecorationLine: 'line-through',
    textDecorationStyle: 'solid',
  },

  planNowLabel: {
    marginRight: 6,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },

  planCurrency: {
    fontSize: 13,
    fontWeight: '800',
    color: TEXT_IVORY,
    marginRight: 2,
    marginBottom: 3,
    fontFamily: SYSTEM_SANS,
  },

  planPriceHero: {
    fontSize: 24,
    fontWeight: '800',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },

  planSubHero: {
    marginTop: 4,
    fontSize: 10,
    color: 'rgba(237,235,230,0.70)',
    fontFamily: SYSTEM_SANS,
    textAlign: 'center',
  },

  buttonBase: {
    marginTop: 2,
    borderRadius: 10,
    overflow: 'hidden',
    shadowColor: '#7C5314',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },

  proButton: {
    backgroundColor: 'transparent',
  },

  buttonGradient: {
    minHeight: 54,
    paddingVertical: 15,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  buttonDisabled: {
    opacity: 0.56,
  },

  buttonText: {
    color: '#000000',
    textAlign: 'center',
    fontWeight: '900',
    fontSize: 15,
    fontFamily: SYSTEM_SANS,
  },

  buttonTextDisabled: {
    color: 'rgba(20,17,13,0.56)',
  },

  laterButton: {
    marginTop: 4,
    paddingVertical: 8,
  },

  laterText: {
    textAlign: 'center',
    color: TEXT_MUTED,
    fontSize: 12.5,
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
