// components/AvatarCropper.tsx

import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  Image,
  Dimensions,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import {
  PanGestureHandler,
  PinchGestureHandler,
} from 'react-native-gesture-handler';
import * as ImageManipulator from 'expo-image-manipulator';
import Slider from '@react-native-community/slider';

type Props = {
  visible: boolean;

  imageUri?: string;
  onCropped?: (croppedUri: string) => void;

  sourceUri?: string;
  onDone?: (croppedUri: string) => void;

  onCancel: () => void;

  fullName?: string | null;
  mainRoleName?: string | null;
  cityName?: string | null;
  level?: number | null;
};

const WINDOW = Dimensions.get('window');
const GOLD = '#C6A664';
const IVORY = '#F5F2EA';
const MUTED = '#C8C1B2';
const SOFT = '#A7A6A2';

const COLORS = {
  background: 'rgba(0,0,0,0.94)',
  card: '#050505',
  border: 'rgba(255,255,255,0.10)',
  textPrimary: IVORY,
  textSecondary: MUTED,
  hint: SOFT,
};

const FONT_PRIMARY =
  Platform.select({
    ios: 'Avenir Next',
    android: 'sans-serif',
    default: 'Avenir Next',
  }) || 'Avenir Next';

const FONT_LIGHT =
  Platform.select({
    ios: 'Avenir Next',
    android: 'sans-serif-light',
    default: 'Avenir Next',
  }) || 'Avenir Next';

const PREVIEW_MAX_W = 1040;
const H_PADDING = 22;

const PREVIEW_W = Math.min(WINDOW.width - H_PADDING * 2, PREVIEW_MAX_W);
const BANNER_H = PREVIEW_W * 0.50;

const AVATAR_DIAMETER = BANNER_H * 0.25;
const AVATAR_RADIUS = AVATAR_DIAMETER / 2;

const AVATAR_LEFT = 24;
const AVATAR_BOTTOM = 34;

