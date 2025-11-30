// app/components/UpgradeModal.tsx
import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { type UserTier } from '../app/lib/supabase';
import { getCurrentUserTierOrNetworking } from '../app/lib/membership';

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
  onSelectArtist?: () => void;
  onSelectTommy?: () => void;
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
  networking: 'Networking (Free)',
  artist: 'Artist – £6.99 / month',
  tommy: 'Tommy – £9.99 / month',
};

export const UpgradeModal: React.FC<Props> = ({
  visible,
  onClose,
  context,
  onSelectArtist,
  onSelectTommy,
}) => {
  const [selectedTier, setSelectedTier] = useState<UserTier>('artist');
  const [currentTier, setCurrentTier] = useState<UserTier | null>(null);

  useEffect(() => {
    if (!visible) return;
    let mounted = true;

    (async () => {
      try {
        const tier = await getCurrentUserTierOrNetworking();
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
      : 'Unlock More on Overlooked';

  const currentTierLabel = currentTier
    ? HUMAN_TIER_LONG[currentTier]
    : 'Networking (Free)';

  const isArtistDisabled = currentTier === 'artist' || currentTier === 'tommy';
  const isTommyDisabled = currentTier === 'tommy';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Header */}
          <Text style={styles.kicker}>UPGRADE</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>
            Choose a plan to unlock more challenge submissions, paid jobs, and premium resources.
          </Text>

          {currentTier && (
            <Text style={styles.currentTierText}>
              Current plan:{' '}
              <Text style={styles.currentTierName}>{currentTierLabel}</Text>
            </Text>
          )}

          {/* Tiers */}
          <View style={styles.tiersRow}>
            {/* Networking */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setSelectedTier('networking')}
              style={[
                styles.tierCard,
                selectedTier === 'networking' && styles.tierCardSelected,
                currentTier === 'networking' && styles.tierCardCurrent,
              ]}
            >
              <Text style={styles.tierLabel}>
                {currentTier === 'networking' ? 'Current Plan' : 'Free'}
              </Text>

              <Text style={styles.tierName}>Networking</Text>
              <Text style={styles.tierTagline}>Build your creative network</Text>

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

            {/* Artist */}
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => setSelectedTier('artist')}
              style={[
                styles.tierCard,
                styles.tierCardEmphasis,
                selectedTier === 'artist' && styles.tierCardSelected,
                currentTier === 'artist' && styles.tierCardCurrent,
              ]}
            >
              <Text style={styles.tierLabel}>
                {currentTier === 'artist' ? 'Current Plan' : ''}
              </Text>

              <Text style={styles.tierName}>Artist</Text>
              <Text style={styles.tierTagline}>Showcase your work, get seen</Text>

              <View style={styles.priceRow}>
                <Text style={styles.priceCurrency}>£</Text>
                <Text style={styles.priceMain}>6.99</Text>
                <Text style={styles.priceSub}>/ month</Text>
              </View>

              <View style={styles.divider} />

              <View style={styles.featureList}>
                <Text style={styles.featureItem}>✓ Everything in Networking</Text>
                <Text style={styles.featureItem}>✓ Up to 3 challenge submissions / month</Text>
                <Text style={styles.featureItem}>✓ Apply for all paid jobs</Text>
                <Text style={styles.featureItem}>✓ Priority visibility on job applications</Text>
              </View>
            </TouchableOpacity>

            {/* Tommy */}
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => setSelectedTier('tommy')}
              style={[
                styles.tierCard,
                selectedTier === 'tommy' && styles.tierCardSelected,
                currentTier === 'tommy' && styles.tierCardCurrent,
              ]}
            >
              <Text style={styles.tierLabel}>
                {currentTier === 'tommy' ? 'Current Plan' : 'All-Access'}
              </Text>

              <Text style={styles.tierName}>Tommy</Text>
              <Text style={styles.tierTagline}>For those taking their art seriously</Text>

              <View style={styles.priceRow}>
                <Text style={styles.priceCurrency}>£</Text>
                <Text style={styles.priceMain}>9.99</Text>
                <Text style={styles.priceSub}>/ month</Text>
              </View>

              <View style={styles.divider} />

              <View style={styles.featureList}>
                <Text style={styles.featureItem}>✓ Up to 6 challenge submissions / month</Text>
                <Text style={styles.featureItem}>✓ Highest priority on paid job applications</Text>
                <Text style={styles.featureItem}>✓ Full access to all workshop products & releases</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Buttons */}
          <TouchableOpacity
            style={[styles.buttonBase, styles.artistButton, isArtistDisabled && styles.buttonDisabled]}
            onPress={isArtistDisabled ? undefined : onSelectArtist}
            activeOpacity={isArtistDisabled ? 1 : 0.9}
          >
            <Text style={[styles.buttonText, isArtistDisabled && styles.buttonTextDisabled]}>
              {currentTier === 'artist'
                ? "You're on Artist"
                : currentTier === 'tommy'
                ? 'Included in Tommy'
                : 'Upgrade to Artist'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.buttonBase, styles.tommyButton, isTommyDisabled && styles.buttonDisabled]}
            onPress={isTommyDisabled ? undefined : onSelectTommy}
            activeOpacity={isTommyDisabled ? 1 : 0.9}
          >
            <Text style={[styles.buttonText, isTommyDisabled && styles.buttonTextDisabled]}>
              {currentTier === 'tommy' ? "You're on Tommy" : 'Upgrade to Tommy'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={styles.laterButton}>
            <Text style={styles.laterText}>Maybe later</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
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
  tiersRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
    flexWrap: 'wrap',
  },
  tierCard: {
    flex: 1,
    minWidth: 220,
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
  artistButton: {
    backgroundColor: GOLD,
  },
  tommyButton: {
    marginTop: 10,
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
});
