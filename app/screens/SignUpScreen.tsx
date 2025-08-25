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

export default function SignUpScreen() {
  const navigation = useNavigation<any>();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [agreed, setAgreed] = useState(false); // must accept TOS+Privacy
  const [agreedPrograms, setAgreedPrograms] = useState(false); // must accept Rewards & Referral terms
  const [isSixteen, setIsSixteen] = useState(false); // must confirm 16+
  const [loading, setLoading] = useState(false);

  const [showTos, setShowTos] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showRewards, setShowRewards] = useState(false);
  const [showReferral, setShowReferral] = useState(false);

  // NEW: inline confirmation banner
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [checkingLink, setCheckingLink] = useState(true);

  // (1) Build a redirect URL for Supabase email confirmation
  const emailRedirectTo = useMemo(() => {
    // On native, use the app scheme. Ensure it’s configured in app.json/app.config (e.g., "scheme": "overlooked")
    if (Platform.OS !== 'web') {
      // This path can be anything – we’ll listen for it.
      return Linking.createURL('/auth-callback');
    }
    // On web, send users back to same origin. You can change the path if you prefer.
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/auth-callback`;
  }, []);

  // Helper: read user and set confirmed state
  const refreshConfirmedFromUser = async () => {
    const { data } = await supabase.auth.getUser();
    const confirmed =
      !!data?.user?.email_confirmed_at ||
      data?.user?.user_metadata?.email_confirmed === true;
    if (confirmed) setEmailConfirmed(true);
    return confirmed;
  };

  // Parse tokens from a deep link / URL (works for hash or query)
  const parseTokensFromUrl = (url: string) => {
    // Supabase can place tokens in the fragment (#) on web, or query (?) on native
    const parsed = Linking.parse(url);
    // Try hash params first if present
    let params: Record<string, any> = {};
    if (typeof window !== 'undefined' && Platform.OS === 'web') {
      // On web, tokens usually come in the hash
      const hash = window.location.hash?.replace(/^#/, '') ?? '';
      const searchParams = new URLSearchParams(hash);
      searchParams.forEach((v, k) => (params[k] = v));
    }
    // Merge parsed query params (native often uses query)
    if (parsed?.queryParams) {
      params = { ...params, ...parsed.queryParams };
    }
    return {
      access_token: params['access_token'] as string | undefined,
      refresh_token: params['refresh_token'] as string | undefined,
      token_type: params['token_type'] as string | undefined,
      type: params['type'] as string | undefined, // e.g., 'signup'
      error_description: params['error_description'] as string | undefined,
    };
  };

  // Try to hydrate a session from tokens in URL
  const maybeHandleAuthDeepLink = async (url?: string | null) => {
    if (!url) return false;
    const { access_token, refresh_token, type, error_description } =
      parseTokensFromUrl(url);

    if (error_description) {
      // If Supabase sends back an error (e.g. link expired)
      Alert.alert('Email Confirmation', decodeURIComponent(error_description));
      return false;
    }

    if (access_token && refresh_token) {
      try {
        const { data, error } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });
        if (error) {
          // Not fatal; user can still sign in manually
          return false;
        }
        // If this was a signup confirmation, mark confirmed
        if (type === 'signup' || data?.session?.user?.email_confirmed_at) {
          setEmailConfirmed(true);
        } else {
          // Fallback check
          await refreshConfirmedFromUser();
        }
        // Clean up the URL on web so tokens aren’t visible after handling
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          const clean = window.location.origin + window.location.pathname;
          window.history.replaceState({}, document.title, clean);
        }
        return true;
      } catch {
        return false;
      }
    }
    return false;
  };

  // (2) Handle app launch via link (native) and current URL (web)
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const init = async () => {
      try {
        // First pass: handle initial URL (native) or current hash (web)
        if (Platform.OS !== 'web') {
          const initial = await Linking.getInitialURL();
          await maybeHandleAuthDeepLink(initial);
        } else if (typeof window !== 'undefined') {
          // On web, just try the current URL (which may have a hash)
          await maybeHandleAuthDeepLink(window.location.href);
        }

        // Subscribe to future links while this screen is open
        const sub = Linking.addEventListener('url', async (event) => {
          await maybeHandleAuthDeepLink(event.url);
        });
        unsubscribe = () => sub.remove();

        // Fallback: if we already have a session and confirmed email, show banner
        await refreshConfirmedFromUser();
      } finally {
        setCheckingLink(false);
      }
    };

    init();

    return () => {
      if (unsubscribe) unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (3) Also listen to Supabase auth events that may fire after link handling
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!isSixteen) {
      Alert.alert(
        'Age Confirmation',
        'You must confirm that you are at least 16 years old.'
      );
      return;
    }
    if (!agreed) {
      Alert.alert(
        'Agreement Required',
        'Please agree to the Terms of Service and Privacy Policy.'
      );
      return;
    }
    if (!agreedPrograms) {
      Alert.alert(
        'Agreement Required',
        'Please agree to the Rewards & Referral Program terms.'
      );
      return;
    }

    setLoading(true);

    // IMPORTANT: pass emailRedirectTo so the confirm link returns to this app.
    // On mobile: your app should have a matching scheme set up in app.json/app.config (e.g., "scheme": "overlooked").
    const { data, error } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
      options: {
        emailRedirectTo,
      },
    });

    setLoading(false);

    if (error) {
      Alert.alert('Signup Error', error.message);
      return;
    }

    try {
      // Save quick flags on users (note: session may not exist until email is confirmed)
      if (data?.user) {
        await supabase
          .from('users')
          .update({
            legal_accepted: true,
            legal_accepted_at: new Date().toISOString(),
          })
          .eq('id', data.user.id);
      }
    } catch {
      // non-fatal; continue
    }

    // Go to your existing email verification screen
    navigation.navigate('CheckEmail', { email: trimmedEmail });
  };

  const canSubmit =
    !!email &&
    !!password &&
    !!confirm &&
    password.length >= 6 &&
    password === confirm &&
    isSixteen &&
    agreed &&
    agreedPrograms &&
    !loading;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.container}>
          <Text style={styles.title}>Create Account</Text>

          {/* Email confirmed banner */}
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
                  : 'Email confirmed ✅ You can now sign in.'}
              </Text>

              {/* Helpful action to jump to Sign In once confirmed */}
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

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#999"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />

          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#999"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <TextInput
            style={styles.input}
            placeholder="Confirm Password"
            placeholderTextColor="#999"
            secureTextEntry
            value={confirm}
            onChangeText={setConfirm}
          />

          {/* Age confirmation checkbox */}
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setIsSixteen(!isSixteen)}
            activeOpacity={0.8}
          >
            <View style={[styles.checkbox, isSixteen && styles.checkboxChecked]} />
            <Text style={styles.checkboxText}>
              I confirm that I am at least 16 years old.
            </Text>
          </TouchableOpacity>

          {/* Legal: required checkbox with inline links to modals */}
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setAgreed(!agreed)}
            activeOpacity={0.8}
          >
            <View style={[styles.checkbox, agreed && styles.checkboxChecked]} />
            <Text style={styles.checkboxText}>
              I agree to the{' '}
              <Text style={styles.link} onPress={() => setShowTos(true)}>Terms of Service</Text>
              {' '}and{' '}
              <Text style={styles.link} onPress={() => setShowPrivacy(true)}>Privacy Policy</Text>.
            </Text>
          </TouchableOpacity>

          {/* Rewards & Referral: required checkbox with links to modals */}
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setAgreedPrograms(!agreedPrograms)}
            activeOpacity={0.8}
          >
            <View style={[styles.checkbox, agreedPrograms && styles.checkboxChecked]} />
            <Text style={styles.checkboxText}>
              I agree to the{' '}
              <Text style={styles.link} onPress={() => setShowRewards(true)}>Rewards Policy</Text>
              {' '}and the{' '}
              <Text style={styles.link} onPress={() => setShowReferral(true)}>Referral Program (20%)</Text>.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, !canSubmit && { backgroundColor: '#C9C9C9' }]}
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
              <Text style={{ color: COLORS.primary, fontWeight: '600' }}>Sign In</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* TERMS OF SERVICE MODAL */}
      <Modal visible={showTos} animationType="slide" transparent onRequestClose={() => setShowTos(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <Text style={styles.modalTitle}>Terms of Service (Overlooked)</Text>
              <Text style={styles.modalText}>
{`Last updated: ${new Date().toISOString().slice(0,10)}

1) Eligibility & Accounts
• You must be at least 16 years old (or have verifiable parental consent where required).
• You are responsible for keeping your login credentials secure and for all activity on your account.

2) Acceptable Use & Safety
• Do not post or organize illegal activity, harassment, hate, exploitation, or non-consensual content.
• No doxxing, impersonation, spam, scams, malware, scraping abuse, or attempts to circumvent security.
• Be cautious meeting people offline; arrange public spaces and share plans with a trusted contact.

