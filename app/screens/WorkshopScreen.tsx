import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Modal,
  Pressable,
  Dimensions,
  Animated,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Video, ResizeMode } from 'expo-av';
import { supabase, type UserTier } from '../lib/supabase';
import { UpgradeModal } from '../../components/UpgradeModal';

/* ------------------------------- palette ------------------------------- */
const DARK_BG = '#0D0D0D';
const DARK_ELEVATED = '#171717';
const DARK_ELEVATED_2 = '#141414';
const TEXT_IVORY = '#EDEBE6';
const TEXT_MUTED = '#A7A6A2';
const GOLD = '#C6A664';

const IS_WEB = Platform.OS === 'web';

// ✅ TS-safe web-only style (not in StyleSheet because objectFit isn't ViewStyle)
const WEB_VIDEO_FIT = IS_WEB ? ({ objectFit: 'contain' } as any) : undefined;

// ✅ Starter LUT Pack preview image for the main list thumbnail slot
const STARTER_LUT_PACK_PREVIEW_IMAGE =
  'https://sdatmuzzsebvckfmnqsv.supabase.co/storage/v1/object/public/LUT%20PACK%20IMAGE%20PREVIEW/STARTER%20LUT%20PACK%20IMAGE_1.30.1.jpg';

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

  // Optional: you can add later in Supabase with no code changes.
  preview_url?: string | null;

  is_active: boolean;
  created_at: string;
};

type WorkshopPurchase = { product_id: string };

type UserProfile = {
  id: string;
  tier: UserTier;
};

/* --------------------------- shimmer component -------------------------- */
const ShimmerThumb: React.FC<{ size: number }> = ({ size }) => {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  const opacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0.9],
  });

  const translateX = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [-size * 0.3, size * 0.3],
  });

  return (
    <View style={[styles.thumbPlaceholder, { height: size, borderRadius: 12 }]}>
      <Ionicons name="film-outline" size={22} color={GOLD} />
      <Text style={styles.thumbPlaceholderText}>Preview</Text>

      {/* subtle sweep highlight */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.shimmerSweep,
          {
            height: size + 18,
            opacity,
            transform: [{ translateX }, { rotate: '12deg' }],
          },
        ]}
      />
    </View>
  );
};

