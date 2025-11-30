import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  Image,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase, type UserTier } from '../lib/supabase';
import { UpgradeModal } from '../../components/UpgradeModal';

/* ------------------------------- palette ------------------------------- */
const DARK_BG = '#0D0D0D';
const DARK_ELEVATED = '#171717';
const TEXT_IVORY = '#EDEBE6';
const TEXT_MUTED = '#A7A6A2';
const GOLD = '#C6A664';

/* ------------------------------- fonts --------------------------------- */
const SYSTEM_SANS = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: undefined,
  default: undefined,
});

/* ------------------------------- types --------------------------------- */
type WorkshopProduct = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price_cents: number;
  currency: string;
  image_url: string | null;
  file_url: string | null;
  is_active: boolean;
  created_at: string;
};

type WorkshopPurchase = { product_id: string };

type UserProfile = {
  id: string;
  tier: UserTier;
};

/* ------------------------------- screen -------------------------------- */
const WorkshopScreen: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [products, setProducts] = useState<WorkshopProduct[]>([]);
  const [purchases, setPurchases] = useState<WorkshopPurchase[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  // Upgrade modal state
  const [upgradeVisible, setUpgradeVisible] = useState(false);

  const loadWorkshop = async () => {
    try {
      setLoading(true);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) console.warn('Workshop: auth error:', userError.message);

      if (user) {
        const { data: profileData, error: profileErr } = await supabase
          .from('users')
          .select('id, tier')
          .eq('id', user.id)
          .single();
        if (profileErr) {
          console.warn('Workshop: profile error:', profileErr.message);
        } else if (profileData) {
          setUserProfile({ id: profileData.id, tier: profileData.tier as UserTier });
        }

        const { data: purchaseData, error: purchaseErr } = await supabase
          .from('workshop_purchases')
          .select('product_id')
          .eq('user_id', user.id);
        if (purchaseErr) {
          console.warn('Workshop: purchases error:', purchaseErr.message);
        } else if (purchaseData) {
          setPurchases(purchaseData as WorkshopPurchase[]);
        }
      } else {
        setUserProfile(null);
        setPurchases([]);
      }

      const { data: productData, error: productErr } = await supabase
        .from('workshop_products')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: true });

      if (productErr) {
        console.warn('Workshop: products error:', productErr.message);
      } else if (productData) {
        setProducts(productData as WorkshopProduct[]);
      }
    } catch (err: any) {
      console.warn('Workshop: unexpected error:', err?.message || err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadWorkshop();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadWorkshop();
    }, [])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadWorkshop();
  };

  /* --------------------------- access helpers -------------------------- */
  const hasAccess = (product: WorkshopProduct): boolean => {
    // Now only Tommy tier or explicit purchases can access.
    if (!userProfile) return false;
    if (userProfile.tier === 'tommy') return true;
    return purchases.some((p) => p.product_id === product.id);
  };

  const formatPrice = (product: WorkshopProduct): string => {
    if (product.price_cents === 0) return 'Free';
    const amount = (product.price_cents / 100).toFixed(2);
    const prefix = product.currency === 'GBP' ? '£' : `${product.currency} `;
    return `${prefix}${amount}`;
  };

  const openProductContent = (product: WorkshopProduct) => {
    if (!hasAccess(product)) {
      // Fallback guard – should normally be handled before calling this
      setUpgradeVisible(true);
      return;
    }
    if (!product.file_url) {
      Alert.alert(
        'Coming soon',
        'You have access, but the download link for this pack has not been set yet.'
      );
      return;
    }
    Linking.openURL(product.file_url).catch(() => {
      Alert.alert('Error', 'Unable to open this link on your device.');
    });
  };

  const renderCTA = (product: WorkshopProduct) => {
    const access = hasAccess(product);
    const isTommy = userProfile?.tier === 'tommy';

    // If user has access (Tommy or explicit purchase) → real download/access
    if (access) {
      const isStarter =
        product.slug === 'starter-lut-pack' ||
        product.slug === 'out-pack' ||
        product.name.toLowerCase() === 'out pack';

      const label = isStarter ? 'Download pack' : 'Access pack';

      return (
        <TouchableOpacity
          style={[styles.ctaButton, styles.ctaButtonOutline]}
          onPress={() => openProductContent(product)}
          activeOpacity={0.9}
        >
          <Text style={[styles.ctaText, styles.ctaTextOutline]} numberOfLines={1}>
            {label}
          </Text>
        </TouchableOpacity>
      );
    }

    // No access: always show Upgrade modal for Workshop
    const label = isTommy ? 'Access with Tommy' : 'Unlock with Tommy';

    return (
      <TouchableOpacity
        style={styles.ctaButton}
        onPress={() => setUpgradeVisible(true)}
        activeOpacity={0.9}
      >
        <Text style={styles.ctaText} numberOfLines={1}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  /* ------------------------------ render ------------------------------- */
  return (
    <View style={styles.container}>
      {/* Centered header */}
      <View style={styles.header}>
        <Ionicons name="cube-outline" size={20} color={GOLD} />
        <Text style={styles.headerTitle}>Workshop</Text>
      </View>

      {/* Professional intro copy */}
      <Text style={styles.intro}>
        The Workshop curates hand-crafted, practical tools designed to help creatives at every stage
        produce stronger work.
        {'\n'}All products are included with the premium{' '}
        <Text style={styles.introEmph}>Tommy Tier</Text>.
      </Text>

      {loading && !refreshing ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={GOLD} />
          <Text style={styles.loadingText}>Loading Workshop...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GOLD} />
          }
        >
          {products.length === 0 && (
            <View style={styles.emptyState}>
              <Ionicons name="cube-outline" size={30} color={TEXT_MUTED} />
              <Text style={styles.emptyTitle}>Nothing in the crate yet</Text>
              <Text style={styles.emptyText}>
                Your first Workshop pack will drop here soon.
              </Text>
            </View>
          )}

          {products.map((product) => {
            // ✨ Treat the existing OUT PACK row as the STARTER LUT Pack, but now gated by tier.
            const isStarter =
              product.slug === 'starter-lut-pack' ||
              product.slug === 'out-pack' ||
              product.name.toLowerCase() === 'out pack';

            const mappedProduct: WorkshopProduct = isStarter
              ? {
                  ...product,
                  name: 'STARTER LUT Pack',
                  slug: 'starter-lut-pack',
                  description:
                    'A compact pack of six clean, versatile starter LUTs designed to give your footage instant polish. Perfect for experimenting inside Overlooked and shaping your first cinematic cuts.',
                  price_cents: product.price_cents ?? 0,
                  currency: product.currency || 'GBP',
                  file_url:
                    'https://sdatmuzzsebvckfmnqsv.supabase.co/storage/v1/object/public/avatars/STARTER.zip',
                }
              : product;

            const access = hasAccess(mappedProduct);
            const isTommy = userProfile?.tier === 'tommy';

            return (
              <View key={mappedProduct.id} style={styles.card}>
                <View style={styles.thumbWrap}>
                  {mappedProduct.image_url ? (
                    <Image source={{ uri: mappedProduct.image_url }} style={styles.thumb} />
                  ) : (
                    <View style={styles.thumbPlaceholder}>
                      <Ionicons name="film-outline" size={22} color={GOLD} />
                    </View>
                  )}
                </View>

                <View style={styles.cardBody}>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {mappedProduct.name}
                    </Text>

                    {isTommy && (
                      <View style={styles.badgeTommy}>
                        <Text style={styles.badgeTommyText}>Tommy</Text>
                      </View>
                    )}

                    {access && !isTommy && (
                      <View style={styles.badgeOwned}>
                        <Text style={styles.badgeOwnedText}>
                          {isStarter ? 'Unlocked' : 'Owned'}
                        </Text>
                      </View>
                    )}
                  </View>

                  {mappedProduct.description ? (
                    <Text style={styles.cardDescription} numberOfLines={3}>
                      {mappedProduct.description}
                    </Text>
                  ) : null}

                  {/* Meta row */}
                  {isStarter ? (
                    <View style={styles.metaRow}>
                      <Text style={styles.metaHint}>
                        Free beta download • included with Tommy while we’re in early access.
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.metaRow}>
                      <Text style={styles.priceLabel}>{formatPrice(mappedProduct)}</Text>
                      {!access && mappedProduct.price_cents > 0 && (
                        <Text style={styles.metaHint}>Included with Tommy</Text>
                      )}
                      {access && <Text style={styles.metaHint}>Unlocked</Text>}
                    </View>
                  )}

                  {renderCTA(mappedProduct)}
                </View>
              </View>
            );
          })}

          {/* Big footer message to fill empty space */}
          {products.length > 0 && (
            <Text style={styles.comingSoonBig}>MORE TOOLS COMING SOON.</Text>
          )}
        </ScrollView>
      )}

      {/* Upgrade modal for Workshop context */}
      <UpgradeModal
        visible={upgradeVisible}
        onClose={() => setUpgradeVisible(false)}
        context="workshop"
        onSelectArtist={() => {
          setUpgradeVisible(false);
          Alert.alert(
            'Upgrade to Artist',
            'The Artist upgrade flow is not wired up yet. Once it is, you’ll unlock extra challenge submissions and access to paid jobs.'
          );
        }}
        onSelectTommy={() => {
          setUpgradeVisible(false);
          Alert.alert(
            'Upgrade to Tommy',
            'The Tommy upgrade flow is not wired up yet. Once it is, you’ll unlock all Workshop products automatically.'
          );
        }}
      />
    </View>
  );
};

