import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import COLORS from '../theme/colors';

export default function CheckEmailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const email = route.params?.email;

  const [timer, setTimer] = useState(60);
  const [canResend, setCanResend] = useState(false);
  const [loading, setLoading] = useState(false);

  // ---------------------------------------------------------
  // ⭐ 1. On mount, check if there's already a signed-in session
  // (this happens after email verification on WEB)
  // ---------------------------------------------------------
  useEffect(() => {
    async function checkSession() {
      const { data } = await supabase.auth.getSession();

      // If Supabase already restored the session → user verified email
      if (data?.session) {
        navigation.reset({
          index: 0,
          routes: [{ name: 'CreateProfile' }],
        });
      }
    }

    checkSession();
  }, []);

  // ---------------------------------------------------------
  // ⭐ 2. Listen for Supabase auth events
  // - SIGNED_IN        → email verified / magic link complete
  // - PASSWORD_RECOVERY → handle reset password flow
  // ---------------------------------------------------------
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
          navigation.navigate('NewPassword');
          return;
        }

        if (event === 'SIGNED_IN' && session) {
          navigation.reset({
            index: 0,
            routes: [{ name: 'CreateProfile' }],
          });
          return;
        }
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  // ---------------------------------------------------------
  // TIMER FOR RESEND BUTTON
  // ---------------------------------------------------------
  useEffect(() => {
    const countdown = setInterval(() => {
      setTimer(prev => {
        if (prev <= 1) {
          clearInterval(countdown);
          setCanResend(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdown);
  }, []);

  // ---------------------------------------------------------
  // RESEND EMAIL
  // ---------------------------------------------------------
  const handleResend = async () => {
    if (!email) {
      Alert.alert('Missing email', 'No email address found to resend to.');
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
    });

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('Email Sent', 'A new verification email has been sent.');
      setTimer(60);
      setCanResend(false);
    }

    setLoading(false);
  };

  return (
    <View style={styles.screenWrapper}>
      <View style={styles.container}>
        <Text style={styles.title}>VERIFY YOUR EMAIL</Text>

        <View style={styles.card}>
          <Text style={styles.message}>
            We’ve sent a verification link{email ? ' to:' : '.'}
          </Text>

          {email && <Text style={styles.email}>{email}</Text>}

          <Text style={styles.message}>
            Please check your inbox to continue.
          </Text>

          {!canResend ? (
            <Text style={styles.timer}>You can resend in {timer}s</Text>
          ) : (
            <TouchableOpacity
              style={styles.resendButton}
              onPress={handleResend}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={styles.resendText}>Resend Email</Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.navigate('SignIn')}
        >
          <Text style={styles.backText}>← Back to Sign In</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ---------------------------------------------------------
// STYLES (unchanged)
// ---------------------------------------------------------
const background = '#0D0D0D';
const ivory = '#EDEBE6';
const gold = '#C6A664';
const cardDark = '#1A1A1A';
const border = 'rgba(255,255,255,0.08)';

const styles = StyleSheet.create({
  screenWrapper: {
    flex: 1,
    backgroundColor: background,
    minHeight: Platform.OS === 'web' ? ('100vh' as any) : '100%',
  },

  container: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: background,
    minHeight: Platform.OS === 'web' ? ('100vh' as any) : '100%',
  },

  title: {
    fontSize: 26,
    fontWeight: '700',
    color: ivory,
    marginBottom: 28,
    letterSpacing: 1,
    textAlign: 'center',
  },

  card: {
    width: '100%',
    backgroundColor: cardDark,
    padding: 22,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: border,
    alignItems: 'center',
  },

  message: {
    color: ivory,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 8,
  },

  email: {
    color: gold,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },

  timer: {
    marginTop: 18,
    color: ivory,
    fontSize: 14,
  },

  resendButton: {
    marginTop: 20,
    backgroundColor: gold,
    paddingVertical: 12,
    paddingHorizontal: 26,
    borderRadius: 12,
  },

  resendText: {
    color: background,
    fontWeight: '700',
    fontSize: 15,
  },

  backButton: {
    marginTop: 32,
  },

  backText: {
    color: ivory,
    fontSize: 14,
    opacity: 0.7,
  },
});