/* ------------------------------- screen -------------------------------- */
const WorkshopScreen: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [products, setProducts] = useState<WorkshopProduct[]>([]);
  const [purchases, setPurchases] = useState<WorkshopPurchase[]>([]); // kept to avoid refactor risk
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  // Upgrade modal state
  const [upgradeVisible, setUpgradeVisible] = useState(false);

  // Preview modal state
  const [previewVisible, setPreviewVisible] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<WorkshopProduct | null>(null);

  // Inline video controls
  const videoRef = useRef<Video | null>(null);
  const webVideoRef = useRef<HTMLVideoElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);

  // ✅ IMPORTANT: dynamic aspect ratio so previews never crop
  const [previewAspect, setPreviewAspect] = useState(16 / 9);

  const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

  const columns = useMemo(() => {
    // 2-column grid on desktop web
    if (IS_WEB && SCREEN_W >= 900) return 2;
    return 1;
  }, [SCREEN_W]);

  // ✅ subtle hover/press zoom per-card (web hover + mobile press feedback)
  const cardScalesRef = useRef<Record<string, Animated.Value>>({});
  const getCardScale = (id: string) => {
    if (!cardScalesRef.current[id]) cardScalesRef.current[id] = new Animated.Value(1);
    return cardScalesRef.current[id];
  };

  const animateCardScale = (id: string, toValue: number) => {
    Animated.timing(getCardScale(id), {
      toValue,
      duration: 170,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  // ✅ animate TouchableOpacity for scale transform
  const AnimatedTouchableOpacity = useMemo(
    () => Animated.createAnimatedComponent(TouchableOpacity),
    []
  );

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
          setUserProfile({
            id: profileData.id,
            tier: profileData.tier as UserTier,
          });
        }

        // Purchases no longer used for access (Pro-only), but keep fetch so nothing breaks.
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
  // Products are ONLY available with Pro subscription.
  const hasAccess = (_product: WorkshopProduct): boolean => {
    return userProfile?.tier === 'pro';
  };

  const openProductContent = (product: WorkshopProduct) => {
    if (!hasAccess(product)) {
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

    if (access) {
      return (
        <TouchableOpacity
          style={[styles.ctaButton, styles.ctaButtonOutline]}
          onPress={() => openProductContent(product)}
          activeOpacity={0.9}
        >
          <Text style={[styles.ctaText, styles.ctaTextOutline]} numberOfLines={1}>
            Download / Access
          </Text>
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity
        style={styles.ctaButton}
        onPress={() => setUpgradeVisible(true)}
        activeOpacity={0.9}
      >
        <Text style={styles.ctaText} numberOfLines={1}>
          Unlock with Pro
        </Text>
      </TouchableOpacity>
    );
  };

  /* -------------------------- preview modal ---------------------------- */
  const openPreview = async (product: WorkshopProduct) => {
    setSelectedProduct(product);
    setPreviewVisible(true);
    setIsPlaying(false);
    setIsMuted(true);
    setPreviewAspect(16 / 9); // reset each open (then we detect actual)
  };

  const closePreview = async () => {
    try {
      if (IS_WEB && webVideoRef.current) {
        webVideoRef.current.pause();
        webVideoRef.current.currentTime = 0;
      } else if (videoRef.current) {
        await videoRef.current.stopAsync();
      }
    } catch {}
    setIsPlaying(false);
    setIsMuted(true);
    setPreviewVisible(false);
    setSelectedProduct(null);
  };

  const getPreviewAsset = (product: WorkshopProduct) => {
    const asset = product.preview_url || product.image_url;
    return asset || null;
  };

  const previewIsLikelyVideo = (url: string) => {
    const lower = url.toLowerCase();
    return lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.includes('video');
  };

  const MODAL_MAX_W = Math.min(520, SCREEN_W - 24);

  const togglePlay = async () => {
    try {
      if (IS_WEB) {
        const el = webVideoRef.current;
        if (!el) return;
        if (!el.paused) {
          el.pause();
          setIsPlaying(false);
        } else {
          await el.play().catch(() => {});
          setIsPlaying(!el.paused);
        }
        return;
      }

      if (!videoRef.current) return;
      if (isPlaying) {
        await videoRef.current.pauseAsync();
        setIsPlaying(false);
      } else {
        await videoRef.current.playAsync();
        setIsPlaying(true);
      }
    } catch {}
  };

  const toggleMute = async () => {
    try {
      if (IS_WEB) {
        const el = webVideoRef.current;
        if (!el) return;
        const next = !isMuted;
        el.muted = next;
        setIsMuted(next);
        return;
      }

      if (!videoRef.current) return;
      const next = !isMuted;
      await videoRef.current.setIsMutedAsync(next);
      setIsMuted(next);
    } catch {}
  };

  /* ------------------------------ render ------------------------------- */
  return (
    <View style={styles.container}>
      {/* Centered header */}
      <View style={styles.header}>
        <Ionicons name="cube-outline" size={20} color={GOLD} />
        <Text style={styles.headerTitle}>Workshop</Text>
      </View>

      {/* Hero intro (adds Friday note) */}
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Tools for stronger work.</Text>
        <Text style={styles.heroSubtitle}>
          Hand-crafted packs designed to help creators polish, experiment, and level up.
          {'\n'}
          <Text style={styles.heroFriday}>New tools coming every Friday.</Text>
        </Text>
      </View>

      {loading && !refreshing ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={GOLD} />
          <Text style={styles.loadingText}>Loading Workshop...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, columns === 2 ? styles.gridContent : null]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GOLD} />
          }
        >
          {products.length === 0 && (
            <View style={styles.emptyState}>
              <Ionicons name="cube-outline" size={30} color={TEXT_MUTED} />
              <Text style={styles.emptyTitle}>Nothing in the crate yet</Text>
              <Text style={styles.emptyText}>Your first Workshop pack will drop here soon.</Text>
            </View>
          )}

          {products.map((product) => {
            // Keep your mapping behavior (+ preserve preview_url explicitly)
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
                  file_url:
                    'https://sdatmuzzsebvckfmnqsv.supabase.co/storage/v1/object/public/avatars/STARTER.zip',
                  preview_url: product.preview_url,

                  // ✅ this is the change you asked for:
                  // show your Supabase image in the preview slot (thumbnail area) on the main list card
                  image_url: STARTER_LUT_PACK_PREVIEW_IMAGE,
                }
              : product;

            const access = hasAccess(mappedProduct);
            const scale = getCardScale(mappedProduct.id);

            return (
              <View
                key={mappedProduct.id}
                style={[
                  styles.gridItem,
                  columns === 2 ? styles.gridItemTwoCol : styles.gridItemOneCol,
                ]}
              >
                <AnimatedTouchableOpacity
                  style={[styles.card, { transform: [{ scale }] }]}
                  activeOpacity={0.92}
                  onPress={() => openPreview(mappedProduct)}
                  onPressIn={() => animateCardScale(mappedProduct.id, 0.985)}
                  onPressOut={() => animateCardScale(mappedProduct.id, 1)}
                  // ✅ subtle hover zoom on web
                  {...(IS_WEB
                    ? ({
                        onMouseEnter: () => animateCardScale(mappedProduct.id, 1.015),
                        onMouseLeave: () => animateCardScale(mappedProduct.id, 1),
                      } as any)
                    : null)}
                >
                  <View style={styles.thumbWrap}>
                    {mappedProduct.image_url ? (
                      <Image source={{ uri: mappedProduct.image_url }} style={styles.thumb} />
                    ) : (
                      <ShimmerThumb size={76} />
                    )}
                  </View>

                  <View style={styles.cardBody}>
                    <View style={styles.cardTitleRow}>
                      <Text style={styles.cardTitle} numberOfLines={1}>
                        {mappedProduct.name}
                      </Text>

                      <View style={styles.badgeProOnly}>
                        <Ionicons name="sparkles-outline" size={12} color={GOLD} />
                        <Text style={styles.badgeProOnlyText}>Pro only</Text>
                      </View>
                    </View>

                    {mappedProduct.description ? (
                      <Text style={styles.cardDescription} numberOfLines={3}>
                        {mappedProduct.description}
                      </Text>
                    ) : null}

                    <View style={styles.metaRow}>
                      <Text style={styles.metaHint}>
                        {access ? 'Tap to preview' : 'Preview available • unlock with Pro'}
                      </Text>
                    </View>

                    <View style={styles.cardBottomRow}>
                      {renderCTA(mappedProduct)}
                      <View style={styles.previewChip}>
                        <Ionicons name="play-circle-outline" size={14} color={TEXT_IVORY} />
                        <Text style={styles.previewChipText}>Preview</Text>
                      </View>
                    </View>
                  </View>
                </AnimatedTouchableOpacity>
              </View>
            );
          })}

          {products.length > 0 && (
            <Text style={styles.comingSoonBig}>NEW TOOLS COMING EVERY FRIDAY.</Text>
          )}
        </ScrollView>
      )}

      {/* Preview Modal */}
      <Modal visible={previewVisible} transparent animationType="fade" onRequestClose={closePreview}>
        <Pressable style={styles.modalBackdrop} onPress={closePreview} />

        <View style={styles.modalCardWrap}>
          <View
            style={[
              styles.modalCard,
              { width: MODAL_MAX_W, maxHeight: Math.min(680, SCREEN_H - 90) },
            ]}
          >
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderLeft}>
                <Ionicons name="cube-outline" size={18} color={GOLD} />
                <Text style={styles.modalTitle} numberOfLines={1}>
                  {selectedProduct?.name || 'Preview'}
                </Text>
              </View>

              <TouchableOpacity onPress={closePreview} activeOpacity={0.8} style={styles.modalClose}>
                <Ionicons name="close" size={18} color={TEXT_IVORY} />
              </TouchableOpacity>
            </View>

            {/* Preview area (INLINE VIDEO or IMAGE) */}
            <View style={[styles.previewArea, { aspectRatio: previewAspect }]}>
              {selectedProduct ? (
                (() => {
                  const asset = getPreviewAsset(selectedProduct);

                  if (!asset) {
                    return (
                      <View style={styles.previewPlaceholder}>
                        <Ionicons name="image-outline" size={24} color={GOLD} />
                        <Text style={styles.previewPlaceholderTitle}>Preview coming soon</Text>
                        <Text style={styles.previewPlaceholderText}>
                          Upload a preview video to Supabase and set preview_url on the product.
                        </Text>
                      </View>
                    );
                  }

                  if (previewIsLikelyVideo(asset)) {
                    return (
                      <View style={styles.videoWrap}>
                        {IS_WEB ? (
                          // ✅ Web: use native <video> to guarantee objectFit: contain and avoid expo-av cropping quirks
                          <video
                            ref={(el) => (webVideoRef.current = el)}
                            src={asset}
                            style={
                              {
                                width: '100%',
                                height: '100%',
                                objectFit: 'contain',
                                objectPosition: 'center center',
                                background: '#000',
                                display: 'block',
                              } as any
                            }
                            muted={isMuted}
                            playsInline
                            preload="metadata"
                            controls={false}
                            onLoadedMetadata={(e: any) => {
                              const el = e?.currentTarget as HTMLVideoElement | null;
                              if (!el) return;
                              const w = el.videoWidth || 0;
                              const h = el.videoHeight || 0;
                              if (w > 0 && h > 0) {
                                const next = w / h;
                                if (Number.isFinite(next)) setPreviewAspect(next);
                              }
                            }}
                            onPlay={() => setIsPlaying(true)}
                            onPause={() => setIsPlaying(false)}
                          />
                        ) : (
                          <Video
                            ref={(r) => (videoRef.current = r)}
                            source={{ uri: asset }}
                            // ✅ No cropping: contain everywhere
                            style={[styles.video, WEB_VIDEO_FIT]}
                            resizeMode={ResizeMode.CONTAIN}
                            isLooping
                            shouldPlay={false}
                            isMuted={true}
                            useNativeControls={false}
                            onPlaybackStatusUpdate={(status: any) => {
                              if (!status?.isLoaded) return;

                              setIsPlaying(!!status.isPlaying);

                              const ns = status?.naturalSize;
                              const w = ns?.width || 0;
                              const h = ns?.height || 0;
                              if (w > 0 && h > 0) {
                                const next = w / h;
                                if (Number.isFinite(next)) setPreviewAspect(next);
                              }
                            }}
                          />
                        )}

                        {/* overlay controls */}
                        <View style={styles.videoControls}>
                          <TouchableOpacity
                            onPress={togglePlay}
                            activeOpacity={0.85}
                            style={styles.videoControlButton}
                          >
                            <Ionicons
                              name={isPlaying ? 'pause' : 'play'}
                              size={18}
                              color={TEXT_IVORY}
                            />
                            <Text style={styles.videoControlText}>
                              {isPlaying ? 'Pause' : 'Play'}
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            onPress={toggleMute}
                            activeOpacity={0.85}
                            style={styles.videoControlButton}
                          >
                            <Ionicons
                              name={isMuted ? 'volume-mute' : 'volume-high'}
                              size={18}
                              color={TEXT_IVORY}
                            />
                            <Text style={styles.videoControlText}>
                              {isMuted ? 'Muted' : 'Sound'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  }

                  // Image preview
                  return <Image source={{ uri: asset }} style={styles.previewImage} />;
                })()
              ) : null}
            </View>

            {/* Description */}
            {!!selectedProduct?.description && (
              <Text style={styles.modalDescription}>{selectedProduct.description}</Text>
            )}

            {/* Access pills only */}
            {selectedProduct && (
              <View style={styles.modalMetaRow}>
                <View style={styles.modalMetaPill}>
                  <Ionicons name="sparkles-outline" size={14} color={GOLD} />
                  <Text style={styles.modalMetaText}>Pro only</Text>
                </View>

                <View style={styles.modalMetaPill}>
                  <Ionicons
                    name={hasAccess(selectedProduct) ? 'lock-open-outline' : 'lock-closed-outline'}
                    size={14}
                    color={GOLD}
                  />
                  <Text style={styles.modalMetaText}>
                    {hasAccess(selectedProduct) ? 'Unlocked' : 'Locked'}
                  </Text>
                </View>
              </View>
            )}

            {/* Modal CTA */}
            {selectedProduct && (
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonGhost]}
                  onPress={closePreview}
                  activeOpacity={0.9}
                >
                  <Text style={styles.modalButtonGhostText}>Close</Text>
                </TouchableOpacity>

                {hasAccess(selectedProduct) ? (
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonGold]}
                    onPress={() => {
                      closePreview();
                      openProductContent(selectedProduct);
                    }}
                    activeOpacity={0.9}
                  >
                    <Ionicons name="download-outline" size={16} color="#050505" />
                    <Text style={styles.modalButtonGoldText}>Download / Access</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonGold]}
                    onPress={() => {
                      closePreview();
                      setUpgradeVisible(true);
                    }}
                    activeOpacity={0.9}
                  >
                    <Ionicons name="sparkles-outline" size={16} color="#050505" />
                    <Text style={styles.modalButtonGoldText}>Unlock with Pro</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Upgrade modal for Workshop context */}
      <UpgradeModal
        visible={upgradeVisible}
        onClose={() => setUpgradeVisible(false)}
        context="workshop"
        onSelectPro={() => {
          setUpgradeVisible(false);
          Alert.alert(
            'Upgrade to Pro',
            'The Pro upgrade flow is not wired up yet. Once it is, you’ll unlock all Workshop products automatically.'
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

  hero: {
    marginTop: 10,
    marginHorizontal: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: DARK_ELEVATED_2,
    borderWidth: 1,
    borderColor: '#242424',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 14,
    elevation: 7,
  },
  heroTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: TEXT_IVORY,
    letterSpacing: 0.2,
    fontFamily: SYSTEM_SANS,
  },
  heroSubtitle: {
    marginTop: 4,
    fontSize: 10.5,
    lineHeight: 15,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },
  heroFriday: {
    color: TEXT_IVORY,
    fontWeight: '900',
    letterSpacing: 0.2,
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

  // web/desktop grid
  gridContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  gridItem: {
    marginBottom: 12,
  },
  gridItemOneCol: {
    width: '100%',
  },
  gridItemTwoCol: {
    width: '49%',
  },

  emptyState: {
    alignItems: 'center',
    marginTop: 48,
    paddingHorizontal: 24,
    width: '100%',
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
    borderRadius: 18,
    backgroundColor: DARK_ELEVATED,
    borderWidth: 1,
    borderColor: '#262626',
    shadowColor: '#000',
    shadowOpacity: 0.42,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 7,
    width: '100%',
  },

  thumbWrap: {
    width: 76,
    marginRight: 10,
  },
  thumb: {
    width: '100%',
    height: 76,
    borderRadius: 12,
  },
  thumbPlaceholder: {
    width: '100%',
    height: 76,
    borderRadius: 12,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    gap: 4,
    overflow: 'hidden',
  },
  thumbPlaceholderText: {
    fontSize: 8,
    color: TEXT_MUTED,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    fontFamily: SYSTEM_SANS,
  },

  shimmerSweep: {
    position: 'absolute',
    width: '45%',
    backgroundColor: 'rgba(255,255,255,0.08)',
    top: -12,
    left: '30%',
    borderRadius: 18,
  },

  cardBody: { flex: 1 },

  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '900',
    color: TEXT_IVORY,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontFamily: SYSTEM_SANS,
  },

  badgeProOnly: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#101010',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  badgeProOnlyText: {
    fontSize: 8.5,
    fontWeight: '900',
    color: TEXT_IVORY,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontFamily: SYSTEM_SANS,
  },

  cardDescription: {
    marginTop: 3,
    fontSize: 9.5,
    color: TEXT_MUTED,
    lineHeight: 13,
    fontFamily: SYSTEM_SANS,
  },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  metaHint: {
    fontSize: 8.5,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },

  cardBottomRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },

  previewChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#101010',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  previewChipText: {
    fontSize: 9,
    color: TEXT_IVORY,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontFamily: SYSTEM_SANS,
  },

  ctaButton: {
    paddingHorizontal: 10,
    paddingVertical: 7,
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
    fontWeight: '900',
    color: '#050505',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },
  ctaTextOutline: { color: GOLD },

  comingSoonBig: {
    marginTop: 28,
    marginBottom: 6,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
    color: TEXT_MUTED,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontSize: Platform.select({ ios: 18, android: 18, web: 24 }),
    opacity: 0.95,
    width: '100%',
  },

  /* ------------------------------ modal ------------------------------ */
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  modalCardWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  modalCard: {
    borderRadius: 20,
    backgroundColor: DARK_ELEVATED,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 16,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  modalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  modalTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: '900',
    color: TEXT_IVORY,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },
  modalClose: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#101010',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },

  // ✅ changed: no fixed height; uses aspectRatio so videos don’t crop
  previewArea: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  previewImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },

  videoWrap: {
    flex: 1,
    backgroundColor: '#000',
  },
  video: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },

  videoControls: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  videoControlButton: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  videoControlText: {
    color: TEXT_IVORY,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontFamily: SYSTEM_SANS,
  },

  previewPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    gap: 6,
  },
  previewPlaceholderTitle: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '900',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },
  previewPlaceholderText: {
    fontSize: 9.5,
    color: TEXT_MUTED,
    textAlign: 'center',
    lineHeight: 13,
    fontFamily: SYSTEM_SANS,
  },

  modalDescription: {
    marginTop: 10,
    fontSize: 10,
    color: TEXT_MUTED,
    lineHeight: 14,
    fontFamily: SYSTEM_SANS,
  },

  modalMetaRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  modalMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#101010',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  modalMetaText: {
    fontSize: 9,
    fontWeight: '900',
    color: TEXT_IVORY,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontFamily: SYSTEM_SANS,
  },

  modalActions: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  modalButton: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  modalButtonGhost: {
    backgroundColor: '#101010',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  modalButtonGhostText: {
    color: TEXT_IVORY,
    fontWeight: '900',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    fontFamily: SYSTEM_SANS,
  },
  modalButtonGold: {
    backgroundColor: GOLD,
  },
  modalButtonGoldText: {
    color: '#050505',
    fontWeight: '900',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    fontFamily: SYSTEM_SANS,
  },
});