export default WorkshopScreen;

/* -------------------------------- styles ------------------------------- */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_BG,
  },
  header: {
    marginTop: 8,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1.4,
    color: TEXT_IVORY,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },
  intro: {
    paddingHorizontal: 18,
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    color: TEXT_MUTED,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },
  introEmph: {
    color: GOLD,
    fontWeight: '800',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 12,
    gap: 8,
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 10,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },
  scroll: {
    flex: 1,
    marginTop: 10,
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingBottom: 64,
  },
  emptyState: {
    alignItems: 'center',
    marginTop: 48,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    marginTop: 10,
    fontSize: 15,
    fontWeight: '800',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },
  emptyText: {
    marginTop: 4,
    fontSize: 10,
    color: TEXT_MUTED,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },
  card: {
    flexDirection: 'row',
    padding: 10,
    marginBottom: 10,
    borderRadius: 16,
    backgroundColor: DARK_ELEVATED,
    borderWidth: 1,
    borderColor: '#262626',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 6,
  },
  thumbWrap: {
    width: 70,
    marginRight: 10,
  },
  thumb: {
    width: '100%',
    height: 70,
    borderRadius: 10,
  },
  thumbPlaceholder: {
    width: '100%',
    height: 70,
    borderRadius: 10,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  cardBody: { flex: 1 },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardTitle: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '800',
    color: TEXT_IVORY,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontFamily: SYSTEM_SANS,
  },
  badgeTommy: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: GOLD,
  },
  badgeTommyText: {
    fontSize: 8,
    fontWeight: '800',
    color: '#050505',
    fontFamily: SYSTEM_SANS,
  },
  badgeOwned: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: GOLD,
  },
  badgeOwnedText: {
    fontSize: 8,
    fontWeight: '700',
    color: GOLD,
    fontFamily: SYSTEM_SANS,
  },
  cardDescription: {
    marginTop: 2,
    fontSize: 9,
    color: TEXT_MUTED,
    lineHeight: 12,
    fontFamily: SYSTEM_SANS,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 8,
  },
  priceLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },
  metaHint: {
    fontSize: 8,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },
  ctaButton: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: GOLD,
  },
  ctaButtonOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: GOLD,
  },
  ctaText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#050505',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },
  ctaTextOutline: { color: GOLD },

  // Giant footer banner
  comingSoonBig: {
    marginTop: 28,
    marginBottom: 6,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
    color: TEXT_MUTED,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontSize: Platform.select({ ios: 22, android: 22, web: 28 }),
    opacity: 0.9,
  },
});
