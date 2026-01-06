// screens/SignUpScreen.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  SafeAreaView,
  Modal,
  ScrollView,
} from 'react-native';
import * as Linking from 'expo-linking';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import COLORS from '../theme/colors';

// DARK THEME PALETTE (aligned with MainTabs)
const DARK_BG = '#0D0D0D';
const DARK_CARD = '#171717';
const DARK_INPUT = '#111111';
const TEXT_IVORY = '#EDEBE6';
const TEXT_MUTED = '#A7A6A2';
const GOLD = '#C6A664';
const BORDER = '#2A2A2A';

export default function SignUpScreen() {
  const navigation = useNavigation<any>();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [agreedPrograms, setAgreedPrograms] = useState(false);
  const [isEighteen, setIsEighteen] = useState(false);
  const [loading, setLoading] = useState(false);

  const [showTos, setShowTos] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showRewards, setShowRewards] = useState(false);

  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [checkingLink, setCheckingLink] = useState(true);

  // ✅ Redirect for email confirmation (FIXED)
  // Web: stable callback path
  // Native: uses deep link "overlooked://auth/callback" (matches Supabase Redirect URLs)
  const emailRedirectTo = useMemo(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      return `${window.location.origin}/auth/callback`;
    }
    return Linking.createURL('auth/callback');
  }, []);

  const refreshConfirmedFromUser = async () => {
    const { data } = await supabase.auth.getUser();
    const confirmed =
      !!data?.user?.email_confirmed_at ||
      data?.user?.user_metadata?.email_confirmed === true;
    if (confirmed) setEmailConfirmed(true);
    return confirmed;
  };

  const parseTokensFromUrl = (url: string) => {
    const parsed = Linking.parse(url);
    let params: Record<string, any> = {};

    if (typeof window !== 'undefined' && Platform.OS === 'web') {
      const hash = window.location.hash?.replace(/^#/, '') ?? '';
      const searchParams = new URLSearchParams(hash);
      searchParams.forEach((v, k) => (params[k] = v));
    }

    if (parsed?.queryParams) params = { ...params, ...parsed.queryParams };

    return {
      access_token: params['access_token'],
      refresh_token: params['refresh_token'],
      token_type: params['token_type'],
      type: params['type'],
      error_description: params['error_description'],
      code: params['code'],
    };
  };

  const maybeHandleAuthDeepLink = async (url?: string | null) => {
    if (!url) return false;

    try {
      // PKCE
      if (url.includes('code=')) {
        const { error } = await supabase.auth.exchangeCodeForSession(url);
        if (error) {
          Alert.alert('Email Confirmation', 'Could not finish sign-in. Try again.');
          return false;
        }

        setEmailConfirmed(true);

        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          const clean = window.location.origin + window.location.pathname;
          window.history.replaceState({}, document.title, clean);
        }
        return true;
      }

      const { access_token, refresh_token, type, error_description } =
        parseTokensFromUrl(url);

      if (error_description) {
        Alert.alert('Email Confirmation', decodeURIComponent(error_description));
        return false;
      }

      if (access_token && refresh_token) {
        const { data, error } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });

        if (error) return false;

        if (type === 'signup' || data?.session?.user?.email_confirmed_at) {
          setEmailConfirmed(true);
        } else {
          await refreshConfirmedFromUser();
        }

        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          const clean = window.location.origin + window.location.pathname;
          window.history.replaceState({}, document.title, clean);
        }

        return true;
      }
    } catch (err) {
      console.error('Deep link error:', err);
    }

    return false;
  };

  // Init deep link listener
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const init = async () => {
      try {
        if (Platform.OS !== 'web') {
          const initial = await Linking.getInitialURL();
          await maybeHandleAuthDeepLink(initial);
        } else if (typeof window !== 'undefined') {
          await maybeHandleAuthDeepLink(window.location.href);
        }

        const sub = Linking.addEventListener('url', async (event) => {
          await maybeHandleAuthDeepLink(event.url);
        });

        unsubscribe = () => sub.remove();

        await refreshConfirmedFromUser();
      } finally {
        setCheckingLink(false);
      }
    };

    init();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
          const confirmed =
            !!session?.user?.email_confirmed_at ||
            session?.user?.user_metadata?.email_confirmed === true;

          if (confirmed) setEmailConfirmed(true);
          else await refreshConfirmedFromUser();
        }
      }
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleSignUp = async () => {
    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password || !confirm) {
      Alert.alert('Missing Fields', 'Please fill out all fields.');
      return;
    }
    if (!trimmedEmail.includes('@') || !trimmedEmail.includes('.')) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Weak Password', 'Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('Password Mismatch', 'Passwords do not match.');
      return;
    }
    if (!isEighteen) {
      Alert.alert('Age Confirmation', 'You must be at least 18.');
      return;
    }
    if (!agreed) {
      Alert.alert('Agreement Required', 'You must agree to the Terms & Privacy Policy.');
      return;
    }
    if (!agreedPrograms) {
      Alert.alert('Agreement Required', 'You must agree to the Rewards Policy.');
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: { emailRedirectTo },
      });

      if (error) {
        Alert.alert('Signup Error', error.message);
        return;
      }

      // ✅ Always show a clear success notification
      // Supabase typically returns user + no session until email is confirmed.
      Alert.alert(
        'Check your email',
        `We sent a confirmation link to:\n\n${trimmedEmail}\n\nOpen it to confirm your email, then come back and sign in.`,
        [
          {
            text: 'OK',
            onPress: () => {
              // Navigate to CheckEmail if it exists, otherwise fall back to SignIn.
              try {
                navigation.navigate('CheckEmail', { email: trimmedEmail });
              } catch (e) {
                navigation.navigate('SignIn');
              }
            },
          },
        ]
      );

      // (Keep your legal update attempt)
      try {
        if (data?.user) {
          await supabase
            .from('users')
            .update({
              legal_accepted: true,
              legal_accepted_at: new Date().toISOString(),
            })
            .eq('id', data.user.id);
        }
      } catch {}
    } catch (err: any) {
      console.error('Signup exception:', err);
      Alert.alert('Signup Error', 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const canSubmit =
    !!email &&
    !!password &&
    !!confirm &&
    password.length >= 6 &&
    password === confirm &&
    isEighteen &&
    agreed &&
    agreedPrograms &&
    !loading;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: DARK_BG }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.container}>
          <Text style={styles.title}>Create Account</Text>

          {(checkingLink || emailConfirmed) && (
            <View
              style={[
                styles.banner,
                emailConfirmed ? styles.bannerSuccess : styles.bannerInfo,
              ]}
            >
              <Text style={styles.bannerText}>
                {checkingLink
                  ? 'Checking confirmation link...'
                  : 'Email confirmed. You may now sign in.'}
              </Text>

              {emailConfirmed && (
                <TouchableOpacity
                  onPress={() => navigation.navigate('SignIn')}
                  style={styles.bannerAction}
                >
                  <Text style={styles.bannerActionText}>Go to Sign In</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Inputs */}
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={TEXT_MUTED}
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={TEXT_MUTED}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <TextInput
            style={styles.input}
            placeholder="Confirm Password"
            placeholderTextColor={TEXT_MUTED}
            secureTextEntry
            value={confirm}
            onChangeText={setConfirm}
          />

          {/* Checkboxes */}
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setIsEighteen(!isEighteen)}
          >
            <View
              style={[styles.checkbox, isEighteen && styles.checkboxChecked]}
            />
            <Text style={styles.checkboxText}>
              I confirm that I am at least 18 years old.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setAgreed(!agreed)}
          >
            <View style={[styles.checkbox, agreed && styles.checkboxChecked]} />
            <Text style={styles.checkboxText}>
              I agree to the{' '}
              <Text style={styles.link} onPress={() => setShowTos(true)}>
                Terms of Service
              </Text>{' '}
              and{' '}
              <Text style={styles.link} onPress={() => setShowPrivacy(true)}>
                Privacy Policy
              </Text>
              .
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setAgreedPrograms(!agreedPrograms)}
          >
            <View
              style={[
                styles.checkbox,
                agreedPrograms && styles.checkboxChecked,
              ]}
            />
            <Text style={styles.checkboxText}>
              I agree to the{' '}
              <Text style={styles.link} onPress={() => setShowRewards(true)}>
                Rewards Policy
              </Text>
              .
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, !canSubmit && { opacity: 0.5 }]}
            onPress={handleSignUp}
            disabled={!canSubmit}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Sign Up</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate('SignIn')}>
            <Text style={styles.signInLink}>
              Already have an account?{' '}
              <Text style={{ color: GOLD, fontWeight: '700' }}>Sign In</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* ---------- LEGAL MODALS (unchanged structure) ---------- */}

      {/* Terms of Service (UK Law) */}
      <Modal
        visible={showTos}
        animationType="slide"
        transparent
        onRequestClose={() => setShowTos(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <Text style={styles.modalTitle}>Terms of Service (Overlooked)</Text>
              <Text
                style={[
                  styles.modalText,
                  Platform.OS === 'web'
                    ? ({ whiteSpace: 'pre-wrap' } as any)
                    : null,
                ]}
              >
{`Last updated: ${new Date().toISOString().slice(0,10)}

These Terms of Service (“Terms”) constitute a legally binding agreement between you and Overlooked LTD (“Overlooked”, “we”, “our”, “us”). By creating an account or using Overlooked, you agree to abide by these Terms and all applicable laws of England and Wales.

1. ELIGIBILITY
- You must be at least 18 years old.

2. USER ACCOUNT
- You are responsible for maintaining the confidentiality of your login details.
- You must not impersonate others or provide false information.
- Notify us immediately of any unauthorised activity.

3. USER CONTENT
- You retain ownership of all videos, images, audio, film submissions, job listings, text, and other content you upload (“User Content”).
- You grant Overlooked a worldwide, royalty-free, sublicensable licence to host, store, reproduce, display, transmit, and promote your content solely for operating and improving the platform, including challenge features.

4. PROHIBITED CONTENT
You must not upload or share:
- Copyright-infringing, unlawful, hateful, extremist, pornographic, or exploitative content.
- Content involving minors.
- Doxxing, harassment, threats, spam, scams, or impersonation.

5. JOBS & COLLABORATIONS
- Overlooked is not a party to any agreements, contracts, or payments between users.
- You are responsible for verifying other users and complying with employment, tax, and union laws.

6. VOTING & CHALLENGES
- Overlooked may remove fraudulent votes and disqualify entries violating these Terms.
- Winners may be featured on the platform and Overlooked’s social channels.

7. ENFORCEMENT
- We may remove content, suspend users, or restrict functionality for safety or legal reasons.

8. COPYRIGHT (DMCA)
- If you believe your copyright is infringed, contact us with a valid notice.

9. DISCLAIMERS
- The service is provided “AS IS”.
- We make no warranty regarding uptime, accuracy, or availability.
- You use Overlooked at your own risk.

10. LIMITATION OF LIABILITY
- To the fullest extent permitted under UK law, Overlooked is not liable for indirect or consequential damages.
- Maximum liability is the greater of £50 or the amount paid for services in the past 12 months.

11. GOVERNING LAW
- These Terms are governed by the laws of England & Wales.
- Courts of England have exclusive jurisdiction.

12. MODIFICATIONS
- We may modify these Terms. We will notify users of material changes.`}
              </Text>
            </ScrollView>

            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowTos(false)}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Privacy Policy */}
      <Modal
        visible={showPrivacy}
        animationType="slide"
        transparent
        onRequestClose={() => setShowPrivacy(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <Text style={styles.modalTitle}>Privacy Policy (Overlooked)</Text>
              <Text
                style={[
                  styles.modalText,
                  Platform.OS === 'web'
                    ? ({ whiteSpace: 'pre-wrap' } as any)
                    : null,
                ]}
              >
{`Last updated: ${new Date().toISOString().slice(0,10)}

This Privacy Policy explains how Overlooked LTD (“Overlooked”, “we”, “our”) collects and processes your personal data in accordance with UK GDPR.

1. DATA WE COLLECT
- Account data: email, name, creative roles, city, country, profile image.
- Content data: videos, portfolio URLs, messages, votes, comments.
- Device data: IP address, browser/device type.
- Usage data: interactions, pages viewed, preferences.

2. HOW WE USE DATA
- Provide and maintain the service.
- Personalise content and user discovery.
- Secure the platform and prevent fraud.
- Communicate with you regarding account actions.
- Comply with legal obligations.

3. SHARING
- Public profile information is visible to other users.
- We share limited data with third-party processors (Supabase, analytics, email delivery).
- We may share information when legally required.

4. RETENTION
- Data is retained as long as your account remains active, or longer where legally appropriate.

5. YOUR RIGHTS (UK GDPR)
- Right of access, rectification, erasure, portability, restriction, and objection.
- Right to lodge a complaint with the ICO (Information Commissioner’s Office).

6. CHILDREN
- Not for users under 18 years old.

7. SECURITY
- We use industry-standard security practices but cannot guarantee absolute protection.

8. INTERNATIONAL TRANSFERS
- Data may be transferred outside the UK using appropriate safeguards.

9. CHANGES
- We may update this Privacy Policy; material updates will be communicated.`}
              </Text>
            </ScrollView>

            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowPrivacy(false)}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Rewards Policy */}
      <Modal
        visible={showRewards}
        animationType="slide"
        transparent
        onRequestClose={() => setShowRewards(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <Text style={styles.modalTitle}>Rewards Policy</Text>
              <Text
                style={[
                  styles.modalText,
                  Platform.OS === 'web'
                    ? ({ whiteSpace: 'pre-wrap' } as any)
                    : null,
                ]}
              >
{`Last updated: ${new Date().toISOString().slice(0,10)}

1. OVERVIEW
Overlooked awards cash prizes and rewards to encourage creativity.

2. ELIGIBILITY
- Must be a paying user where applicable.
- Must comply with Terms & challenge rules.

3. TYPES OF REWARDS
- Cash challenge prizes.
- Bonus awards.
- Sponsored rewards when available.

4. WINNER SELECTION
- Winners determined by voting, review panels, or both.
- Fraudulent voting may result in disqualification.

5. PAYMENT
- Cash prizes are sent electronically.
- Processing times depend on payment provider.
- Rewards are non-transferable.

6. TAXES
- You are responsible for reporting and paying any taxes owed in your jurisdiction.`}
              </Text>
            </ScrollView>

            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowRewards(false)}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

//
// --------------------- STYLES ---------------------
//
const styles = StyleSheet.create({
  container: {
    padding: 24,
    flexGrow: 1,
    justifyContent: 'center',
    backgroundColor: DARK_BG,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
    color: TEXT_IVORY,
    marginBottom: 32,
    letterSpacing: 1.2,
  },

  // DARK INPUTS
  input: {
    width: '100%',
    backgroundColor: DARK_INPUT,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    color: TEXT_IVORY,
    borderWidth: 1,
    borderColor: BORDER,

    // Web: remove the annoying blue outline
    ...(Platform.OS === 'web'
      ? ({
          outline: 'none',
          boxShadow: 'none',
        } as any)
      : {}),
  },

  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderColor: TEXT_MUTED,
    borderRadius: 6,
    backgroundColor: DARK_INPUT,
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },
  checkboxText: {
    flex: 1,
    color: TEXT_IVORY,
    fontSize: 14,
    lineHeight: 20,
  },

  link: {
    color: GOLD,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },

  button: {
    backgroundColor: GOLD,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 20,
  },
  buttonText: {
    color: '#000',
    fontWeight: '900',
    fontSize: 16,
  },
  signInLink: {
    textAlign: 'center',
    fontSize: 14,
    color: TEXT_IVORY,
  },

  // Banner
  banner: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  bannerInfo: {
    backgroundColor: '#202020',
    borderWidth: 1,
    borderColor: BORDER,
  },
  bannerSuccess: {
    backgroundColor: '#112515',
    borderWidth: 1,
    borderColor: '#1d3f22',
  },
  bannerText: {
    color: TEXT_IVORY,
    fontSize: 14,
    marginBottom: 6,
  },
  bannerAction: {
    alignSelf: 'flex-start',
    backgroundColor: GOLD,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  bannerActionText: {
    color: '#000',
    fontWeight: '900',
  },

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: DARK_CARD,
    borderRadius: 12,
    padding: 20,
    maxHeight: '80%',
    borderWidth: 1,
    borderColor: BORDER,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: TEXT_IVORY,
    marginBottom: 12,
  },
  modalText: {
    fontSize: 14,
    lineHeight: 20,
    color: TEXT_MUTED,
  },
  closeButton: {
    marginTop: 20,
    backgroundColor: GOLD,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#000',
    fontWeight: '900',
    fontSize: 16,
  },
});
