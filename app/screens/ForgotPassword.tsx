// app/screens/ForgotPassword.tsx
// ------------------------------------------------------------
// Polished OverLooked-style Password Reset Screen
// ------------------------------------------------------------

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';

// SAME THEME AS SignInScreen
const DARK_BG = '#0D0D0D';
const DARK_ELEVATED = '#171717';
const TEXT_IVORY = '#EDEBE6';
const TEXT_MUTED = '#A7A6A2';
const GOLD = '#C6A664';

const SYSTEM_SANS =
  Platform.select({ ios: 'System', android: 'Roboto', web: undefined }) || undefined;

const T = {
  bg: DARK_BG,
  card: DARK_ELEVATED,
  card2: '#111111',
  text: TEXT_IVORY,
  sub: '#D0CEC8',
  mute: TEXT_MUTED,
  accent: GOLD,
  olive: GOLD,
  border: '#2E2E2E',
};

export default function ForgotPassword() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');

  const handleReset = async () => {
    setSending(true);
    setMessage('');

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      // ⭐ UPDATED FOR WEB + MOBILE (Step 5)
      redirectTo: Platform.select({
        web: 'https://overlooked.cloud/reset-password',
        default: 'overlooked://reset-password',
      }),
    });

    setSending(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage('Check your inbox for a link to reset your password.');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={[
            styles.container,
            { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 },
          ]}
        >
          {/* Back Button */}
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <Ionicons name="chevron-back" size={20} color={T.sub} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          {/* Card */}
          <View style={styles.card}>
            <Text style={styles.title}>Reset Your Password</Text>
            <Text style={styles.subtitle}>
              Enter the email linked to your account.
            </Text>

            <View style={[styles.inputWrap]}>
              <Ionicons name="mail" size={16} color={T.mute} />
              <TextInput
                style={styles.input}
                placeholder="Email address"
                placeholderTextColor={T.mute}
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
            </View>

            {/* SEND BUTTON */}
            <TouchableOpacity
              onPress={handleReset}
              disabled={sending}
              style={[styles.button, sending && { opacity: 0.7 }]}
            >
              {sending ? (
                <ActivityIndicator color={DARK_BG} />
              ) : (
                <Text style={styles.buttonText}>Send Reset Email</Text>
              )}
            </TouchableOpacity>

            {/* MESSAGE */}
            {message ? <Text style={styles.message}>{message}</Text> : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ------------------------------------------------------------
// STYLES
// ------------------------------------------------------------
const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 22,
    alignItems: 'center',
    backgroundColor: T.bg,
  },

  backButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },

  backText: {
    color: T.sub,
    fontFamily: SYSTEM_SANS,
    fontWeight: '600',
    marginLeft: 4,
  },

  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: T.card2,
    borderRadius: 18,
    padding: 22,
    borderWidth: 1,
    borderColor: T.border,
  },

  title: {
    fontSize: 20,
    color: T.text,
    fontWeight: '900',
    letterSpacing: 0.6,
    textAlign: 'center',
    marginBottom: 6,
    fontFamily: SYSTEM_SANS,
  },

  subtitle: {
    color: T.sub,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 18,
    fontFamily: SYSTEM_SANS,
  },

  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#0C0C0C',
    marginBottom: 16,
  },

  input: {
    flex: 1,
    color: T.text,
    fontSize: 15,
    fontFamily: SYSTEM_SANS,
  },

  button: {
    backgroundColor: T.accent,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: T.accent,
    marginTop: 4,
  },

  buttonText: {
    color: DARK_BG,
    fontSize: 15,
    fontWeight: '900',
    fontFamily: SYSTEM_SANS,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  message: {
    marginTop: 16,
    color: T.sub,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
    fontSize: 13.5,
    lineHeight: 20,
  },
});
