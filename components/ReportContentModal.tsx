import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { REPORT_REASONS, ReportReason } from '../app/utils/reportContent';

const GOLD = '#C6A664';
const TEXT = '#F4EFE6';
const MUTED = 'rgba(255,255,255,0.62)';
const PANEL = '#0D0D0F';
const FIELD = '#111114';

const SYSTEM_SANS = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: undefined,
  default: undefined,
});

type Props = {
  visible: boolean;
  title?: string;
  subtitle?: string;
  selectedReason: ReportReason;
  details: string;
  submitting?: boolean;
  onReasonChange: (reason: ReportReason) => void;
  onDetailsChange: (details: string) => void;
  onSubmit: () => void;
  onClose: () => void;
};

export default function ReportContentModal({
  visible,
  title = 'Report',
  subtitle = 'Tell us what happened. Reports are reviewed within 24 hours.',
  selectedReason,
  details,
  submitting,
  onReasonChange,
  onDetailsChange,
  onSubmit,
  onClose,
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />

        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={styles.iconBadge}>
              <Ionicons name="flag-outline" size={17} color={GOLD} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.85}>
              <Ionicons name="close" size={18} color={MUTED} />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollBody}
          >
            <Text style={styles.label}>Reason</Text>
            <View style={styles.reasonWrap}>
              {REPORT_REASONS.map((reason) => {
                const active = selectedReason === reason;
                return (
                  <TouchableOpacity
                    key={reason}
                    activeOpacity={0.86}
                    onPress={() => onReasonChange(reason)}
                    style={[styles.reasonChip, active && styles.reasonChipActive]}
                  >
                    <Text style={[styles.reasonText, active && styles.reasonTextActive]}>
                      {reason}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.label}>Details</Text>
            <View style={styles.messageBubble}>
              <TextInput
                value={details}
                onChangeText={onDetailsChange}
                placeholder="Write a short note for the review team..."
                placeholderTextColor="rgba(248,246,241,0.36)"
                multiline
                maxLength={500}
                style={styles.input}
              />
            </View>
          </ScrollView>

          <TouchableOpacity
            activeOpacity={0.9}
            onPress={onSubmit}
            disabled={submitting}
            style={[styles.submitBtn, submitting && { opacity: 0.65 }]}
          >
            {submitting ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.submitText}>Send Report</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 22,
    zIndex: 999999,
    elevation: 999999,
  },
  sheet: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '86%',
    alignSelf: 'center',
    borderRadius: 26,
    backgroundColor: PANEL,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    padding: 16,
    zIndex: 1000000,
    elevation: 1000000,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(198,166,100,0.11)',
    borderWidth: 1,
    borderColor: 'rgba(198,166,100,0.22)',
  },
  title: {
    color: TEXT,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 0.3,
    fontFamily: SYSTEM_SANS,
  },
  subtitle: {
    color: MUTED,
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: SYSTEM_SANS,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  scrollBody: {
    paddingBottom: 10,
  },
  label: {
    color: GOLD,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 10,
    fontFamily: SYSTEM_SANS,
  },
  reasonWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reasonChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    backgroundColor: FIELD,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  reasonChipActive: {
    borderColor: 'rgba(198,166,100,0.42)',
    backgroundColor: 'rgba(198,166,100,0.12)',
  },
  reasonText: {
    color: 'rgba(248,246,241,0.76)',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: SYSTEM_SANS,
  },
  reasonTextActive: {
    color: GOLD,
  },
  messageBubble: {
    minHeight: 112,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    backgroundColor: FIELD,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  input: {
    minHeight: 88,
    color: TEXT,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: 'top',
    fontFamily: SYSTEM_SANS,
    outlineStyle: 'none',
  } as any,
  submitBtn: {
    height: 48,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GOLD,
    marginTop: 10,
  },
  submitText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },
});