3) User Content & License
• You retain ownership of content you create and upload (videos, images, text, audio, etc.).
• By submitting content to Overlooked, you grant us a worldwide, non-exclusive, royalty-free license to host, cache, display, and transmit your content within our products/services solely to operate and promote Overlooked (including app store listings and social posts that showcase the platform). You can delete your content at any time; residual server caches may persist for a short period.

4) Intellectual Property & Takedowns
• Respect third-party copyrights and trademarks. Only upload content you own or have rights to use.
• We respond to proper takedown notices and may remove content or suspend accounts for repeat infringement.

5) Jobs, Collaborations & Payments
• Overlooked is a platform; we are not a party to user-to-user contracts. We do not employ, pay, or insure users.
• Users are solely responsible for verifying counterparties, negotiating terms, handling taxes, and using secure payment methods.
• We are not liable for disputes, unpaid work, or losses from user interactions (online or offline).

6) Referral Program (20%)
• We may offer a referral program that pays the referrer **20%** of the referred user's qualifying Overlooked subscription payments, net of taxes, refunds, chargebacks, and store fees, for a limited reward term (e.g., 12 months) per referred user.
• No self-referrals or circular/refund gaming; fraud, trademark bidding, spam, or misleading promotions are prohibited.
• We may review, audit, adjust, or terminate referral rewards for abuse or policy violations at our discretion.
• Payouts are made via the methods we support (e.g., Stripe Connect) subject to minimums, verification, KYC/AML checks, and local law.
• Program details can change or end with reasonable notice; unpaid, valid earnings accrued prior to the change will be honored.

