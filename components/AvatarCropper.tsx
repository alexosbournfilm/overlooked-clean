// components/AvatarCropper.tsx

import React, {
  useMemo,
  useRef,
  useState,
  useEffect,
} from 'react';
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

  // Canonical
  imageUri?: string;
  onCropped?: (croppedUri: string) => void;

  // Legacy aliases
  sourceUri?: string;
  onDone?: (croppedUri: string) => void;

  onCancel: () => void;

  // Optional extras for live hero preview (all optional / safe defaults)
  fullName?: string | null;
  mainRoleName?: string | null;
  cityName?: string | null;
  level?: number | null;
};

const WINDOW = Dimensions.get('window');
const GOLD = '#C6A664';

const COLORS = {
  background: '#000000EE',
  card: '#050505',
  border: '#FFFFFF22',
  textPrimary: '#FFFFFF',
  textSecondary: '#D0D0D0',
  hint: '#AAAAAA',
};

const FONT_OBLIVION =
  Platform.select({
    ios: 'Avenir Next',
    android: 'sans-serif-light',
    default: 'Avenir Next',
  }) || 'Avenir Next';

/** Avatar + banner layout (desktop-style preview) */
const PREVIEW_MAX_W = 1040;
const H_PADDING = 22;

const PREVIEW_W = Math.min(
  WINDOW.width - H_PADDING * 2,
  PREVIEW_MAX_W,
);
const BANNER_H = PREVIEW_W * 0.38; // wide, cinematic
const AVATAR_DIAMETER = BANNER_H * 0.26;
const AVATAR_RADIUS = AVATAR_DIAMETER / 2;
const AVATAR_LEFT = 32; // from left of banner
const AVATAR_BOTTOM = 26; // from bottom of banner

/** Where the avatar circle center lives in banner coords */
const AVATAR_CENTER_X = AVATAR_LEFT + AVATAR_RADIUS;
const AVATAR_CENTER_Y = BANNER_H - AVATAR_BOTTOM - AVATAR_RADIUS;

/** Cross-platform RNGH end-state helper */
function isEndState(state: any) {
  return (
    state === 'END' ||
    state === 5 ||
    state === 'CANCELLED' ||
    state === 3
  );
}

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

