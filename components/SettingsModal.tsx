// components/SettingsModal.tsx
import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSettingsModal } from '../app/context/SettingsModalContext';
import { supabase, FUNCTIONS_URL } from '../app/lib/supabase';
import { UpgradeModal } from './UpgradeModal';

/* ------------------------------- palette -------------------------------- */
const DARK_BG = '#0D0D0D';
const DARK_CARD = '#050505';
const DARK_ELEVATED = '#171717';
const TEXT_IVORY = '#EDEBE6';
const TEXT_MUTED = '#A7A6A2';
const DIVIDER = '#2A2A2A';
const GOLD = '#C6A664';

/* ------------------------------- fonts ---------------------------------- */
const SYSTEM_SANS = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: undefined,
  default: undefined,
});

/* ---------- helpers (unchanged) ---------- */
async function confirm(opts: {
  title: string;
  message: string;
  okText?: string;
  cancelText?: string;
  destructive?: boolean;
}): Promise<boolean> {
  const { title, message, okText = 'OK', cancelText = 'Cancel', destructive } =
    opts;

  if (Platform.OS === 'web') {
    return window.confirm(`${title}\n\n${message}`);
  }

  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelText, style: 'cancel', onPress: () => resolve(false) },
        {
          text: okText,
          style: destructive ? 'destructive' : 'default',
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true }
    );
  });
}

const withTimeout = <T,>(p: Promise<T>, ms = 15000) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Request timed out')), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });

async function getAccessToken() {
  const { data: s1 } = await supabase.auth.getSession();
  if (s1.session?.access_token) return s1.session.access_token;

  try {
    await supabase.auth.refreshSession();
  } catch {}

  const { data: s2 } = await supabase.auth.getSession();
  return s2.session?.access_token ?? null;
}

async function callFunction(
  fnName: 'delete-account'
): Promise<{ status: number; text: string; data?: any }> {
  const token = await getAccessToken();
  if (!token)
    return { status: 401, text: 'No active session (not signed in)' };

  const url = `${FUNCTIONS_URL}/${fnName}`;
  const res = await withTimeout(
    fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: '{}',
    })
  );

  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {}

  return { status: res.status, text, data };
}

/* ---------------------- DARK THEME SECTION BUTTON ---------------------- */
function SectionButton(props: {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  danger?: boolean;
  loading?: boolean;
  disabled?: boolean;
}) {
  const { title, subtitle, onPress, danger, loading, disabled } = props;

  return (
    <Pressable
      onPress={onPress}
      disabled={loading || disabled}
      style={({ pressed }) => [
        styles.sectionButton,
        pressed && !disabled && { opacity: 0.7 },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text
        style={[
          styles.sectionTitle,
          danger && { color: TEXT_MUTED }, // subtle, not attention-grabbing
        ]}
      >
        {title}
      </Text>

      {subtitle ? (
        <Text style={styles.sectionSubtitle}>{subtitle}</Text>
      ) : null}

      {loading && <ActivityIndicator color={GOLD} style={{ marginTop: 10 }} />}
    </Pressable>
  );
}

/* ----------------------------- MAIN MODAL ------------------------------ */
export default function SettingsModal() {
  const { isOpen, close } = useSettingsModal();
  const navigation = useNavigation<any>();

  const [deleting, setDeleting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [debug, setDebug] = useState<string | null>(null);

  const [showUpgrade, setShowUpgrade] = useState(false);

  const onSignOut = async () => {
    const ok = await confirm({
      title: 'Sign out?',
      message: 'You can sign back in anytime with your email.',
      okText: 'Sign out',
      cancelText: 'Cancel',
    });
    if (!ok) return;

    try {
      setSigningOut(true);
      const { error } = await supabase.auth.signOut();
      if (error) {
        Alert.alert('Error', error.message);
        return;
      }

      close();
      navigation.reset({
        index: 0,
        routes: [{ name: 'Auth' }],
      });
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to sign out.');
    } finally {
      setSigningOut(false);
    }
  };

  const onDeleteAccount = async () => {
    const ok = await confirm({
      title: 'Delete your account?',
      message:
        'This permanently deletes your account and data. Billing is stopped immediately.',
      okText: 'Delete Account',
      cancelText: 'Keep Account',
      destructive: true,
    });
    if (!ok) return;

    try {
      setDeleting(true);
      setDebug('delete-account: preparing…');

      const { status, text, data } = await callFunction('delete-account');

      if (status >= 400) {
        setDebug(`delete-account http ${status}: ${text}`);
        Alert.alert(
          'Error',
          `Delete failed (${status}). ${data?.message || text}`
        );
        return;
      }

      await supabase.auth.signOut().catch(() => {});
      close();

      navigation.reset({
        index: 0,
        routes: [{ name: 'Auth' }],
      });
    } catch (e: any) {
      setDebug(`delete-account exception: ${e?.message}`);
      Alert.alert('Error', e?.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={close}
      >
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            {/* Handle bar */}
            <View style={styles.handleWrap}>
              <View style={styles.handle} />
            </View>

            <Text style={styles.title}>Settings</Text>

            <SectionButton
              title="Manage membership"
              subtitle="View or change your Overlooked plan."
              onPress={() => setShowUpgrade(true)}
              disabled={deleting || signingOut}
            />

            <SectionButton
              title="Sign out"
              subtitle="Return to the login screen."
              onPress={onSignOut}
              loading={signingOut}
              disabled={deleting}
            />

            <SectionButton
              title="Delete account"
              subtitle="Permanently remove your account and data."
              onPress={onDeleteAccount}
              danger
              loading={deleting}
              disabled={signingOut}
            />

            {debug && <Text style={styles.debugText}>{debug}</Text>}

            {/* Close button */}
            <Pressable
              onPress={close}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <UpgradeModal
        visible={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        context="workshop"
      />
    </>
  );
}

/* ------------------------------- STYLES ------------------------------- */

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  sheet: {
    backgroundColor: DARK_CARD,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingVertical: 22,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: DIVIDER,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 18,
    elevation: 14,
  },
  handleWrap: {
    alignItems: 'center',
    marginBottom: 12,
  },
  handle: {
    width: 44,
    height: 4,
    borderRadius: 999,
    backgroundColor: DIVIDER,
  },
  title: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1.6,
    color: TEXT_IVORY,
    textAlign: 'center',
    marginBottom: 16,
    fontFamily: SYSTEM_SANS,
  },

  /* SECTION BUTTONS */
  sectionButton: {
    backgroundColor: DARK_BG,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: DIVIDER,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },
  sectionSubtitle: {
    marginTop: 6,
    fontSize: 13,
    color: TEXT_MUTED,
    lineHeight: 17,
    fontFamily: SYSTEM_SANS,
  },

  debugText: {
    fontSize: 11,
    color: GOLD,
    opacity: 0.85,
    marginTop: 8,
    fontFamily: SYSTEM_SANS,
  },

  closeButton: {
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: DARK_ELEVATED,
    borderWidth: 1,
    borderColor: DIVIDER,
  },
  closeText: {
    color: TEXT_IVORY,
    fontSize: 15,
    fontWeight: '700',
    fontFamily: SYSTEM_SANS,
  },
});