7) Subscriptions, Fees & Refunds
• Prices, features, and billing intervals may change; we’ll provide notice where required by law.
• Refunds are governed by our refund policy and applicable consumer laws. Chargebacks may result in suspension.

8) Third-Party Services
• We may link to or integrate third-party services (e.g., payment processors, video hosting). Those services are governed by their own terms and privacy practices.

9) Disclaimers & Limitation of Liability
• OVERLOOKED IS PROVIDED “AS IS” WITHOUT WARRANTIES. TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE ARE NOT LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR EXEMPLARY DAMAGES, OR ANY LOSS OF PROFITS, DATA, GOODWILL, OR REPUTATION, ARISING FROM YOUR USE OF THE SERVICE OR USER INTERACTIONS.
• Some jurisdictions do not allow certain limitations; if so, those limits apply to the maximum extent permitted.

10) Termination & Moderation
• We may remove content or suspend/terminate accounts that violate these Terms or applicable laws, to keep the community safe.

11) Changes to These Terms
• We may update these Terms from time to time. If you continue using Overlooked after changes take effect, you accept the updated Terms.

12) Contact
• For questions or notices (including IP complaints), contact us via the details listed in the app or website.`}
              </Text>
            </ScrollView>

            <TouchableOpacity style={styles.closeButton} onPress={() => setShowTos(false)}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* PRIVACY POLICY MODAL */}
      <Modal visible={showPrivacy} animationType="slide" transparent onRequestClose={() => setShowPrivacy(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <Text style={styles.modalTitle}>Privacy Policy (Overlooked)</Text>
              <Text style={styles.modalText}>
{`Last updated: ${new Date().toISOString().slice(0,10)}

1) What We Collect
• Account data (email, name if provided), profile details (roles, city/country), messages, submissions, votes, job posts, and usage logs.
• Device/technical data (app version, device type, OS), and approximate location if you choose a city.
• Files you upload (avatars, media) and links you share (e.g., YouTube URLs).
• Cookies/SDKs for essential functions, performance, and analytics.

2) Why We Use It
• To create and secure your account; provide chat, jobs, submissions, and community features.
• To operate, maintain, analyze, and improve Overlooked; prevent abuse; enforce policies.
• To send transactional emails (e.g., verify email, security alerts). Marketing emails only if you opt-in.

3) Legal Bases (where applicable, e.g., EU/UK)
• Performance of a contract (providing the service), legitimate interests (security, improvement), consent (marketing), and legal obligations (tax/audit).

4) Sharing
• Service providers/processors (e.g., hosting, analytics, payments, email). They only process data under our instructions.
• Other users, when you deliberately share content or messages (e.g., sending a message, posting a job).
• Law enforcement or legal requests when required by applicable law.

5) International Transfers
• We may process/store data in other countries. We use appropriate safeguards (e.g., SCCs) where required.

