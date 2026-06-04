import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  PanGestureHandler,
  PinchGestureHandler,
  State,
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

const GOLD = '#C6A664';
const IVORY = '#F4EFE6';
const MUTED = '#D8D2C8';
const SOFT = '#A59D90';
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;

const COLORS = {
  background: 'rgba(0,0,0,0.94)',
  panel: '#0D0D0F',
  border: 'rgba(255,255,255,0.12)',
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

function isEndState(state: number) {
  return (
    state === State.END ||
    state === State.CANCELLED ||
    state === State.FAILED
  );
}

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

export default function AvatarCropper({
  visible,
  imageUri,
  sourceUri,
  onCancel,
  onCropped,
  onDone,
}: Props) {
  const effectiveUri = imageUri || sourceUri || undefined;
  const { width, height } = useWindowDimensions();

  const cropSize = useMemo(
    () => Math.floor(Math.min(width - 44, height * 0.48, 390)),
    [height, width]
  );
  const cropRadius = cropSize / 2;

  const [workingUri, setWorkingUri] = useState<string | null>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [saving, setSaving] = useState(false);

  const [zoom, setZoom] = useState(1);
  const [baseZoom, setBaseZoom] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [lastOffset, setLastOffset] = useState({ x: 0, y: 0 });

  const baseFitScale = imgSize
    ? Math.max(cropSize / imgSize.w, cropSize / imgSize.h)
    : 1;
  const totalScale = baseFitScale * zoom;

  const getBounds = (nextZoom = zoom) => {
    if (!imgSize) return { x: 0, y: 0 };

    const nextScale = baseFitScale * nextZoom;
    return {
      x: Math.max(0, (imgSize.w * nextScale - cropSize) / 2),
      y: Math.max(0, (imgSize.h * nextScale - cropSize) / 2),
    };
  };

  const clampTranslate = (
    point: { x: number; y: number },
    nextZoom = zoom
  ) => {
    const bounds = getBounds(nextZoom);
    return {
      x: clamp(point.x, -bounds.x, bounds.x),
      y: clamp(point.y, -bounds.y, bounds.y),
    };
  };

  useEffect(() => {
    if (!visible || !effectiveUri) {
      setWorkingUri(null);
      setImgSize(null);
      return;
    }

    let active = true;

    setLoadingMeta(true);
    setSaving(false);
    setZoom(1);
    setBaseZoom(1);
    setTranslate({ x: 0, y: 0 });
    setLastOffset({ x: 0, y: 0 });

    const loadSize = (uri: string) => {
      Image.getSize(
        uri,
        (w, h) => {
          if (!active) return;
          setWorkingUri(uri);
          setImgSize({ w, h });
          setLoadingMeta(false);
        },
        () => {
          if (!active) return;
          setWorkingUri(uri);
          setImgSize({ w: 1000, h: 1000 });
          setLoadingMeta(false);
        }
      );
    };

    ImageManipulator.manipulateAsync(
      effectiveUri,
      [],
      {
        compress: 1,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    )
      .then((result) => {
        if (!active) return;
        loadSize(result.uri);
      })
      .catch(() => {
        if (!active) return;
        loadSize(effectiveUri);
      });

    return () => {
      active = false;
    };
  }, [cropSize, effectiveUri, visible]);

  const onPanEvent = (e: any) => {
    const { translationX, translationY } = e.nativeEvent;
    setTranslate(
      clampTranslate({
        x: lastOffset.x + translationX,
        y: lastOffset.y + translationY,
      })
    );
  };

  const onPanStateChange = (e: any) => {
    if (!isEndState(e.nativeEvent.state)) return;

    const { translationX, translationY } = e.nativeEvent;
    const next = clampTranslate({
      x: lastOffset.x + translationX,
      y: lastOffset.y + translationY,
    });

    setTranslate(next);
    setLastOffset(next);
  };

  const setZoomAndClamp = (nextZoom: number) => {
    const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    const nextTranslate = clampTranslate(translate, clampedZoom);

    setZoom(clampedZoom);
    setTranslate(nextTranslate);
    setLastOffset(nextTranslate);
  };

  const onPinchEvent = (e: any) => {
    const nextZoom = clamp(baseZoom * e.nativeEvent.scale, MIN_ZOOM, MAX_ZOOM);
    setZoom(nextZoom);
    setTranslate(clampTranslate(translate, nextZoom));
  };

  const onPinchStateChange = (e: any) => {
    if (!isEndState(e.nativeEvent.state)) return;

    const nextZoom = clamp(baseZoom * e.nativeEvent.scale, MIN_ZOOM, MAX_ZOOM);
    const nextTranslate = clampTranslate(translate, nextZoom);

    setBaseZoom(nextZoom);
    setZoom(nextZoom);
    setTranslate(nextTranslate);
    setLastOffset(nextTranslate);
  };

  const emitDone = (uri: string) => {
    onCropped?.(uri);
    onDone?.(uri);
  };

  const doCrop = async () => {
    const source = workingUri || effectiveUri;
    if (!source || !imgSize || saving || cropSize <= 0) return;

    try {
      setSaving(true);

      const { w: imgW, h: imgH } = imgSize;
      const imageWView = imgW * totalScale;
      const imageHView = imgH * totalScale;
      const imageLeft = cropRadius - imageWView / 2 + translate.x;
      const imageTop = cropRadius - imageHView / 2 + translate.y;

      const rawSize = cropSize / totalScale;
      const size = Math.min(rawSize, imgW, imgH);
      const originX = clamp(-imageLeft / totalScale, 0, imgW - size);
      const originY = clamp(-imageTop / totalScale, 0, imgH - size);

      const result = await ImageManipulator.manipulateAsync(
        source,
        [
          {
            crop: {
              originX: Math.round(originX),
              originY: Math.round(originY),
              width: Math.round(size),
              height: Math.round(size),
            },
          },
          {
            resize: {
              width: 768,
              height: 768,
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
      console.log('Avatar crop error:', err);
      if (source) emitDone(source);
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  const imageReady = !!workingUri && !!imgSize && !loadingMeta;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onCancel}
            disabled={saving}
            activeOpacity={0.85}
            style={styles.headerButton}
          >
            <Text style={styles.headerButtonText}>Cancel</Text>
          </TouchableOpacity>

          <Text style={styles.title}>Adjust profile picture</Text>

          <TouchableOpacity
            onPress={doCrop}
            disabled={saving || !imageReady}
            activeOpacity={0.85}
            style={[
              styles.headerButton,
              styles.saveButton,
              (saving || !imageReady) && { opacity: 0.55 },
            ]}
          >
            {saving ? (
              <ActivityIndicator color="#000" size="small" />
            ) : (
              <Text style={styles.saveButtonText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.subtitle}>
          Drag and pinch until the circle matches the profile photo you want.
        </Text>

        <View style={styles.stage}>
          <PinchGestureHandler
            onGestureEvent={onPinchEvent}
            onHandlerStateChange={onPinchStateChange}
          >
            <View collapsable={false}>
              <PanGestureHandler
                onGestureEvent={onPanEvent}
                onHandlerStateChange={onPanStateChange}
              >
                <View
                  collapsable={false}
                  style={[
                    styles.cropViewport,
                    {
                      width: cropSize,
                      height: cropSize,
                      borderRadius: cropRadius,
                    },
                  ]}
                >
                  {imageReady ? (
                    <Image
                      source={{ uri: workingUri }}
                      style={{
                        position: 'absolute',
                        width: imgSize.w * totalScale,
                        height: imgSize.h * totalScale,
                        left: cropRadius - (imgSize.w * totalScale) / 2 + translate.x,
                        top: cropRadius - (imgSize.h * totalScale) / 2 + translate.y,
                      }}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={styles.loadingState}>
                      <ActivityIndicator color={GOLD} />
                    </View>
                  )}
                </View>
              </PanGestureHandler>
            </View>
          </PinchGestureHandler>

          <View
            pointerEvents="none"
            style={[
              styles.cropRing,
              {
                width: cropSize,
                height: cropSize,
                borderRadius: cropRadius,
              },
            ]}
          />
        </View>

        <View style={styles.zoomPanel}>
          <View style={styles.zoomLabelRow}>
            <Text style={styles.zoomLabel}>Zoom</Text>
            <Text style={styles.zoomValue}>{zoom.toFixed(1)}x</Text>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={MIN_ZOOM}
            maximumValue={MAX_ZOOM}
            value={zoom}
            onValueChange={setZoomAndClamp}
            minimumTrackTintColor={GOLD}
            maximumTrackTintColor="rgba(255,255,255,0.20)"
            thumbTintColor={GOLD}
          />
        </View>

        <Text style={styles.hint}>
          The saved avatar is exactly the image inside the circle.
        </Text>
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
    paddingHorizontal: 22,
    paddingVertical: Platform.OS === 'ios' ? 58 : 34,
  },

  header: {
    width: '100%',
    maxWidth: 540,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },

  headerButton: {
    minWidth: 76,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },

  headerButtonText: {
    color: COLORS.textSecondary,
    fontFamily: FONT_PRIMARY,
    fontWeight: '800',
    fontSize: 12,
  },

  saveButton: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },

  saveButtonText: {
    color: '#000',
    fontFamily: FONT_PRIMARY,
    fontWeight: '900',
    fontSize: 12,
  },

  title: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '900',
    fontFamily: FONT_PRIMARY,
    textAlign: 'center',
    paddingHorizontal: 10,
  },

  subtitle: {
    maxWidth: 420,
    color: COLORS.textSecondary,
    fontFamily: FONT_PRIMARY,
    fontWeight: '600',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginBottom: 20,
  },

  stage: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  cropViewport: {
    overflow: 'hidden',
    backgroundColor: '#050505',
  },

  cropRing: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: GOLD,
    shadowColor: GOLD,
    shadowOpacity: 0.24,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },

  loadingState: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#050505',
  },

  zoomPanel: {
    width: '100%',
    maxWidth: 430,
    borderRadius: 18,
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    marginTop: 24,
  },

  zoomLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },

  zoomLabel: {
    color: COLORS.textPrimary,
    fontFamily: FONT_PRIMARY,
    fontWeight: '900',
    fontSize: 12,
  },

  zoomValue: {
    color: COLORS.hint,
    fontFamily: FONT_PRIMARY,
    fontWeight: '800',
    fontSize: 11,
  },

  slider: {
    width: '100%',
    height: 36,
  },

  hint: {
    maxWidth: 420,
    color: COLORS.hint,
    fontFamily: FONT_PRIMARY,
    fontWeight: '600',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 14,
  },
});
