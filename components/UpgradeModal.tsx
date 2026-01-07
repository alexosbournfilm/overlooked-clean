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
const TEXT_IVORY = '#EDEBE6';
const TEXT_MUTED = '#A7A6A2';
const DIVIDER = '#2A2A2A';
const GOLD = '#C6A664';

const SYSTEM_SANS = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: undefined,
  default: undefined,
});

const HUMAN_TIER_LONG: Record<UserTier, string> = {
  free: 'Free',
  pro: 'Pro – £4.99 / month',
};

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
        console.log(
          'UpgradeModal getCurrentUserTier error',
          (err as any)?.message || err
        );
      }
    })();

    return () => {
      mounted = false;
    };
  }, [visible]);

  const title =
    context === 'challenge'
      ? 'Submit to the Monthly Challenge'
      : context === 'jobs'
      ? 'Apply for Paid Jobs'
      : context === 'workshop'
      ? 'Unlock Workshop Products'
      : context === 'extra_submission'
      ? 'Unlock More Submissions'
      : 'Unlock More on Overlooked';

  const currentTierLabel = currentTier ? HUMAN_TIER_LONG[currentTier] : 'Free';

  const isProDisabled = currentTier === 'pro';

  const downgradeLossBullets = useMemo(() => {
    // Always show the full truth (not just the context), but lead with the relevant one.
    const all = [
      'Monthly challenge submissions will be locked (Pro only).',
      'Paid job applications will be locked (Pro only).',
      'Workshop products & downloads will be locked (Pro only).',
    ];

    if (context === 'challenge') {
      return [
        'You will lose access to monthly challenge submissions.',
        'Paid job applications will be locked (Pro only).',
        'Workshop products & downloads will be locked (Pro only).',
      ];
    }
    if (context === 'jobs') {
      return [
        'You will lose access to paid job applications.',
        'Monthly challenge submissions will be locked (Pro only).',
        'Workshop products & downloads will be locked (Pro only).',
      ];
    }
    if (context === 'workshop') {
      return [
        'You will lose access to Workshop products & downloads.',
        'Monthly challenge submissions will be locked (Pro only).',
        'Paid job applications will be locked (Pro only).',
      ];
    }
    if (context === 'extra_submission') {
      return [
        'You will lose access to monthly challenge submissions.',
        'Paid job applications will be locked (Pro only).',
        'Workshop products & downloads will be locked (Pro only).',
      ];
    }

    return all;
  }, [context]);

  // ✅ REAL UPGRADE: go to Stripe Paywall
  const doUpgradeToPro = async () => {
    try {
      setUpgrading(true);
      setErrorText(null);

      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!userRes?.user?.id) throw new Error('Not signed in');

      // Clear cached tier so the app re-reads as soon as Stripe updates DB
      invalidateMembershipCache();

      // Optional hook for analytics/UI
      if (onSelectPro) onSelectPro();

      // Close modal then navigate to Paywall
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

      // Refresh tier from DB
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

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={onClose}
      >
        <View style={styles.backdrop}>
          <View style={styles.card}>
            {/* Header */}
            <Text style={styles.kicker}>UPGRADE</Text>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>
              Go Pro to unlock challenge submissions, paid jobs, and all Workshop tools.
            </Text>

            {currentTier && (
              <Text style={styles.currentTierText}>
                Current plan:{' '}
                <Text style={styles.currentTierName}>{currentTierLabel}</Text>
              </Text>
            )}

            {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

            {/* Tiers */}
            <View style={styles.tiersRow}>
              {/* Free */}
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => {
                  setErrorText(null);

                  // If they're on Pro, clicking Free should prompt downgrade confirmation.
                  if (currentTier === 'pro') {
                    setSelectedTier('free');
                    openDowngradeConfirm();
                    return;
                  }

                  // If they’re already Free (or tier unknown), just select it.
                  setSelectedTier('free');
                }}
                style={[
                  styles.tierCard,
                  selectedTier === 'free' && styles.tierCardSelected,
                  currentTier === 'free' && styles.tierCardCurrent,
                ]}
              >
                <Text style={styles.tierLabel}>
                  {currentTier === 'free' ? 'Current Plan' : 'Free'}
                </Text>

                <Text style={styles.tierName}>Free</Text>
                <Text style={styles.tierTagline}>Browse, connect, collaborate</Text>

                <View style={styles.priceRow}>
                  <Text style={styles.priceMain}>FREE</Text>
                  <Text style={styles.priceSub}>forever</Text>
                </View>

                <View style={styles.divider} />

                <View style={styles.featureList}>
                  <Text style={styles.featureItem}>✓ Discover and connect with filmmakers worldwide</Text>
                  <Text style={styles.featureItem}>✓ Browse profiles and message other creatives</Text>
                  <Text style={styles.featureItem}>✓ Join city-based group chats and find local crews</Text>
                  <Text style={styles.featureItem}>✓ Apply for free jobs and post your own gigs</Text>
                </View>
              </TouchableOpacity>

              {/* Pro */}
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => {
                  setErrorText(null);
                  setSelectedTier('pro');
                }}
                style={[
                  styles.tierCard,
                  styles.tierCardEmphasis,
                  selectedTier === 'pro' && styles.tierCardSelected,
                  currentTier === 'pro' && styles.tierCardCurrent,
                ]}
              >
                <Text style={styles.tierLabel}>
                  {currentTier === 'pro' ? 'Current Plan' : 'Pro'}
                </Text>

                <Text style={styles.tierName}>Pro</Text>
                <Text style={styles.tierTagline}>Submit, apply, unlock everything</Text>

                <View style={styles.priceRow}>
                  <Text style={styles.priceCurrency}>£</Text>
                  <Text style={styles.priceMain}>4.99</Text>
                  <Text style={styles.priceSub}>/ month</Text>
                </View>

                <View style={styles.divider} />

                <View style={styles.featureList}>
                  <Text style={styles.featureItem}>✓ 2 challenge submissions / month</Text>
                  <Text style={styles.featureItem}>✓ Apply for all paid jobs</Text>
                  <Text style={styles.featureItem}>✓ Full access to all workshop products & releases</Text>
                </View>
              </TouchableOpacity>
            </View>

            {/* Main CTA (Upgrade) */}
            <TouchableOpacity
              style={[
                styles.buttonBase,
                styles.proButton,
                (selectedTier !== 'pro' || isProDisabled || upgrading) && styles.buttonDisabled,
              ]}
              onPress={
                selectedTier !== 'pro' || isProDisabled || upgrading
                  ? undefined
                  : doUpgradeToPro
              }
              activeOpacity={selectedTier !== 'pro' || isProDisabled || upgrading ? 1 : 0.9}
            >
              <Text
                style={[
                  styles.buttonText,
                  (selectedTier !== 'pro' || isProDisabled || upgrading) &&
                    styles.buttonTextDisabled,
                ]}
              >
                {isProDisabled ? "You're on Pro" : upgrading ? 'Opening checkout…' : 'Upgrade to Pro'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={onClose} style={styles.laterButton} disabled={upgrading || downgrading}>
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

            <Text style={styles.confirmFoot}>
              Tip: you can upgrade again any time.
            </Text>
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
    maxWidth: 880,
    borderRadius: 24,
    paddingVertical: 22,
    paddingHorizontal: 20,
    backgroundColor: DARK_ELEVATED,
    borderWidth: 1,
    borderColor: DIVIDER,
  },

  kicker: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.8,
    color: GOLD,
    textTransform: 'uppercase',
    marginBottom: 4,
    fontFamily: SYSTEM_SANS,
  },

  title: {
    fontSize: 20,
    fontWeight: '800',
    color: TEXT_IVORY,
    marginBottom: 6,
    fontFamily: SYSTEM_SANS,
  },

  subtitle: {
    fontSize: 13,
    color: TEXT_MUTED,
    marginBottom: 6,
    maxWidth: 560,
    fontFamily: SYSTEM_SANS,
  },

  currentTierText: {
    fontSize: 12,
    color: TEXT_MUTED,
    marginBottom: 16,
    fontFamily: SYSTEM_SANS,
  },

  currentTierName: {
    color: GOLD,
    fontWeight: '700',
  },

  errorText: {
    fontSize: 12,
    color: '#FFB3B3',
    marginTop: 10,
    fontFamily: SYSTEM_SANS,
  },

  tiersRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
    flexWrap: 'wrap',
  },

  tierCard: {
    flex: 1,
    minWidth: 260,
    marginHorizontal: 4,
    marginBottom: 10,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: '#262626',
  },

  tierCardEmphasis: {
    borderColor: GOLD,
  },

  tierCardSelected: {
    borderColor: GOLD,
    backgroundColor: '#151515',
  },

  tierCardCurrent: {
    borderColor: GOLD,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },

  tierLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: GOLD,
    marginBottom: 6,
    fontFamily: SYSTEM_SANS,
  },

  tierName: {
    fontSize: 16,
    fontWeight: '800',
    color: TEXT_IVORY,
    marginBottom: 2,
    fontFamily: SYSTEM_SANS,
  },

  tierTagline: {
    fontSize: 11,
    color: TEXT_MUTED,
    marginBottom: 10,
    fontFamily: SYSTEM_SANS,
  },

  priceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 8,
  },

  priceCurrency: {
    fontSize: 16,
    fontWeight: '700',
    color: TEXT_IVORY,
    marginRight: 2,
    fontFamily: SYSTEM_SANS,
  },

  priceMain: {
    fontSize: 24,
    fontWeight: '800',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },

  priceSub: {
    fontSize: 11,
    color: TEXT_MUTED,
    marginLeft: 6,
    marginBottom: 2,
    fontFamily: SYSTEM_SANS,
  },

  divider: {
    height: 1,
    backgroundColor: '#262626',
    marginVertical: 10,
  },

  featureList: {
    gap: 4,
  },

  featureItem: {
    fontSize: 11.5,
    lineHeight: 18,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },

  buttonBase: {
    marginTop: 4,
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
    fontWeight: '700',
    fontSize: 15,
    letterSpacing: 0.4,
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

  /* -------- confirm modal -------- */

  confirmCard: {
    width: '100%',
    maxWidth: 620,
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 18,
    backgroundColor: DARK_ELEVATED,
    borderWidth: 1,
    borderColor: DIVIDER,
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
    borderColor: '#3A3A3A',
    backgroundColor: '#111111',
  },

  confirmBtnGhostText: {
    color: TEXT_IVORY,
    fontWeight: '800',
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