6) Retention
• We keep data for as long as necessary to provide the service and for legitimate business/legal purposes. You may request deletion of your account; some logs or backups may persist for a limited time.

7) Your Rights
• Where applicable: access, rectification, deletion, portability, restriction, objection, and withdrawal of consent (for marketing) without affecting prior processing.
• You can update most profile data in the app. For other requests, contact us via the details in the app/website.

8) Children
• Overlooked is not directed to children under 16. If you believe a child has used the service without appropriate consent, contact us to remove the account.

9) Security
• We use administrative, technical, and organizational measures appropriate to the risk; however, no system is 100% secure.

10) Third-Party Links
• External links and embedded content (e.g., YouTube) are governed by third-party privacy practices.

11) Cookies/SDKs
• We use necessary cookies/SDKs for login and core functionality, and analytics to improve the service. See the in-app settings or documentation for choices.

12) Changes
• We may update this Policy. Continued use after changes means you acknowledge the updated Policy.`}
              </Text>
            </ScrollView>

            <TouchableOpacity style={styles.closeButton} onPress={() => setShowPrivacy(false)}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* REWARDS POLICY MODAL */}
      <Modal visible={showRewards} animationType="slide" transparent onRequestClose={() => setShowRewards(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <Text style={styles.modalTitle}>Rewards Policy</Text>
              <Text style={styles.modalText}>
{`Last updated: ${new Date().toISOString().slice(0,10)}

• Challenge winners may receive monetary or non-monetary rewards. Rewards are not guaranteed and may vary by campaign.
• Eligibility, judging criteria, timelines, and payout methods are defined per challenge and may change with notice.
• We may require identity and tax verification (e.g., KYC/AML) before payout. Payment method availability varies by region.
• Users are responsible for any taxes or reporting associated with rewards.
• Rewards may be void where prohibited by law or if we detect manipulation, fraud, or policy violations.
• Our determinations regarding eligibility and rewards are final.`}
              </Text>
            </ScrollView>
            <TouchableOpacity style={styles.closeButton} onPress={() => setShowRewards(false)}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* REFERRAL PROGRAM MODAL */}
      <Modal visible={showReferral} animationType="slide" transparent onRequestClose={() => setShowReferral(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <Text style={styles.modalTitle}>Referral Program (20%)</Text>
              <Text style={styles.modalText}>
{`Last updated: ${new Date().toISOString().slice(0,10)}

• Earn 20% of qualifying subscription payments made by users you directly refer, net of taxes, refunds, chargebacks, and store/processor fees.
• Reward duration per referred user may be limited (e.g., first 12 months). Program specifics can change with notice.
• Strictly prohibited: self-referrals, fake accounts, coupon/brand bidding, spam, misleading claims, or any fraud.
• Payouts require reaching minimum thresholds and may require identity/tax verification; availability depends on region.
• We may audit, pause, adjust, or terminate rewards for suspicious activity or policy violations. Our decisions are final.
• Program may be modified or ended at any time; valid, earned amounts prior to change will be honored.`}
              </Text>
            </ScrollView>
            <TouchableOpacity style={styles.closeButton} onPress={() => setShowReferral(false)}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    flexGrow: 1,
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 30,
    textAlign: 'center',
    color: COLORS.textPrimary,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    fontSize: 16,
    backgroundColor: '#fff',
    color: COLORS.textPrimary,
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
    borderColor: '#999',
    borderRadius: 6,
    backgroundColor: '#fff',
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  checkboxText: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  link: {
    color: COLORS.primary,
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
  button: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  signInLink: {
    textAlign: 'center',
    fontSize: 14,
    color: COLORS.textPrimary,
  },

  // NEW: confirmation banner
  banner: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  bannerInfo: {
    backgroundColor: '#EFEFEF',
    borderWidth: 1,
    borderColor: '#D8D8D8',
  },
  bannerSuccess: {
    backgroundColor: '#E9F9EF',
    borderWidth: 1,
    borderColor: '#BEE7C8',
  },
  bannerText: {
    color: COLORS.textPrimary,
    fontSize: 14,
    marginBottom: 8,
  },
  bannerAction: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
  },
  bannerActionText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    maxHeight: '80%',
    padding: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 12,
    color: COLORS.textPrimary,
  },
  modalText: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textPrimary,
  },
  closeButton: {
    backgroundColor: COLORS.primary,
    padding: 12,
    borderRadius: 10,
    marginTop: 14,
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
});
