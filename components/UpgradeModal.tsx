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
import {
  getCurrentUserTierOrFree,
  invalidateMembershipCache,
} from '../app/lib/membership';
import { getMySubscriptionStatus } from '../app/lib/billing';
import { supabase } from '../app/lib/supabase';

type UpgradeContext =
  | 'challenge'
  | 'jobs'
  | 'workshop'
  | 'extra_submission'
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

const DARK_ELEVATED = '#171717';
const SURFACE = '#121212';
const SURFACE_2 = '#0F0F0F';

const TEXT_IVORY = '#EDEBE6';
const TEXT_MUTED = 'rgba(237,235,230,0.60)';
const TEXT_MUTED_2 = 'rgba(237,235,230,0.42)';

const HAIRLINE = 'rgba(255,255,255,0.09)';
const HAIRLINE_2 = 'rgba(255,255,255,0.06)';

const GOLD = '#C6A664';
const SUCCESS = '#2ED47A';
const WARNING_BG = 'rgba(198,166,100,0.12)';
const WARNING_BORDER = 'rgba(198,166,100,0.22)';
const SUCCESS_BG = 'rgba(46,212,122,0.12)';
const SUCCESS_BORDER = 'rgba(46,212,122,0.22)';

const OFFER_TILE_BG = 'rgba(46,212,122,0.12)';
const OFFER_TILE_BORDER = 'rgba(46,212,122,0.22)';

const SYSTEM_SANS = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: undefined,
  default: undefined,
});

const HUMAN_TIER_LONG: Record<UserTier, string> = {
  free: 'Free',
  pro: 'Pro',
};

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

