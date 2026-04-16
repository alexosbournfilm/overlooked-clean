// app/components/UpgradeModal.tsx
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
  action?: 'stripe_canceled' | 'manage_external' | 'nothing_to_cancel';
  provider?: 'revenuecat' | 'stripe' | string;
  store?: string | null;
  management_url?: string | null;
  period_end?: string | null;
  cancel_at_period_end?: boolean | null;
  message?: string;
  is_grandfathered?: boolean;
};

type ResumeSubscriptionResponse = {
  ok?: boolean;
  error?: string;
  action?: 'stripe_resumed' | 'already_active' | 'manage_external' | 'nothing_to_resume';
  provider?: 'revenuecat' | 'stripe' | string;
  store?: string | null;
  management_url?: string | null;
  period_end?: string | null;
  cancel_at_period_end?: boolean | null;
  message?: string;
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

function getDaysLeftFromIso(iso?: string | null) {
  if (!iso) return null;
  const end = new Date(iso).getTime();
  if (!Number.isFinite(end)) return null;

  const diffMs = end - Date.now();
  if (diffMs <= 0) return 0;

  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function getDaysLeftLabel(iso?: string | null) {
  const daysLeft = getDaysLeftFromIso(iso);
  if (daysLeft == null) return null;
  if (daysLeft === 0) return 'Ends today';
  if (daysLeft === 1) return '1 day left';
  return `${daysLeft} days left`;
}

function getStoreLabel(store?: string | null) {
  const raw = String(store || '').toLowerCase();

  if (raw.includes('app_store') || raw.includes('appstore') || raw.includes('apple')) {
    return 'App Store';
  }

  if (raw.includes('play_store') || raw.includes('playstore') || raw.includes('google')) {
    return 'Google Play';
  }

  if (raw.includes('stripe')) {
    return 'Stripe';
  }

  return 'your mobile app store';
}

function getExternalManagementCopy(
  store?: string | null,
  endDateLabel?: string | null,
  managementUrl?: string | null,
  mode: 'cancel' | 'resume' = 'cancel'
) {
  const storeLabel = getStoreLabel(store);

  if (mode === 'resume') {
    const intro = endDateLabel
      ? `This Pro subscription is managed through ${storeLabel}. You currently keep Pro until ${endDateLabel}.`
      : `This Pro subscription is managed through ${storeLabel}.`;

    const action = managementUrl
      ? `Tap the button below to open ${storeLabel} and turn renewal back on.`
      : `Turn renewal back on in ${storeLabel}.`;

    return `${intro} ${action}`;
  }

  const intro = endDateLabel
    ? `This Pro subscription is managed through ${storeLabel}. You’ll keep Pro until ${endDateLabel}, then it will end if you cancel renewal in the store.`
    : `This Pro subscription is managed through ${storeLabel}. To stop renewal, you need to manage it in the store instead of inside the app.`;

  const action = managementUrl
    ? `Tap the button below to open the ${storeLabel} subscription management page.`
    : storeLabel === 'App Store'
    ? 'Open your Apple subscriptions settings and cancel the renewal there.'
    : storeLabel === 'Google Play'
    ? 'Open your Google Play subscriptions settings and cancel the renewal there.'
    : 'Open your subscription settings in the store where you purchased Pro and cancel the renewal there.';

  return `${intro} ${action}`;
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
  const [resuming, setResuming] = useState(false);

  const [errorText, setErrorText] = useState<string | null>(null);

  const [downgradeConfirmVisible, setDowngradeConfirmVisible] = useState(false);
  const [downgradeConfirmError, setDowngradeConfirmError] = useState<string | null>(null);

  const [periodEndIso, setPeriodEndIso] = useState<string | null>(null);
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState<boolean>(false);

  const [billingState, setBillingState] = useState<BillingSnapshot | null>(null);

  const [externalManagementUrl, setExternalManagementUrl] = useState<string | null>(null);
  const [externalManagementStore, setExternalManagementStore] = useState<string | null>(null);
  const [externalManagementMessage, setExternalManagementMessage] = useState<string | null>(null);
  const [openingManagement, setOpeningManagement] = useState(false);

  const [offerCountdown, setOfferCountdown] = useState(() => getOfferRemaining());

  useEffect(() => {
    if (!visible) return;

    const tick = () => setOfferCountdown(getOfferRemaining());
    tick();

    const id = setInterval(tick, 60 * 1000);
    return () => clearInterval(id);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;

    let mounted = true;

    (async () => {
      try {
        setErrorText(null);
        setDowngradeConfirmError(null);
        setExternalManagementUrl(null);
        setExternalManagementStore(null);
        setExternalManagementMessage(null);

        const tier = await getCurrentUserTierOrFree({ force: true });
        if (!mounted) return;

        setCurrentTier(tier);
        setSelectedTier(tier);

        const billing = (await getMySubscriptionStatus()) as BillingSnapshot;
        if (!mounted) return;

        setBillingState(billing);
        setPeriodEndIso(billing.accessEndsAt ?? null);
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
  const isProDisabled = currentTier === 'pro';
  const endDateLabel = periodEndIso ? formatEndDate(periodEndIso) : null;
  const daysLeftLabel = getDaysLeftLabel(periodEndIso);

  const isGrandfathered = Boolean(billingState?.isGrandfathered);
  const isActiveSubscriber = Boolean(billingState?.isActiveSubscriber);
  const inCancelGracePeriod = Boolean(billingState?.inCancelGracePeriod);
  const hasStripeSubscriptionRecord = Boolean(billingState?.hasStripeSubscriptionRecord);

  const downgradeLossBullets = useMemo(() => {
    return [
      'Uploading films to the Monthly Film Challenge will be locked (Pro only).',
      'Paid job applications will be locked (Pro only).',
      'The full Filmmaking Bootcamp will be locked (Pro only).',
      'Workshop tools and film resources that help you make films will be locked (Pro only).',
    ];
  }, [context]);

  const doUpgradeToPro = async () => {
    try {
      setUpgrading(true);
      setErrorText(null);

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
    setExternalManagementUrl(null);
    setExternalManagementStore(null);
    setExternalManagementMessage(null);
    setDowngradeConfirmVisible(true);
  };

  const openExternalManagementLink = async () => {
    try {
      if (!externalManagementUrl) return;

      setOpeningManagement(true);

      const supported = await Linking.canOpenURL(externalManagementUrl);
      if (!supported) {
        throw new Error('Could not open subscription management link.');
      }

      await Linking.openURL(externalManagementUrl);
    } catch (err: any) {
      console.log('UpgradeModal open management link error', err?.message || err);
      setDowngradeConfirmError(
        err?.message || 'Could not open the subscription management page.'
      );
    } finally {
      setOpeningManagement(false);
    }
  };

  const refreshBillingState = async () => {
    invalidateMembershipCache();

    const refreshedTier = await getCurrentUserTierOrFree({ force: true });
    const refreshedBilling = (await getMySubscriptionStatus()) as BillingSnapshot;

    setCurrentTier(refreshedTier);
    setSelectedTier(refreshedTier);
    setBillingState(refreshedBilling);
    setPeriodEndIso(refreshedBilling.accessEndsAt ?? null);
    setCancelAtPeriodEnd(Boolean(refreshedBilling.cancel_at_period_end));

    return { refreshedTier, refreshedBilling };
  };

  const doDowngradeToFree = async () => {
    try {
      setDowngrading(true);
      setDowngradeConfirmError(null);
      setExternalManagementUrl(null);
      setExternalManagementStore(null);
      setExternalManagementMessage(null);

      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!userRes?.user?.id) throw new Error('Not signed in');

      const latestBilling = (await getMySubscriptionStatus()) as BillingSnapshot;
      setBillingState(latestBilling);
      setPeriodEndIso(latestBilling.accessEndsAt ?? null);
      setCancelAtPeriodEnd(Boolean(latestBilling.cancel_at_period_end));

      if (latestBilling.isGrandfathered) {
        setDowngradeConfirmError(
          "This account has grandfathered Pro access. There isn't a monthly renewal to cancel."
        );
        return;
      }

      if (latestBilling.cancel_at_period_end) {
        const alreadyEndDateLabel = latestBilling.accessEndsAt
          ? formatEndDate(latestBilling.accessEndsAt)
          : null;
        const alreadyDaysLeftLabel = getDaysLeftLabel(latestBilling.accessEndsAt);

        setDowngradeConfirmError(
          alreadyEndDateLabel || alreadyDaysLeftLabel
            ? `Renewal is already cancelled. You still have Pro until ${
                alreadyEndDateLabel ?? 'the end of your current period'
              }${alreadyDaysLeftLabel ? ` (${alreadyDaysLeftLabel}).` : '.'}`
            : 'Renewal is already cancelled for this subscription.'
        );
        return;
      }

      const { data: fnDataRaw, error: fnError } = await supabase.functions.invoke(
        'cancel-subscription',
        { body: {} }
      );

      if (fnError) throw fnError;

      const fnData = (fnDataRaw ?? {}) as CancelSubscriptionResponse;

      if (fnData?.ok === false) {
        throw new Error(fnData?.error || 'Could not cancel renewal');
      }

      if (fnData?.action === 'manage_external') {
        const nextPeriodEnd = fnData?.period_end ?? latestBilling.accessEndsAt ?? null;
        const nextEndDateLabel = nextPeriodEnd ? formatEndDate(nextPeriodEnd) : null;

        setPeriodEndIso(nextPeriodEnd);
        setExternalManagementUrl(fnData?.management_url ?? null);
        setExternalManagementStore(fnData?.store ?? null);
        setExternalManagementMessage(
          fnData?.message ||
            getExternalManagementCopy(
              fnData?.store ?? null,
              nextEndDateLabel,
              fnData?.management_url ?? null,
              'cancel'
            )
        );

        if (fnData?.management_url) {
          try {
            const supported = await Linking.canOpenURL(fnData.management_url);
            if (supported) {
              await Linking.openURL(fnData.management_url);
            }
          } catch (openErr) {
            console.log('Auto-open management url failed', openErr);
          }
        }

        return;
      }

      await refreshBillingState();

      if (fnData?.action === 'nothing_to_cancel') {
        setDowngradeConfirmError(
          fnData?.message || 'No active monthly renewal was found for this account.'
        );
        return;
      }

      setDowngradeConfirmError(null);
    } catch (err: any) {
      console.log('UpgradeModal downgrade error', err?.message || err);
      setDowngradeConfirmError(err?.message || 'Downgrade failed');
    } finally {
      setDowngrading(false);
    }
  };

  const doResumeRenewal = async () => {
    try {
      setResuming(true);
      setDowngradeConfirmError(null);

      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!userRes?.user?.id) throw new Error('Not signed in');

      const latestBilling = (await getMySubscriptionStatus()) as BillingSnapshot;
      setBillingState(latestBilling);
      setPeriodEndIso(latestBilling.accessEndsAt ?? null);
      setCancelAtPeriodEnd(Boolean(latestBilling.cancel_at_period_end));

      if (!latestBilling.cancel_at_period_end) {
        setDowngradeConfirmError('Renewal is already active for this subscription.');
        return;
      }

      if (!latestBilling.hasStripeSubscriptionRecord) {
        const nextEndDateLabel = latestBilling.accessEndsAt
          ? formatEndDate(latestBilling.accessEndsAt)
          : null;

        setExternalManagementMessage(
          getExternalManagementCopy(
            externalManagementStore,
            nextEndDateLabel,
            externalManagementUrl,
            'resume'
          )
        );
        return;
      }

      const { data: fnDataRaw, error: fnError } = await supabase.functions.invoke(
        'resume-subscription',
        { body: {} }
      );

      if (fnError) throw fnError;

      const fnData = (fnDataRaw ?? {}) as ResumeSubscriptionResponse;

      if (fnData?.ok === false) {
        throw new Error(fnData?.error || 'Could not resume renewal');
      }

      if (fnData?.action === 'manage_external') {
        const nextPeriodEnd = fnData?.period_end ?? latestBilling.accessEndsAt ?? null;
        const nextEndDateLabel = nextPeriodEnd ? formatEndDate(nextPeriodEnd) : null;

        setPeriodEndIso(nextPeriodEnd);
        setExternalManagementUrl(fnData?.management_url ?? null);
        setExternalManagementStore(fnData?.store ?? null);
        setExternalManagementMessage(
          fnData?.message ||
            getExternalManagementCopy(
              fnData?.store ?? null,
              nextEndDateLabel,
              fnData?.management_url ?? null,
              'resume'
            )
        );

        if (fnData?.management_url) {
          try {
            const supported = await Linking.canOpenURL(fnData.management_url);
            if (supported) {
              await Linking.openURL(fnData.management_url);
            }
          } catch (openErr) {
            console.log('Auto-open management url failed', openErr);
          }
        }

        return;
      }

      await refreshBillingState();
      setExternalManagementMessage(null);
      setExternalManagementUrl(null);
      setExternalManagementStore(null);
      setDowngradeConfirmError('Renewal is back on. Your Pro plan will continue.');
    } catch (err: any) {
      console.log('UpgradeModal resume error', err?.message || err);
      setDowngradeConfirmError(err?.message || 'Could not resume renewal');
    } finally {
      setResuming(false);
    }
  };

  const ctaLabel = isProDisabled
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

  const showExternalManagementState = Boolean(externalManagementMessage);

  const confirmIntroText = showExternalManagementState
    ? externalManagementMessage
    : isGrandfathered
    ? 'This account has grandfathered Pro access. There is no monthly renewal to cancel.'
    : cancelAtPeriodEnd
    ? `Your renewal is already turned off.${
        endDateLabel ? ` You keep Pro until ${endDateLabel}.` : ''
      }${daysLeftLabel ? ` ${daysLeftLabel}.` : ''}`
    : `Your Pro subscription will be cancelled so you won’t be charged again.${
        endDateLabel
          ? ` You’ll keep Pro until ${endDateLabel}, then switch to Free.`
          : ` You’ll keep Pro until the end of your current billing period.`
      }${daysLeftLabel ? ` ${daysLeftLabel}.` : ''}`;

  const confirmTitle = showExternalManagementState
    ? 'Manage subscription in store'
    : isGrandfathered
    ? 'Pro access'
    : cancelAtPeriodEnd
    ? 'Renewal already cancelled'
    : 'Cancel renewal?';

  const canResumeViaApp = cancelAtPeriodEnd && hasStripeSubscriptionRecord;
  const shouldShowResumeButton = cancelAtPeriodEnd;
  const primaryActionIsResume = shouldShowResumeButton && !showExternalManagementState;
  const showDangerAction = !isGrandfathered;

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
                    <Text style={{ color: TEXT_MUTED }}>
                      {`  •  Renewal off until ${endDateLabel}${daysLeftLabel ? ` (${daysLeftLabel})` : ''}`}
                    </Text>
                  ) : null}
                </Text>
              ) : null}

              {currentTier === 'pro' && cancelAtPeriodEnd && daysLeftLabel ? (
                <View style={styles.statusPill}>
                  <Text style={styles.statusPillText}>Pro stays active • {daysLeftLabel}</Text>
                </View>
              ) : null}

              {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

              <View style={[styles.tiersRow, isMobile && styles.tiersRowMobile]}>
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => {
                    setErrorText(null);

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
                    setSelectedTier('pro');

                    if (currentTier === 'pro' && cancelAtPeriodEnd) {
                      openDowngradeConfirm();
                    }
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

                        <Text style={styles.planSubHero}>
                          {currentTier === 'pro' && cancelAtPeriodEnd
                            ? 'Tap to turn renewal back on'
                            : 'Cancel anytime'}
                        </Text>
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
                  (selectedTier !== 'pro' || isProDisabled || upgrading) &&
                    styles.buttonDisabled,
                ]}
                onPress={
                  selectedTier !== 'pro' || isProDisabled || upgrading
                    ? undefined
                    : doUpgradeToPro
                }
                activeOpacity={
                  selectedTier !== 'pro' || isProDisabled || upgrading ? 1 : 0.92
                }
              >
                <Text
                  style={[
                    styles.buttonText,
                    (selectedTier !== 'pro' || isProDisabled || upgrading) &&
                      styles.buttonTextDisabled,
                  ]}
                >
                  {ctaLabel}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={onClose}
                style={styles.laterButton}
                disabled={upgrading || downgrading || resuming}
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
          downgrading || resuming || openingManagement
            ? null
            : setDowngradeConfirmVisible(false)
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
            if (!downgrading && !resuming && !openingManagement) {
              setDowngradeConfirmVisible(false);
            }
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
              <Text style={styles.confirmTitle}>{confirmTitle}</Text>

              <Text style={styles.confirmSub}>{confirmIntroText}</Text>

              {cancelAtPeriodEnd && daysLeftLabel ? (
                <View style={styles.remainingBox}>
                  <Text style={styles.remainingBoxKicker}>TIME REMAINING</Text>
                  <Text style={styles.remainingBoxTitle}>{daysLeftLabel}</Text>
                  {endDateLabel ? (
                    <Text style={styles.remainingBoxText}>Access ends on {endDateLabel}</Text>
                  ) : null}
                </View>
              ) : null}

              {!isGrandfathered && !showExternalManagementState && !cancelAtPeriodEnd ? (
                <View style={styles.confirmList}>
                  <Text style={styles.confirmItem}>After Pro ends, you’ll lose access to:</Text>
                  {downgradeLossBullets.map((t, idx) => (
                    <Text key={`${idx}-${t}`} style={styles.confirmItem}>
                      • {t}
                    </Text>
                  ))}
                </View>
              ) : null}

              {showExternalManagementState ? (
                <View style={styles.externalBox}>
                  <Text style={styles.externalBoxKicker}>SUBSCRIPTION SOURCE</Text>
                  <Text style={styles.externalBoxTitle}>{getStoreLabel(externalManagementStore)}</Text>
                  {endDateLabel ? (
                    <Text style={styles.externalBoxText}>
                      Current access remains active until {endDateLabel}.
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {downgradeConfirmError ? (
                <Text style={styles.errorText}>{downgradeConfirmError}</Text>
              ) : null}

              <View style={[styles.confirmButtonsRow, isMobile && styles.confirmButtonsRowMobile]}>
                <Pressable
                  disabled={downgrading || resuming || openingManagement}
                  onPress={() => setDowngradeConfirmVisible(false)}
                  style={({ pressed }) => [
                    styles.confirmBtn,
                    styles.confirmBtnGhost,
                    pressed && !downgrading && !resuming && !openingManagement
                      ? { opacity: 0.9 }
                      : null,
                    downgrading || resuming || openingManagement ? { opacity: 0.5 } : null,
                  ]}
                >
                  <Text style={styles.confirmBtnGhostText}>
                    {showExternalManagementState ? 'Close' : cancelAtPeriodEnd ? 'Done' : isGrandfathered ? 'Done' : 'Keep Pro'}
                  </Text>
                </Pressable>

                {showDangerAction ? (
                  <Pressable
                    disabled={downgrading || resuming || openingManagement}
                    onPress={
                      showExternalManagementState
                        ? openExternalManagementLink
                        : primaryActionIsResume
                        ? doResumeRenewal
                        : doDowngradeToFree
                    }
                    style={({ pressed }) => [
                      styles.confirmBtn,
                      styles.confirmBtnDanger,
                      pressed && !downgrading && !resuming && !openingManagement
                        ? { opacity: 0.9 }
                        : null,
                      downgrading || resuming || openingManagement ? { opacity: 0.7 } : null,
                    ]}
                  >
                    <View style={styles.confirmDangerInner}>
                      {downgrading || resuming || openingManagement ? (
                        <ActivityIndicator size="small" color="#0B0B0B" />
                      ) : null}
                      <Text style={styles.confirmBtnDangerText}>
                        {showExternalManagementState
                          ? `Open ${getStoreLabel(externalManagementStore)}`
                          : primaryActionIsResume
                          ? canResumeViaApp
                            ? 'Resume Pro renewal'
                            : 'Manage in store'
                          : 'Cancel renewal'}
                      </Text>
                    </View>
                  </Pressable>
                ) : null}
              </View>

              <Text style={styles.confirmFoot}>
                {showExternalManagementState
                  ? 'Store-managed subscriptions must be changed in the store where they were purchased.'
                  : cancelAtPeriodEnd
                  ? 'You can keep using Pro until the access end date above.'
                  : isGrandfathered
                  ? 'Your Pro access remains active.'
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

  statusPill: {
    alignSelf: 'flex-start',
    marginBottom: 12,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(198,166,100,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(198,166,100,0.24)',
  },

  statusPillText: {
    color: TEXT_IVORY,
    fontSize: 11.5,
    fontWeight: '800',
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

  remainingBox: {
    marginTop: 2,
    marginBottom: 10,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(46,212,122,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(46,212,122,0.22)',
  },

  remainingBoxKicker: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: 'rgba(46,212,122,0.92)',
    marginBottom: 4,
    fontFamily: SYSTEM_SANS,
  },

  remainingBoxTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: TEXT_IVORY,
    marginBottom: 4,
    fontFamily: SYSTEM_SANS,
  },

  remainingBoxText: {
    fontSize: 12,
    lineHeight: 17,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },

  externalBox: {
    marginTop: 4,
    marginBottom: 10,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(198,166,100,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(198,166,100,0.24)',
  },

  externalBoxKicker: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: 'rgba(198,166,100,0.84)',
    marginBottom: 4,
    fontFamily: SYSTEM_SANS,
  },

  externalBoxTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: TEXT_IVORY,
    marginBottom: 4,
    fontFamily: SYSTEM_SANS,
  },

  externalBoxText: {
    fontSize: 12,
    lineHeight: 17,
    color: TEXT_MUTED,
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