/* Simple level → ring color mapping (kept local) */
const LEVEL_RING_STEPS = [
  { max: 24, color: '#E0E0EA' },
  { max: 49, color: '#C0C0C8' },
  { max: 9999, color: '#C6A664' },
];
const getRingColorForLevel = (level?: number | null) => {
  const lv =
    typeof level === 'number' && level > 0 ? level : 1;
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
  const effectiveUri =
    imageUri || sourceUri || undefined;

  // Real image size (px)
  const [imgSize, setImgSize] = useState<{
    w: number;
    h: number;
  } | null>(null);

  // Zoom (1–4)
  const [scale, setScale] = useState(1);
  const baseScale = useRef(1);

  // Pan (offset of image center relative to circle center, in px)
  const [translate, setTranslate] = useState({
    x: 0,
    y: 0,
  });
  const lastOffset = useRef({ x: 0, y: 0 });

  const [loadingMeta, setLoadingMeta] =
    useState(false);
  const [saving, setSaving] = useState(false);

  // Load intrinsic size once per image
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
        // Fallback
        setImgSize({ w: 1000, h: 1000 });
        setLoadingMeta(false);
      },
    );
  }, [effectiveUri, visible]);

  // Reset when opened / source changes
  useEffect(() => {
    if (!visible) return;
    baseScale.current = 1;
    lastOffset.current = { x: 0, y: 0 };
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    setSaving(false);
  }, [visible, effectiveUri]);

  // Fit: ensure the *avatar circle* is fully covered at min zoom
  const baseFitScale = useMemo(() => {
    if (!imgSize) return 1;
    return Math.max(
      AVATAR_DIAMETER / imgSize.w,
      AVATAR_DIAMETER / imgSize.h,
    ); // cover circle
  }, [imgSize]);

  // Total scale from image px -> avatar view px
  const totalScale = baseFitScale * scale;

  // --- Gestures for avatar image inside circle ---

  const onPanEvent = (e: any) => {
    const { translationX, translationY } =
      e.nativeEvent;
    setTranslate({
      x:
        lastOffset.current.x +
        translationX,
      y:
        lastOffset.current.y +
        translationY,
    });
  };

  const onPanStateChange = (e: any) => {
    if (isEndState(e.nativeEvent.state)) {
      const { translationX, translationY } =
        e.nativeEvent;
      lastOffset.current = {
        x:
          lastOffset.current.x +
          translationX,
        y:
          lastOffset.current.y +
          translationY,
      };
    }
  };

  // Pinch handlers
  const onPinchEvent = (e: any) => {
    const s =
      baseScale.current *
      e.nativeEvent.scale;
    setScale(clamp(s, 1, 4));
  };

  const onPinchStateChange = (e: any) => {
    if (isEndState(e.nativeEvent.state)) {
      baseScale.current = clamp(
        baseScale.current *
          e.nativeEvent.scale,
        1,
        4,
      );
      setScale(baseScale.current);
    }
  };

  // Slider (esp. desktop/web)
  const onSliderChange = (val: number) => {
    const s = clamp(val, 1, 4);
    baseScale.current = s;
    setScale(s);
  };

  const emitDone = (uri: string) => {
    onCropped?.(uri);
    onDone?.(uri);
  };

  // Map current circle + transform -> cropped avatar
  const doCrop = async () => {
    if (!effectiveUri || !imgSize || saving)
      return;

    try {
      setSaving(true);

      const { w: imgW, h: imgH } = imgSize;

      // In the avatar container's own coords:
      //  - circle center is (AVATAR_RADIUS, AVATAR_RADIUS)
      //  - image center is (AVATAR_RADIUS + translate.x, AVATAR_RADIUS + translate.y)
      const cxView = AVATAR_RADIUS;
      const cyView = AVATAR_RADIUS;
      const imgCxView =
        AVATAR_RADIUS + translate.x;
      const imgCyView =
        AVATAR_RADIUS + translate.y;

      // Map circle center from view -> image space
      const ixCenter =
        (cxView - imgCxView) /
          totalScale +
        imgW / 2;
      const iyCenter =
        (cyView - imgCyView) /
          totalScale +
        imgH / 2;

      // Circle radius in image px
      const rImg =
        AVATAR_RADIUS /
        totalScale;

      // Crop square that bounds the circle
      let originX = ixCenter - rImg;
      let originY = iyCenter - rImg;
      let size = rImg * 2;

      // Clamp within image
      if (size > imgW || size > imgH) {
        size = Math.min(imgW, imgH);
        originX = (imgW - size) / 2;
        originY = (imgH - size) / 2;
      } else {
        originX = clamp(
          originX,
          0,
          imgW - size,
        );
        originY = clamp(
          originY,
          0,
          imgH - size,
        );
      }

      const actions: ImageManipulator.Action[] =
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
        ];

      const result =
        await ImageManipulator.manipulateAsync(
          effectiveUri,
          actions,
          {
            compress: 0.9,
            format:
              ImageManipulator
                .SaveFormat.JPEG,
          },
        );

      emitDone(result.uri);
    } catch (err) {
      // Fallback: return original
      emitDone(effectiveUri);
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  // Preview text fallbacks
  const displayRole =
    (mainRoleName || '')
      .toString()
      .trim()
      .toUpperCase() || 'DIRECTOR';
  const displayName =
    (fullName || '')
      .toString()
      .trim() || 'Your Name';
  const displayCity =
    (cityName || '')
      .toString()
      .trim() || 'Your City';
  const displayLevel =
    typeof level === 'number' && level > 0
      ? level
      : 8;
  const ringColor =
    getRingColorForLevel(level);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>
            Adjust profile picture
          </Text>

          {/* HERO PREVIEW */}
          <View
            style={[
              styles.previewWrap,
              {
                width: PREVIEW_W,
                height: BANNER_H,
              },
            ]}
          >
            {/* Banner */}
            {effectiveUri ? (
              <Image
                source={{ uri: effectiveUri }}
                style={styles.bannerImage}
                resizeMode="cover"
              />
            ) : (
              <View
                style={[
                  styles.bannerImage,
                  {
                    backgroundColor:
                      '#151515',
                  },
                ]}
              />
            )}

            {/* Banner gradient + text */}
            <View
              style={styles.bannerOverlay}
            >
              <View
                style={styles.bannerTextWrap}
              >
                <Text
                  style={
                    styles.roleText
                  }
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {displayRole}
                </Text>
                <Text
                  style={
                    styles.metaText
                  }
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {displayName}
                  {'  •  '}
                  {displayCity}
                </Text>
              </View>
            </View>

            {/* Avatar ring + interactive circle */}
            <View
              style={[
                styles.avatarRingWrapper,
                {
                  width:
                    AVATAR_DIAMETER +
                    14,
                  height:
                    AVATAR_DIAMETER +
                    14,
                  left: AVATAR_LEFT - 7,
                  top:
                    BANNER_H -
                    AVATAR_BOTTOM -
                    AVATAR_DIAMETER -
                    7,
                  borderColor:
                    ringColor,
                },
              ]}
            >
              <View
                style={[
                  styles.avatarRing,
                  {
                    borderColor:
                      ringColor,
                  },
                ]}
              />

              {/* Avatar crop interaction */}
              <PinchGestureHandler
                onGestureEvent={
                  onPinchEvent
                }
                onHandlerStateChange={
                  onPinchStateChange
                }
              >
                <View
                  style={
                    styles.gestureFill
                  }
                >
                  <PanGestureHandler
                    onGestureEvent={
                      onPanEvent
                    }
                    onHandlerStateChange={
                      onPanStateChange
                    }
                  >
                    <View
                      style={[
                        styles.avatarCircle,
                        {
                          width:
                            AVATAR_DIAMETER,
                          height:
                            AVATAR_DIAMETER,
                          borderRadius:
                            AVATAR_RADIUS,
                        },
                      ]}
                    >
                      {loadingMeta ||
                      !imgSize ||
                      !effectiveUri ? (
                        <View
                          style={
                            styles.avatarLoading
                          }
                        >
                          <ActivityIndicator
                            color={
                              GOLD
                            }
                          />
                        </View>
                      ) : (
                        <Image
                          source={{
                            uri: effectiveUri,
                          }}
                          style={{
                            position:
                              'absolute',
                            width:
                              imgSize.w *
                              totalScale,
                            height:
                              imgSize.h *
                              totalScale,
                            left:
                              AVATAR_RADIUS -
                              (imgSize.w *
                                totalScale) /
                                2 +
                              translate.x,
                            top:
                              AVATAR_RADIUS -
                              (imgSize.h *
                                totalScale) /
                                2 +
                              translate.y,
                          }}
                          resizeMode="cover"
                        />
                      )}
                    </View>
                  </PanGestureHandler>
                </View>
              </PinchGestureHandler>
            </View>

            {/* Level pill */}
            <View
              style={[
                styles.levelPill,
                {
                  left:
                    AVATAR_LEFT +
                    AVATAR_DIAMETER -
                    12,
                  top:
                    BANNER_H -
                    AVATAR_BOTTOM -
                    18,
                  backgroundColor:
                    ringColor,
                },
              ]}
            >
              <Text
                style={
                  styles.levelPillText
                }
              >
                Lv {displayLevel}
              </Text>
            </View>
          </View>

          {/* Zoom slider */}
          <View style={styles.zoomRow}>
            <Text
              style={styles.zoomLabel}
            >
              Zoom
            </Text>
            <Slider
              style={
                styles.slider
              }
              minimumValue={1}
              maximumValue={4}
              value={scale}
              onValueChange={
                onSliderChange
              }
              minimumTrackTintColor={
                GOLD
              }
              maximumTrackTintColor="#444"
              thumbTintColor={GOLD}
            />
          </View>

          <Text
            style={styles.hint}
            numberOfLines={2}
          >
            Drag inside the circle to
            position your avatar ·
            Pinch to zoom (mobile) ·
            Or use the slider
          </Text>

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              onPress={onCancel}
              disabled={saving}
              style={[
                styles.btn,
                styles.btnGhost,
              ]}
            >
              <Text
                style={
                  styles.btnGhostText
                }
              >
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={doCrop}
              disabled={
                saving ||
                loadingMeta ||
                !effectiveUri
              }
              style={[
                styles.btn,
                styles.btnPrimary,
                (saving ||
                  loadingMeta ||
                  !effectiveUri) && {
                  opacity: 0.6,
                },
              ]}
            >
              {saving ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text
                  style={
                    styles.btnPrimaryText
                  }
                >
                  Save
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ======================= STYLES ======================= */

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
    borderRadius: 18,
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
    fontFamily: FONT_OBLIVION,
  },
  previewWrap: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FFFFFF22',
    overflow: 'hidden',
    backgroundColor: '#000',
    position: 'relative',
  },
  bannerImage: {
    ...StyleSheet.absoluteFillObject,
  },
  bannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 18,
    backgroundColor:
      'rgba(0,0,0,0.18)',
  },
  bannerTextWrap: {
    alignItems: 'center',
  },
  roleText: {
    color: COLORS.textPrimary,
    fontSize: 40,
    letterSpacing: 3,
    fontWeight: '400',
    textTransform: 'uppercase',
    fontFamily: FONT_OBLIVION,
  },
  metaText: {
    marginTop: 8,
    color: COLORS.textSecondary,
    fontSize: 13,
    letterSpacing: 2,
    fontFamily: FONT_OBLIVION,
  },
  avatarRingWrapper: {
    position: 'absolute',
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor:
      'rgba(0,0,0,0.7)',
  },
  avatarRing: {
    position: 'absolute',
    top: 7,
    left: 7,
    right: 7,
    bottom: 7,
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
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  levelPillText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 1,
    fontFamily: FONT_OBLIVION,
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
    fontFamily: FONT_OBLIVION,
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
    fontFamily: FONT_OBLIVION,
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
    borderColor: '#FFFFFF44',
    backgroundColor:
      'transparent',
  },
  btnGhostText: {
    color: COLORS.textPrimary,
    fontWeight: '800',
    fontFamily: FONT_OBLIVION,
  },
  btnPrimary: {
    borderColor: GOLD,
    backgroundColor: GOLD,
  },
  btnPrimaryText: {
    color: '#000',
    fontWeight: '900',
    fontFamily: FONT_OBLIVION,
  },
});