export const UpgradeModal: React.FC<Props> = ({
  visible,
  onClose,
  context,
  onSelectPro,
}) => {
  const nav = useNavigation<any>();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const isMobile = width < 520;
  const isTiny = width < 360;

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

        const tier = await getCurrentUserTierOrFree({ force: true });
        if (!mounted) return;

        setCurrentTier(tier);
        setSelectedTier(tier);

        const billing = (await getMySubscriptionStatus()) as BillingSnapshot;
        if (!mounted) return;

        setBillingState(billing);
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

  const title = 'Unlock your full filmmaking access';
  const subtitle =
    'Upload your films, apply for paid jobs, and unlock the full Filmmaking Bootcamp — a premium space to train across every major film discipline through high-level lessons, practical exercises, and powerful Workshop tools built to help you actually make films.';

  const currentTierLabel = currentTier ? HUMAN_TIER_LONG[currentTier] : 'Free';
  const isProDisabled = currentTier === 'pro' && !cancelAtPeriodEnd;
  const endDateLabel = periodEndIso ? formatEndDate(periodEndIso) : null;

  const isGrandfathered = Boolean(billingState?.isGrandfathered);
  const isActiveSubscriber = Boolean(billingState?.isActiveSubscriber);
  const inCancelGracePeriod = Boolean(billingState?.inCancelGracePeriod);

  const canCancelRenewal = !isGrandfathered && (isActiveSubscriber || inCancelGracePeriod);
  const canKeepPro = !isGrandfathered && currentTier === 'pro' && cancelAtPeriodEnd;

  const downgradeLossBullets = useMemo(() => {
    return [
      'Uploading films to the Monthly Film Challenge will be locked (Pro only).',
      'Paid job applications will be locked (Pro only).',
      'The full Filmmaking Bootcamp will be locked (Pro only).',
      'Workshop tools and film resources that help you make films will be locked (Pro only).',
    ];
  }, [context]);

  const refreshBillingState = async () => {
    invalidateMembershipCache();

    const [refreshedTier, refreshedBilling] = await Promise.all([
      getCurrentUserTierOrFree({ force: true }),
      getMySubscriptionStatus() as Promise<BillingSnapshot>,
    ]);

    setCurrentTier(refreshedTier);
    setSelectedTier(refreshedTier);
    setBillingState(refreshedBilling);
    setPeriodEndIso(
      refreshedBilling.current_period_end ??
        refreshedBilling.accessEndsAt ??
        refreshedBilling.premium_access_expires_at ??
        null
    );
    setCancelAtPeriodEnd(Boolean(refreshedBilling.cancel_at_period_end));
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
      nav.navigate('Paywall');
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

      if (!(latestBilling.isActiveSubscriber || latestBilling.inCancelGracePeriod)) {
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
        const opened = await openExternalManagementUrl(result?.management_url ?? null);

        const externalMessage =
          result?.message ||
          (opened
            ? 'Your subscription is managed by your mobile app store. We opened the store management page so you can cancel it there.'
            : 'Your subscription is managed by your mobile app store. Please cancel it in Google Play or the App Store.');

        setDowngradeConfirmError(externalMessage);

        await refreshBillingState();
        return;
      }

      await refreshBillingState();

      setDowngradeConfirmVisible(false);
      setSuccessText(
        endDateLabel
          ? `Your renewal has been cancelled. You’ll keep Pro until ${endDateLabel}.`
          : 'Your renewal has been cancelled. You’ll keep Pro until the end of your billing period.'
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
        setSuccessText('Your Pro subscription is already set to continue.');
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
        const opened = await openExternalManagementUrl(result?.management_url ?? null);

        const externalMessage =
          result?.message ||
          (opened
            ? 'Your subscription is managed by your mobile app store. We opened the store management page so you can continue it there.'
            : 'Your subscription is managed by your mobile app store. Please manage it in Google Play or the App Store.');

        setDowngradeConfirmError(externalMessage);
        await refreshBillingState();
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
    currentTier === 'pro' && cancelAtPeriodEnd
      ? restoringPro
        ? 'Keeping Pro…'
        : 'Keep Pro'
      : isProDisabled
      ? "You're on Pro"
      : upgrading
      ? 'Opening checkout…'
      : 'See Pro plans';

  const horizontalPad = isMobile ? 14 : 20;
  const verticalPadTop = Math.max(insets.top + 12, 20);
  const verticalPadBottom = Math.max(insets.bottom + 12, 20);

  const cardMaxHeight = Math.min(
    height - verticalPadTop - verticalPadBottom,
    isMobile ? 680 : 760
  );

  const confirmIntroText = isGrandfathered
    ? 'This account has grandfathered Pro access. There is no monthly renewal to cancel.'
    : cancelAtPeriodEnd
    ? `Your Pro renewal is already cancelled.${
        endDateLabel
          ? ` You’ll keep Pro until ${endDateLabel}, then switch to Free.`
          : ` You’ll keep Pro until the end of your current billing period.`
      }`
    : `Your Pro subscription will be cancelled so you won’t be charged again.${
        endDateLabel
          ? ` You’ll keep Pro until ${endDateLabel}, then switch to Free.`
          : ` You’ll keep Pro until the end of your current billing period.`
      }`;

  const confirmPrimaryButtonLabel = isGrandfathered
    ? 'Close'
    : downgrading
    ? 'Cancelling…'
    : cancelAtPeriodEnd
    ? 'Cancellation scheduled'
    : 'Cancel renewal';

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
        <Pressable
          style={[
            styles.backdrop,
            {
              paddingTop: verticalPadTop,
              paddingBottom: verticalPadBottom,
              paddingHorizontal: horizontalPad,
            },
          ]}
          onPress={onClose}
        >
          <Pressable
            onPress={() => {}}
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
              <View style={styles.header}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.kicker}>UPGRADE</Text>
                  <Text style={styles.title}>{title}</Text>
                  <Text style={styles.subtitle}>{subtitle}</Text>
                </View>
              </View>

              {currentTier ? (
                <Text style={styles.currentTierText}>
                  Current plan: <Text style={styles.currentTierName}>{currentTierLabel}</Text>
                  {currentTier === 'pro' && cancelAtPeriodEnd && endDateLabel ? (
                    <Text style={{ color: TEXT_MUTED }}>{`  •  Cancels ${endDateLabel}`}</Text>
                  ) : null}
                </Text>
              ) : null}

              {currentTier === 'pro' && cancelAtPeriodEnd ? (
                <View style={styles.countdownBanner}>
                  <View style={styles.countdownBannerTopRow}>
                    <Text style={styles.countdownPill}>CANCELLATION SCHEDULED</Text>
                    {cancelCountdown.short ? (
                      <Text style={styles.countdownDays}>{cancelCountdown.short}</Text>
                    ) : null}
                  </View>

                  <Text style={styles.countdownTitle}>
                    {endDateLabel
                      ? `Your Pro plan ends on ${endDateLabel}`
                      : 'Your Pro plan will return to Free at the end of your billing period'}
                  </Text>

                  {cancelCountdown.long ? (
                    <Text style={styles.countdownText}>{cancelCountdown.long}</Text>
                  ) : null}

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
                        <Text style={styles.inlineActionPrimaryText}>Keep Pro</Text>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      activeOpacity={0.92}
                      onPress={() => setDowngradeConfirmVisible(true)}
                      style={[styles.inlineActionBtn, styles.inlineActionSecondary]}
                      disabled={restoringPro}
                    >
                      <Text style={styles.inlineActionSecondaryText}>View cancellation</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}

              {successText ? (
                <View style={styles.successBanner}>
                  <Text style={styles.successBannerText}>{successText}</Text>
                </View>
              ) : null}

              {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

              <View style={[styles.tiersRow, isMobile && styles.tiersRowMobile]}>
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => {
                    setErrorText(null);
                    setSuccessText(null);

                    if (currentTier === 'pro') {
                      setSelectedTier('free');
                      openDowngradeConfirm();
                      return;
                    }

                    setSelectedTier('free');
                  }}
                  style={[
                    styles.tierCard,
                    styles.freeCard,
                    isMobile && styles.tierCardMobile,
                    selectedTier === 'free' && styles.tierCardSelected,
                    currentTier === 'free' && styles.tierCardCurrentFree,
                  ]}
                >
                  <Text style={styles.freeSmallLabel}>Free</Text>

                  <Text style={styles.tierNameFree}>Free</Text>
                  <Text style={styles.tierTaglineMuted}>Browse, connect, collaborate</Text>

                  <View style={styles.priceRow}>
                    <Text style={styles.priceMain}>FREE</Text>
                    <Text style={styles.priceSub}>forever</Text>
                  </View>

                  <View style={styles.dividerSoft} />

                  <View style={styles.featureList}>
                    <Text style={styles.featureItemMuted}>
                      ✓ Discover and connect with filmmakers worldwide
                    </Text>
                    <Text style={styles.featureItemMuted}>
                      ✓ Browse profiles and message other creatives
                    </Text>
                    <Text style={styles.featureItemMuted}>
                      ✓ Join city-based group chats and find local crews
                    </Text>
                    <Text style={styles.featureItemMuted}>
                      ✓ Apply for free jobs and post your own gigs
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
                    styles.tierCard,
                    styles.proCard,
                    isMobile && styles.tierCardMobile,
                    selectedTier === 'pro' && styles.tierCardSelectedPro,
                    currentTier === 'pro' && styles.tierCardCurrentPro,
                  ]}
                >
                  <Text style={styles.tierName}>Pro</Text>
                  <Text style={styles.tierTagline}>
                    Create, train, and make films with full access
                  </Text>

                  <View style={styles.plansArea}>
                    <View style={[styles.planRow, isMobile && styles.planRowMobile]}>
                      <View
                        style={[
                          styles.planTile,
                          styles.planTileHero,
                          isTiny && styles.planTileTiny,
                        ]}
                      >
                        <Text style={[styles.planKicker, styles.planKickerHero]}>MONTHLY</Text>

                        <View style={styles.planPriceRow}>
                          <Text style={styles.planCurrency}>£</Text>
                          <Text style={styles.planPriceHero}>4.99</Text>
                        </View>

                        <Text style={styles.planSubHero}>Cancel anytime</Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.dividerUltraSoft} />

                  <View style={styles.featureList}>
                    <Text style={styles.featureItem}>✓ Upload films to the Monthly Film Challenge</Text>
                    <Text style={styles.featureItem}>✓ Apply for paid jobs across Overlooked</Text>
                    <Text style={styles.featureItem}>✓ Unlock the full Filmmaking Bootcamp</Text>
                    <Text style={styles.featureItem}>
                      ✓ Learn every major film discipline through focused lessons and exercises
                    </Text>
                    <Text style={styles.featureItem}>
                      ✓ Train with practical exercises inspired by academic film and acting courses
                    </Text>
                    <Text style={styles.featureItem}>
                      ✓ Use all Workshop tools and resources to help you develop, plan, and make films
                    </Text>
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

              <TouchableOpacity
                onPress={onClose}
                style={styles.laterButton}
                disabled={upgrading || downgrading || restoringPro}
              >
                <Text style={styles.laterText}>Maybe later</Text>
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={downgradeConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() =>
          downgrading || restoringPro ? null : setDowngradeConfirmVisible(false)
        }
        presentationStyle="overFullScreen"
        statusBarTranslucent
      >
        <Pressable
          style={[
            styles.backdrop,
            {
              paddingTop: verticalPadTop,
              paddingBottom: verticalPadBottom,
              paddingHorizontal: horizontalPad,
            },
          ]}
          onPress={() => {
            if (!downgrading && !restoringPro) setDowngradeConfirmVisible(false);
          }}
        >
          <Pressable
            onPress={() => {}}
            style={[
              styles.confirmCard,
              { maxHeight: Math.min(height - verticalPadTop - verticalPadBottom, 620) },
              isMobile && styles.confirmCardMobile,
            ]}
          >
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.confirmScrollContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <Text style={styles.confirmTitle}>
                {isGrandfathered
                  ? 'Pro access'
                  : cancelAtPeriodEnd
                  ? 'Cancellation scheduled'
                  : 'Cancel renewal?'}
              </Text>

              <Text style={styles.confirmSub}>{confirmIntroText}</Text>

              {!isGrandfathered && cancelAtPeriodEnd ? (
                <View style={styles.confirmStatusCard}>
                  <Text style={styles.confirmStatusLabel}>
                    {cancelCountdown.short || 'Scheduled'}
                  </Text>
                  <Text style={styles.confirmStatusBody}>
                    {endDateLabel
                      ? `You’ll stay on Pro until ${endDateLabel}. After that, your account returns to Free.`
                      : 'You’ll stay on Pro until the end of your current billing period.'}
                  </Text>
                </View>
              ) : null}

              {!isGrandfathered ? (
                <View style={styles.confirmList}>
                  <Text style={styles.confirmItem}>After Pro ends, you’ll lose access to:</Text>
                  {downgradeLossBullets.map((t, idx) => (
                    <Text key={`${idx}-${t}`} style={styles.confirmItem}>
                      • {t}
                    </Text>
                  ))}
                </View>
              ) : null}

              {downgradeConfirmError ? (
                <Text style={styles.errorText}>{downgradeConfirmError}</Text>
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
                    pressed && !downgrading && !restoringPro ? { opacity: 0.9 } : null,
                    downgrading || restoringPro ? { opacity: 0.5 } : null,
                  ]}
                >
                  <View style={styles.confirmDangerInner}>
                    {restoringPro && cancelAtPeriodEnd ? (
                      <ActivityIndicator size="small" color={TEXT_IVORY} />
                    ) : null}
                    <Text style={styles.confirmBtnGhostText}>
                      {isGrandfathered
                        ? 'Done'
                        : cancelAtPeriodEnd
                        ? 'Keep Pro'
                        : 'Keep Pro'}
                    </Text>
                  </View>
                </Pressable>

                <Pressable
                  disabled={downgrading || restoringPro || isGrandfathered || !canCancelRenewal || cancelAtPeriodEnd}
                  onPress={isGrandfathered || cancelAtPeriodEnd ? undefined : doDowngradeToFree}
                  style={({ pressed }) => [
                    styles.confirmBtn,
                    styles.confirmBtnDanger,
                    (isGrandfathered || !canCancelRenewal || cancelAtPeriodEnd) &&
                      styles.buttonDisabled,
                    pressed &&
                    !downgrading &&
                    !restoringPro &&
                    !isGrandfathered &&
                    canCancelRenewal &&
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
                        (isGrandfathered || !canCancelRenewal || cancelAtPeriodEnd) &&
                          styles.buttonTextDisabled,
                      ]}
                    >
                      {isGrandfathered
                        ? 'No renewal to cancel'
                        : cancelAtPeriodEnd
                        ? 'Cancellation scheduled'
                        : !canCancelRenewal
                        ? 'No active renewal found'
                        : confirmPrimaryButtonLabel}
                    </Text>
                  </View>
                </Pressable>
              </View>

              <Text style={styles.confirmFoot}>
                {isGrandfathered
                  ? 'Your Pro access remains active.'
                  : cancelAtPeriodEnd
                  ? 'You can undo this any time before the period ends.'
                  : 'Tip: you can re-subscribe any time.'}
              </Text>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.88)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  scroll: {
    flexGrow: 0,
    width: '100%',
  },

  card: {
    width: '100%',
    maxWidth: 920,
    alignSelf: 'center',
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: DARK_ELEVATED,
    borderWidth: 1,
    borderColor: HAIRLINE,
    overflow: 'hidden',
  },

  cardMobile: {
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },

  cardScrollContent: {
    paddingBottom: 8,
    flexGrow: 1,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },

  kicker: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.6,
    color: GOLD,
    textTransform: 'uppercase',
    marginBottom: 4,
    fontFamily: SYSTEM_SANS,
  },

  title: {
    fontSize: 20,
    fontWeight: '900',
    color: TEXT_IVORY,
    marginBottom: 6,
    fontFamily: SYSTEM_SANS,
  },

  subtitle: {
    fontSize: 13,
    color: TEXT_MUTED,
    lineHeight: 18,
    maxWidth: 560,
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
    marginBottom: 14,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: WARNING_BG,
    borderWidth: 1,
    borderColor: WARNING_BORDER,
  },

  countdownBannerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
    flexWrap: 'wrap',
  },

  countdownPill: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: GOLD,
    fontFamily: SYSTEM_SANS,
  },

  countdownDays: {
    fontSize: 12,
    fontWeight: '900',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },

  countdownTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: TEXT_IVORY,
    marginBottom: 4,
    fontFamily: SYSTEM_SANS,
  },

  countdownText: {
    fontSize: 12.5,
    lineHeight: 18,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },

  inlineActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },

  inlineActionRowMobile: {
    flexDirection: 'column',
  },

  inlineActionBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
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
    fontSize: 13,
    fontFamily: SYSTEM_SANS,
  },

  inlineActionSecondaryText: {
    color: TEXT_IVORY,
    fontWeight: '900',
    fontSize: 13,
    fontFamily: SYSTEM_SANS,
  },

  successBanner: {
    marginBottom: 12,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: SUCCESS_BG,
    borderWidth: 1,
    borderColor: SUCCESS_BORDER,
  },

  successBannerText: {
    color: TEXT_IVORY,
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: SYSTEM_SANS,
  },

  errorText: {
    fontSize: 12,
    color: '#FFB3B3',
    marginTop: 8,
    fontFamily: SYSTEM_SANS,
  },

  tiersRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'stretch',
    marginBottom: 14,
    gap: 12,
    flexWrap: 'wrap',
  },

  tiersRowMobile: {
    flexDirection: 'column',
    flexWrap: 'nowrap',
  },

  tierCard: {
    flex: 1,
    minWidth: 280,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: HAIRLINE_2,
  },

  tierCardMobile: {
    minWidth: 0,
    width: '100%',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 18,
  },

  freeCard: {
    borderWidth: 0,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },

  proCard: {
    backgroundColor: SURFACE_2,
    borderColor: 'rgba(198,166,100,0.20)',
  },

  tierCardSelected: {
    borderColor: 'rgba(255,255,255,0.14)',
  },

  tierCardSelectedPro: {
    borderColor: 'rgba(198,166,100,0.36)',
  },

  tierCardCurrentFree: {
    borderWidth: 0,
  },

  tierCardCurrentPro: {
    borderColor: 'rgba(198,166,100,0.42)',
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },

  freeSmallLabel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: 'rgba(198,166,100,0.62)',
    marginBottom: 8,
    fontFamily: SYSTEM_SANS,
  },

  tierName: {
    fontSize: 16,
    fontWeight: '900',
    color: TEXT_IVORY,
    marginBottom: 3,
    fontFamily: SYSTEM_SANS,
  },

  tierNameFree: {
    fontSize: 16,
    fontWeight: '900',
    color: TEXT_IVORY,
    marginBottom: 3,
    fontFamily: SYSTEM_SANS,
  },

  tierTagline: {
    fontSize: 12,
    color: TEXT_MUTED,
    marginBottom: 12,
    fontFamily: SYSTEM_SANS,
  },

  tierTaglineMuted: {
    fontSize: 12,
    color: 'rgba(237,235,230,0.48)',
    marginBottom: 12,
    fontFamily: SYSTEM_SANS,
  },

  priceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 10,
    minHeight: 34,
  },

  priceMain: {
    fontSize: 24,
    fontWeight: '900',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },

  priceSub: {
    fontSize: 11,
    color: TEXT_MUTED,
    marginLeft: 8,
    marginBottom: 3,
    fontFamily: SYSTEM_SANS,
  },

  dividerSoft: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginVertical: 12,
  },

  dividerUltraSoft: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.035)',
    marginVertical: 12,
  },

  featureList: {
    gap: 6,
  },

  featureItem: {
    fontSize: 11.5,
    lineHeight: 18,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },

  featureItemMuted: {
    fontSize: 11.5,
    lineHeight: 18,
    color: 'rgba(237,235,230,0.45)',
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
    marginTop: 2,
    paddingVertical: 12,
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
    fontSize: 15,
    letterSpacing: 0.3,
    fontFamily: SYSTEM_SANS,
  },

  buttonTextDisabled: {
    color: TEXT_MUTED,
  },

  laterButton: {
    marginTop: 10,
    paddingVertical: 6,
  },

  laterText: {
    textAlign: 'center',
    color: TEXT_MUTED,
    fontSize: 13,
    fontFamily: SYSTEM_SANS,
  },

  confirmCard: {
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: DARK_ELEVATED,
    borderWidth: 1,
    borderColor: HAIRLINE,
    overflow: 'hidden',
  },

  confirmCardMobile: {
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },

  confirmScrollContent: {
    paddingBottom: 8,
    flexGrow: 1,
  },

  confirmTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: TEXT_IVORY,
    marginBottom: 8,
    fontFamily: SYSTEM_SANS,
  },

  confirmSub: {
    fontSize: 13,
    color: TEXT_MUTED,
    lineHeight: 18,
    marginBottom: 12,
    fontFamily: SYSTEM_SANS,
  },

  confirmStatusCard: {
    marginBottom: 12,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: WARNING_BG,
    borderWidth: 1,
    borderColor: WARNING_BORDER,
  },

  confirmStatusLabel: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: GOLD,
    marginBottom: 6,
    fontFamily: SYSTEM_SANS,
  },

  confirmStatusBody: {
    fontSize: 12.5,
    lineHeight: 18,
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },

  confirmList: {
    gap: 6,
    marginBottom: 10,
  },

  confirmItem: {
    fontSize: 12.5,
    color: TEXT_IVORY,
    lineHeight: 18,
    fontFamily: SYSTEM_SANS,
  },

  confirmButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },

  confirmButtonsRowMobile: {
    flexDirection: 'column',
  },

  confirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
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
    fontSize: 12,
    color: TEXT_MUTED,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },
});