function isEndState(state: any) {
  return state === 'END' || state === 5 || state === 'CANCELLED' || state === 3;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const LEVEL_RING_STEPS = [
  { max: 24, color: '#E0E0EA' },
  { max: 49, color: '#C0C0C8' },
  { max: 9999, color: '#C6A664' },
];

const getRingColorForLevel = (level?: number | null) => {
  const lv = typeof level === 'number' && level > 0 ? level : 1;
  const step =
    LEVEL_RING_STEPS.find((s) => lv <= s.max) ||
    LEVEL_RING_STEPS[LEVEL_RING_STEPS.length - 1];
  return step.color;
};

export default function AvatarCropper({
  visible,
  imageUri,
  sourceUri,
  onCancel,
  onCropped,
  onDone,
  fullName,
  mainRoleName,
  cityName,
  level,
}: Props) {
  const effectiveUri = imageUri || sourceUri || undefined;

  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);

  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });

  const [loadingMeta, setLoadingMeta] = useState(false);
  const [saving, setSaving] = useState(false);

  const [baseScale, setBaseScale] = useState(1);
  const [lastOffset, setLastOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!effectiveUri || !visible) {
      setImgSize(null);
      return;
    }

    setLoadingMeta(true);

    Image.getSize(
      effectiveUri,
      (w, h) => {
        setImgSize({ w, h });
        setLoadingMeta(false);
      },
      () => {
        setImgSize({ w: 1000, h: 1000 });
        setLoadingMeta(false);
      }
    );
  }, [effectiveUri, visible]);

  useEffect(() => {
    if (!visible) return;
    setBaseScale(1);
    setLastOffset({ x: 0, y: 0 });
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    setSaving(false);
  }, [visible, effectiveUri]);

  const baseFitScale = imgSize
    ? Math.max(AVATAR_DIAMETER / imgSize.w, AVATAR_DIAMETER / imgSize.h)
    : 1;

  const totalScale = baseFitScale * scale;

  const onPanEvent = (e: any) => {
    const { translationX, translationY } = e.nativeEvent;

    setTranslate({
      x: lastOffset.x + translationX,
      y: lastOffset.y + translationY,
    });
  };

  const onPanStateChange = (e: any) => {
    if (isEndState(e.nativeEvent.state)) {
      const { translationX, translationY } = e.nativeEvent;

      const next = {
        x: lastOffset.x + translationX,
        y: lastOffset.y + translationY,
      };

      setLastOffset(next);
      setTranslate(next);
    }
  };

  const onPinchEvent = (e: any) => {
    const s = baseScale * e.nativeEvent.scale;
    setScale(clamp(s, 1, 4));
  };

  const onPinchStateChange = (e: any) => {
    if (isEndState(e.nativeEvent.state)) {
      const next = clamp(baseScale * e.nativeEvent.scale, 1, 4);
      setBaseScale(next);
      setScale(next);
    }
  };

  const onSliderChange = (val: number) => {
    const s = clamp(val, 1, 4);
    setBaseScale(s);
    setScale(s);
  };

  const emitDone = (uri: string) => {
    onCropped?.(uri);
    onDone?.(uri);
  };

  const doCrop = async () => {
    if (!effectiveUri || !imgSize || saving) return;

    try {
      setSaving(true);

      const { w: imgW, h: imgH } = imgSize;

      const cxView = AVATAR_RADIUS;
      const cyView = AVATAR_RADIUS;
      const imgCxView = AVATAR_RADIUS + translate.x;
      const imgCyView = AVATAR_RADIUS + translate.y;

      const ixCenter = (cxView - imgCxView) / totalScale + imgW / 2;
      const iyCenter = (cyView - imgCyView) / totalScale + imgH / 2;

      const rImg = AVATAR_RADIUS / totalScale;

      let originX = ixCenter - rImg;
      let originY = iyCenter - rImg;
      let size = rImg * 2;

      if (size > imgW || size > imgH) {
        size = Math.min(imgW, imgH);
        originX = (imgW - size) / 2;
        originY = (imgH - size) / 2;
      } else {
        originX = clamp(originX, 0, imgW - size);
        originY = clamp(originY, 0, imgH - size);
      }

      const result = await ImageManipulator.manipulateAsync(
        effectiveUri,
        [
          {
            crop: {
              originX,
              originY,
              width: size,
              height: size,
            } as any,
          },
          {
            resize: {
              width: 512,
              height: 512,
            },
          },
        ],
        {
          compress: 0.92,
          format: ImageManipulator.SaveFormat.JPEG,
        }
      );

      emitDone(result.uri);
    } catch (err) {
      emitDone(effectiveUri);
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  const displayRole = (mainRoleName || '').toString().trim().toUpperCase() || 'DIRECTOR';
  const displayName = (fullName || '').toString().trim() || 'Your Name';
  const displayCity = (cityName || '').toString().trim().toUpperCase() || 'YOUR CITY';
  const displayLevel = typeof level === 'number' && level > 0 ? level : 8;
  const ringColor = getRingColorForLevel(level);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Adjust profile picture</Text>

          <View style={[styles.previewWrap, { width: PREVIEW_W, height: BANNER_H }]}>
            {effectiveUri ? (
              <Image source={{ uri: effectiveUri }} style={styles.bannerImage} resizeMode="cover" />
            ) : (
              <View style={[styles.bannerImage, { backgroundColor: '#141414' }]} />
            )}

            <View style={styles.bannerDarken} />
            <View style={styles.bannerVignetteTop} />
            <View style={styles.bannerVignetteBottom} />

            <View style={styles.topBrandRow}>
              <Text style={styles.brandText}>OVERLOOKED</Text>
            </View>

            <View style={styles.centerTextWrap}>
              <Text style={styles.roleText} numberOfLines={1} adjustsFontSizeToFit>
                {displayRole}
              </Text>
              <Text style={styles.metaText} numberOfLines={1} adjustsFontSizeToFit>
                {displayName.toUpperCase()} {' • '} {displayCity}
              </Text>
            </View>

            <View style={styles.bottomInfoStrip}>
              <Text style={styles.bottomInfoLabel}>Filmmaking streak</Text>
              <Text style={styles.bottomInfoValue}>Year 1</Text>
            </View>

            <View
              style={[
                styles.avatarOuterGlow,
                {
                  width: AVATAR_DIAMETER + 14,
                  height: AVATAR_DIAMETER + 14,
                  left: AVATAR_LEFT - 7,
                  top: BANNER_H - AVATAR_BOTTOM - AVATAR_DIAMETER - 7,
                },
              ]}
            />

            <View
              style={[
                styles.avatarRingWrapper,
                {
                  width: AVATAR_DIAMETER + 10,
                  height: AVATAR_DIAMETER + 10,
                  left: AVATAR_LEFT - 5,
                  top: BANNER_H - AVATAR_BOTTOM - AVATAR_DIAMETER - 5,
                  borderColor: ringColor,
                },
              ]}
            >
              <View style={[styles.avatarRing, { borderColor: ringColor }]} />

              <PinchGestureHandler
                onGestureEvent={onPinchEvent}
                onHandlerStateChange={onPinchStateChange}
              >
                <View style={styles.gestureFill}>
                  <PanGestureHandler
                    onGestureEvent={onPanEvent}
                    onHandlerStateChange={onPanStateChange}
                  >
                    <View
                      style={[
                        styles.avatarCircle,
                        {
                          width: AVATAR_DIAMETER,
                          height: AVATAR_DIAMETER,
                          borderRadius: AVATAR_RADIUS,
                        },
                      ]}
                    >
                      {loadingMeta || !imgSize || !effectiveUri ? (
                        <View style={styles.avatarLoading}>
                          <ActivityIndicator color={GOLD} />
                        </View>
                      ) : (
                        <Image
                          source={{ uri: effectiveUri }}
                          style={{
                            position: 'absolute',
                            width: imgSize.w * totalScale,
                            height: imgSize.h * totalScale,
                            left: AVATAR_RADIUS - (imgSize.w * totalScale) / 2 + translate.x,
                            top: AVATAR_RADIUS - (imgSize.h * totalScale) / 2 + translate.y,
                          }}
                          resizeMode="cover"
                        />
                      )}
                    </View>
                  </PanGestureHandler>
                </View>
              </PinchGestureHandler>
            </View>

            <View
              style={[
                styles.levelPill,
                {
                  left: AVATAR_LEFT + 8,
                  top: BANNER_H - AVATAR_BOTTOM + 10,
                  backgroundColor: ringColor,
                },
              ]}
            >
              <Text style={styles.levelPillText}>LV {displayLevel}</Text>
            </View>
          </View>

          <View style={styles.zoomRow}>
            <Text style={styles.zoomLabel}>Zoom</Text>
            <Slider
              style={styles.slider}
              minimumValue={1}
              maximumValue={4}
              value={scale}
              onValueChange={onSliderChange}
              minimumTrackTintColor={GOLD}
              maximumTrackTintColor="#3F3F3F"
              thumbTintColor={GOLD}
            />
          </View>

          <Text style={styles.hint}>
            Drag inside the circle to position your avatar · Pinch to zoom · Or use the slider
          </Text>

          <View style={styles.actions}>
            <TouchableOpacity onPress={onCancel} disabled={saving} style={[styles.btn, styles.btnGhost]}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={doCrop}
              disabled={saving || loadingMeta || !effectiveUri}
              style={[
                styles.btn,
                styles.btnPrimary,
                (saving || loadingMeta || !effectiveUri) && { opacity: 0.6 },
              ]}
            >
              {saving ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={styles.btnPrimaryText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: H_PADDING,
  },

  card: {
    width: '100%',
    maxWidth: PREVIEW_MAX_W,
    backgroundColor: COLORS.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 18,
    paddingHorizontal: 18,
    alignItems: 'center',
  },

  title: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 14,
    fontFamily: FONT_PRIMARY,
    letterSpacing: 0.3,
  },

  previewWrap: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
    backgroundColor: '#000',
    position: 'relative',
  },

  bannerImage: {
    ...StyleSheet.absoluteFillObject,
  },

  bannerDarken: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.38)',
  },

  bannerVignetteTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '28%',
    backgroundColor: 'rgba(0,0,0,0.42)',
  },

  bannerVignetteBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '38%',
    backgroundColor: 'rgba(0,0,0,0.48)',
  },

  topBrandRow: {
    position: 'absolute',
    top: 18,
    left: 18,
    right: 18,
    alignItems: 'flex-start',
  },

  brandText: {
    color: IVORY,
    fontSize: 16,
    letterSpacing: 2.6,
    fontWeight: '900',
    fontFamily: FONT_PRIMARY,
  },

  centerTextWrap: {
    position: 'absolute',
    top: '23%',
    left: 22,
    right: 22,
    alignItems: 'center',
  },

  roleText: {
    color: COLORS.textPrimary,
    fontSize: 30,
    letterSpacing: 4,
    fontWeight: '700',
    textTransform: 'uppercase',
    fontFamily: FONT_LIGHT,
  },

  metaText: {
    marginTop: 8,
    color: GOLD,
    fontSize: 12,
    letterSpacing: 1.7,
    fontFamily: FONT_PRIMARY,
    fontWeight: '700',
  },

  bottomInfoStrip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingBottom: 14,
    paddingTop: 26,
    alignItems: 'center',
  },

  bottomInfoLabel: {
    color: MUTED,
    fontSize: 11,
    fontFamily: FONT_PRIMARY,
    fontWeight: '600',
    marginBottom: 4,
  },

  bottomInfoValue: {
    color: IVORY,
    fontSize: 12,
    letterSpacing: 1,
    fontFamily: FONT_PRIMARY,
    fontWeight: '700',
  },

  avatarOuterGlow: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.34)',
  },

  avatarRingWrapper: {
    position: 'absolute',
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderWidth: 1,
  },

  avatarRing: {
    position: 'absolute',
    top: 5,
    left: 5,
    right: 5,
    bottom: 5,
    borderRadius: 999,
    borderWidth: 2,
  },

  gestureFill: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },

  avatarCircle: {
    overflow: 'hidden',
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },

  avatarLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  levelPill: {
    position: 'absolute',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },

  levelPillText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 1,
    fontFamily: FONT_PRIMARY,
  },

  zoomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginTop: 16,
  },

  zoomLabel: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    marginRight: 10,
    fontFamily: FONT_PRIMARY,
  },

  slider: {
    flex: 1,
    height: 32,
  },

  hint: {
    marginTop: 4,
    color: COLORS.hint,
    fontSize: 11,
    textAlign: 'center',
    fontFamily: FONT_PRIMARY,
    lineHeight: 16,
  },

  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },

  btn: {
    paddingVertical: 10,
    paddingHorizontal: 26,
    borderRadius: 999,
    borderWidth: 1,
  },

  btnGhost: {
    borderColor: 'rgba(255,255,255,0.24)',
    backgroundColor: 'transparent',
  },

  btnGhostText: {
    color: COLORS.textPrimary,
    fontWeight: '800',
    fontFamily: FONT_PRIMARY,
  },

  btnPrimary: {
    borderColor: GOLD,
    backgroundColor: GOLD,
  },

  btnPrimaryText: {
    color: '#000',
    fontWeight: '900',
    fontFamily: FONT_PRIMARY,
  },
});