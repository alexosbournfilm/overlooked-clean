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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { type UserTier } from '../app/lib/supabase';
import { getCurrentUserTierOrFree, invalidateMembershipCache } from '../app/lib/membership';
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
const GOLD_SOFT_2 = 'rgba(198,166,100,0.08)';

// ✅ Premium offer styling (calm, not neon)
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

const HUMAN_TIER_LONG: Record<UserTier, string> = {
  free: 'Free',
  pro: 'Pro',
};

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

export const UpgradeModal: React.FC<Props> = ({
  visible,
  onClose,
  context,
  onSelectPro,
}) => {
  const nav = useNavigation<any>();

  const [selectedTier, setSelectedTier] = useState<UserTier>('pro');
  const [currentTier, setCurrentTier] = useState<UserTier | null>(null);

  const [upgrading, setUpgrading] = useState(false);
  const [downgrading, setDowngrading] = useState(false);

  const [errorText, setErrorText] = useState<string | null>(null);

  const [downgradeConfirmVisible, setDowngradeConfirmVisible] = useState(false);
  const [downgradeConfirmError, setDowngradeConfirmError] = useState<string | null>(null);

  const [offerCountdown, setOfferCountdown] = useState(() => getOfferRemaining());

  useEffect(() => {
    if (!visible) return;

    const tick = () => setOfferCountdown(getOfferRemaining());
    tick();

    // ✅ Clean countdown: update every minute (no seconds)
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

        const tier = await getCurrentUserTierOrFree();
        if (!mounted) return;

        setCurrentTier(tier);
        setSelectedTier(tier);
      } catch (err) {
        console.log('UpgradeModal getCurrentUserTier error', (err as any)?.message || err);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [visible]);

  const title = 'Upgrade to unlock everything';
  const subtitle =
    'Submit films to the Monthly Film Challenge, apply for paid jobs, and get full access to Workshop tools & downloads.';

  const currentTierLabel = currentTier ? HUMAN_TIER_LONG[currentTier] : 'Free';
  const isProDisabled = currentTier === 'pro';
  const offerActive = !offerCountdown.expired;

  const downgradeLossBullets = useMemo(() => {
    return [
      'Monthly Film Challenge submissions will be locked (Pro only).',
      'Paid job applications will be locked (Pro only).',
      'Workshop tools & downloads will be locked (Pro only).',
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
    setDowngradeConfirmVisible(true);
  };

  const doDowngradeToFree = async () => {
    try {
      setDowngrading(true);
      setDowngradeConfirmError(null);

      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!userRes?.user?.id) throw new Error('Not signed in');

      const { error } = await supabase.rpc('downgrade_to_free');
      if (error) throw error;

      const tier = await getCurrentUserTierOrFree({ force: true });
      setCurrentTier(tier);
      setSelectedTier(tier);

      setDowngradeConfirmVisible(false);
      onClose();
    } catch (err: any) {
      console.log('UpgradeModal downgrade error', err?.message || err);
      setDowngradeConfirmError(err?.message || 'Downgrade failed');
    } finally {
      setDowngrading(false);
    }
  };

  const ctaLabel = isProDisabled
    ? "You're on Pro"
    : upgrading
      ? 'Opening checkout…'
      : 'See Pro plans';

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            {/* Header */}
            <View style={styles.header}>
              <View style={{ flex: 1, minWidth: 240 }}>
                <Text style={styles.kicker}>UPGRADE</Text>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.subtitle}>{subtitle}</Text>
              </View>
            </View>

            {currentTier && (
              <Text style={styles.currentTierText}>
                Current plan: <Text style={styles.currentTierName}>{currentTierLabel}</Text>
              </Text>
            )}

            {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

            <View style={styles.tiersRow}>
              {/* Free */}
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
                  selectedTier === 'free' && styles.tierCardSelected,
                  currentTier === 'free' && styles.tierCardCurrentFree,
                ]}
              >
                {/* ✅ Clean: no “CURRENT PLAN” header inside card */}
                <Text style={styles.freeSmallLabel}>Free</Text>

                <Text style={styles.tierNameFree}>Free</Text>
                <Text style={styles.tierTaglineMuted}>Browse, connect, collaborate</Text>

                <View style={styles.priceRow}>
                  <Text style={styles.priceMain}>FREE</Text>
                  <Text style={styles.priceSub}>forever</Text>
                </View>

                <View style={styles.dividerSoft} />

                <View style={styles.featureList}>
                  <Text style={styles.featureItemMuted}>✓ Discover and connect with filmmakers worldwide</Text>
                  <Text style={styles.featureItemMuted}>✓ Browse profiles and message other creatives</Text>
                  <Text style={styles.featureItemMuted}>✓ Join city-based group chats and find local crews</Text>
                  <Text style={styles.featureItemMuted}>✓ Apply for free jobs and post your own gigs</Text>
                </View>
              </TouchableOpacity>

              {/* Pro */}
              <TouchableOpacity
                activeOpacity={0.92}
                onPress={() => {
                  setErrorText(null);
                  setSelectedTier('pro');
                }}
                style={[
                  styles.tierCard,
                  styles.proCard,
                  selectedTier === 'pro' && styles.tierCardSelectedPro,
                  currentTier === 'pro' && styles.tierCardCurrentPro,
                ]}
              >
                {/* ✅ Offer strip stays */}
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

                <Text style={styles.tierName}>Pro</Text>
                <Text style={styles.tierTagline}>Submit, apply, unlock everything</Text>

                {/* Plans */}
                <View style={styles.plansArea}>
                  <View style={styles.planRow}>
                    {/* Lifetime hero */}
                    <View style={[styles.planTile, styles.planTileHero]}>
                      {/* ✅ Remove green bubble + align like other tiles */}
                      <Text style={[styles.planKicker, styles.planKickerHero]}>LIFETIME</Text>

                      <View style={styles.planPriceRow}>
                        <Text style={styles.planCurrency}>£</Text>
                        <Text style={styles.planPriceHero}>25</Text>
                      </View>

                      <Text style={styles.planSubHero}>
                        {offerCountdown.expired ? 'Offer ended' : 'Ends Jan 25'}
                      </Text>
                    </View>

                    {/* Yearly */}
                    <View style={[styles.planTile, styles.planTileSecondary]}>
                      <Text style={styles.planKicker}>YEARLY</Text>
                      <View style={styles.planPriceRow}>
                        <Text style={styles.planCurrency}>£</Text>
                        <Text style={styles.planPrice}>49.99</Text>
                      </View>
                      {/* ✅ Add cancel anytime under yearly */}
                      <Text style={styles.planSub}>Cancel anytime</Text>
                    </View>

                    {/* Monthly */}
                    <View style={[styles.planTile, styles.planTileSecondary]}>
                      <Text style={styles.planKicker}>MONTHLY</Text>
                      <View style={styles.planPriceRow}>
                        <Text style={styles.planCurrency}>£</Text>
                        <Text style={styles.planPrice}>4.99</Text>
                      </View>
                      <Text style={styles.planSub}>Cancel anytime</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.dividerUltraSoft} />

                <View style={styles.featureList}>
                  <Text style={styles.featureItem}>✓ Submit films to the Monthly Film Challenge</Text>
                  <Text style={styles.featureItem}>✓ Apply for all paid jobs</Text>
                  <Text style={styles.featureItem}>✓ Full access to Workshop tools & downloads</Text>
                </View>
              </TouchableOpacity>
            </View>

            {/* CTA */}
            <TouchableOpacity
              style={[
                styles.buttonBase,
                styles.proButton,
                (selectedTier !== 'pro' || isProDisabled || upgrading) && styles.buttonDisabled,
              ]}
              onPress={
                selectedTier !== 'pro' || isProDisabled || upgrading ? undefined : doUpgradeToPro
              }
              activeOpacity={selectedTier !== 'pro' || isProDisabled || upgrading ? 1 : 0.92}
            >
              <Text
                style={[
                  styles.buttonText,
                  (selectedTier !== 'pro' || isProDisabled || upgrading) && styles.buttonTextDisabled,
                ]}
              >
                {ctaLabel}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onClose}
              style={styles.laterButton}
              disabled={upgrading || downgrading}
            >
              <Text style={styles.laterText}>Maybe later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Downgrade confirmation */}
      <Modal
        visible={downgradeConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => (downgrading ? null : setDowngradeConfirmVisible(false))}
      >
        <View style={styles.backdrop}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Downgrade to Free?</Text>
            <Text style={styles.confirmSub}>
              Are you sure you want to downgrade? You’ll lose access to Pro features immediately:
            </Text>

            <View style={styles.confirmList}>
              {downgradeLossBullets.map((t, idx) => (
                <Text key={`${idx}-${t}`} style={styles.confirmItem}>
                  • {t}
                </Text>
              ))}
            </View>

            {downgradeConfirmError ? (
              <Text style={styles.errorText}>{downgradeConfirmError}</Text>
            ) : null}

            <View style={styles.confirmButtonsRow}>
              <Pressable
                disabled={downgrading}
                onPress={() => setDowngradeConfirmVisible(false)}
                style={({ pressed }) => [
                  styles.confirmBtn,
                  styles.confirmBtnGhost,
                  pressed && !downgrading ? { opacity: 0.9 } : null,
                  downgrading ? { opacity: 0.5 } : null,
                ]}
              >
                <Text style={styles.confirmBtnGhostText}>Cancel</Text>
              </Pressable>

              <Pressable
                disabled={downgrading}
                onPress={doDowngradeToFree}
                style={({ pressed }) => [
                  styles.confirmBtn,
                  styles.confirmBtnDanger,
                  pressed && !downgrading ? { opacity: 0.9 } : null,
                  downgrading ? { opacity: 0.7 } : null,
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {downgrading ? <ActivityIndicator size="small" color="#0B0B0B" /> : null}
                  <Text style={styles.confirmBtnDangerText}>
                    {downgrading ? 'Downgrading…' : 'Yes, downgrade'}
                  </Text>
                </View>
              </Pressable>
            </View>

            <Text style={styles.confirmFoot}>Tip: you can upgrade again any time.</Text>
          </View>
        </View>
      </Modal>
    </>
  );
};

/* --------------------------------- styles -------------------------------- */

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },

  card: {
    width: '100%',
    maxWidth: 920,
    borderRadius: 22,
    paddingVertical: 18,
    paddingHorizontal: 18,
    backgroundColor: DARK_ELEVATED,
    borderWidth: 1,
    borderColor: HAIRLINE,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
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

  planTile: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0,
  },

  planTileHero: {
    backgroundColor: OFFER_TILE_BG,
    borderWidth: 1,
    borderColor: OFFER_TILE_BORDER,
    // ✅ keep same vertical rhythm as other tiles
    paddingVertical: 10,
  },

  planTileSecondary: {
    backgroundColor: 'rgba(255,255,255,0.025)',
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

  ctaMicro: {
    marginTop: 8,
    textAlign: 'center',
    fontSize: 11.5,
    color: 'rgba(237,235,230,0.55)',
    fontFamily: SYSTEM_SANS,
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

  /* -------- confirm modal -------- */

  confirmCard: {
    width: '100%',
    maxWidth: 620,
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 18,
    backgroundColor: DARK_ELEVATED,
    borderWidth: 1,
    borderColor: HAIRLINE,
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

  confirmButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
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
