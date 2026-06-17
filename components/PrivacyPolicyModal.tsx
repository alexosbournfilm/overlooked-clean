import React from 'react';
import {
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SmoothModal from './SmoothModal';
import { useAppLanguage } from '../app/context/LanguageContext';
import { useAppTheme } from '../app/context/ThemeContext';
import { translateTrustedText } from '../app/i18n/translations';

type PrivacyPolicyModalProps = {
  visible: boolean;
  onClose: () => void;
};

type PolicySection = {
  title: string;
  body?: string;
  bullets?: string[];
};

const POLICY_UPDATED_AT = '17 June 2026';
const SUPPORT_EMAIL = 'overlookedsupport@gmail.com';

const POLICY_INTRO =
  'This Privacy Policy explains how Overlooked LTD ("Overlooked", "we", "us", "our") collects, uses, shares, and protects personal data when you use Overlooked, including the website, app, creator profiles, film uploads, challenges, jobs, messages, subscriptions, and related services.';

const POLICY_SECTIONS: PolicySection[] = [
  {
    title: '1. Data We Collect',
    bullets: [
      'Account and profile data: name, email address, creative roles, city, country, profile image, profile details, portfolio links, preferences, and account settings.',
      'Creator content: films, showreels, videos, thumbnails, audio, images, captions, comments, votes, challenge submissions, job posts, job applications, messages, reports, and other content you choose to upload or share.',
      'Subscription and payment data: plan status, subscription identifiers, checkout/session IDs, billing provider identifiers, renewal status, and entitlement information. Card details are handled by payment providers such as Stripe, Apple, Google, or RevenueCat and are not stored by Overlooked.',
      'Technical and usage data: IP address, browser or device type, operating system, app version, pages viewed, actions taken, logs, cookies or local storage, crash information, and push notification tokens where enabled.',
    ],
  },
  {
    title: '2. How We Use Data',
    bullets: [
      'To create accounts, authenticate users, maintain profiles, host creator content, and operate core features such as Featured, challenges, showreels, jobs, chats, portfolios, and Pro memberships.',
      'To process subscriptions, verify Pro access, manage renewals or cancellations, and prevent payment or account fraud.',
      'To personalise discovery, improve recommendations, support leaderboards and challenge voting, and make the platform more relevant to creators.',
      'To provide support, send service messages, deliver notifications you enable, communicate account or policy updates, and respond to legal or safety requests.',
      'To moderate content, investigate reports, enforce our Terms, protect users, and reduce spam, abuse, impersonation, fraud, and harmful behaviour.',
      'To analyse performance, fix bugs, improve product quality, and understand how Overlooked is used.',
    ],
  },
  {
    title: '3. Sharing and Processors',
    bullets: [
      'Public profile information and public creator content may be visible to other users and visitors, depending on the feature and your settings.',
      'Messages are visible to the conversation participants. Job applications and attached profile information may be visible to the relevant job poster or recipient.',
      'We use trusted service providers to run the platform, including hosting, database, storage, authentication, payment, subscription, analytics, email, push notification, and support providers. These may include Supabase, Stripe, RevenueCat, Apple, Google, Expo, Vercel, and similar operational providers where used.',
      'We may share information if required by law, to protect users or the platform, to enforce our Terms, or as part of a business transfer such as a merger, acquisition, or sale of assets.',
      'We do not sell your personal data.',
    ],
  },
  {
    title: '4. Retention',
    body:
      'We keep personal data for as long as needed to provide Overlooked, maintain your account, comply with legal obligations, resolve disputes, enforce agreements, and protect platform safety. If you delete your account or request deletion, we will delete or anonymise personal data where appropriate, unless we need to keep certain information for legal, security, fraud prevention, moderation, or accounting reasons.',
  },
  {
    title: '5. Your Rights and Choices',
    bullets: [
      'You can update some account and profile information inside Overlooked.',
      'You can contact us to request access, correction, deletion, restriction, objection, or portability of your personal data, subject to applicable law.',
      'If you are in the UK or EEA, you may have rights under UK GDPR or EU GDPR and may complain to your local data protection authority. In the UK, this is the Information Commissioner\'s Office (ICO).',
      'You can manage push notifications through your device settings and can manage subscriptions through the relevant payment provider or membership screen.',
    ],
  },
  {
    title: '6. International Transfers',
    body:
      'Overlooked and its providers may process data in countries outside your own. Where required, we rely on appropriate safeguards such as contractual protections, provider security commitments, and lawful transfer mechanisms.',
  },
  {
    title: '7. Security',
    body:
      'We use reasonable technical and organisational measures to protect personal data, including provider security controls, authentication, access restrictions, and encrypted transport where available. No online service can guarantee absolute security, so you should use a strong password and keep your account credentials private.',
  },
  {
    title: '8. Children and Safety',
    body:
      'Overlooked takes safety seriously. We may review and act on content, profiles, messages, jobs, submissions, or reports where necessary to protect users, enforce our policies, or comply with law. Child safety concerns or urgent safeguarding issues should be reported immediately.',
  },
  {
    title: '9. Changes to This Policy',
    body:
      'We may update this Privacy Policy from time to time. If changes are material, we will take reasonable steps to notify users in the app, by email, or by another appropriate method.',
  },
  {
    title: '10. Contact',
    body: `For privacy questions, rights requests, or safety concerns, contact ${SUPPORT_EMAIL}.`,
  },
];

export default function PrivacyPolicyModal({
  visible,
  onClose,
}: PrivacyPolicyModalProps) {
  const { colors, isLight } = useAppTheme();
  const { language } = useAppLanguage();
  const { width, height } = useWindowDimensions();

  const isCompact = width < 640;
  const maxHeight = Math.min(height - 48, isCompact ? height - 28 : 760);

  const t = (value: string) => translateTrustedText(value, language);

  const openSupportEmail = () => {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {});
  };

  return (
    <SmoothModal
      visible={visible}
      transparent
      onRequestClose={onClose}
      enterOffset={40}
    >
      <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
        <View
          style={[
            styles.card,
            {
              maxHeight,
              backgroundColor: isLight ? '#FFFCF7' : colors.card,
              borderColor: isLight ? '#E6D9C4' : colors.border,
              shadowColor: colors.shadow,
            },
            isCompact && styles.cardCompact,
          ]}
        >
          <View style={styles.headerRow}>
            <View style={styles.headerCopy}>
              <View
                style={[
                  styles.badge,
                  {
                    backgroundColor: isLight
                      ? 'rgba(201,164,92,0.14)'
                      : 'rgba(198,166,100,0.14)',
                    borderColor: isLight ? '#E7D5A8' : 'rgba(198,166,100,0.26)',
                  },
                ]}
              >
                <Text style={[styles.badgeText, { color: colors.accent }]}>
                  {t('Overlooked Legal')}
                </Text>
              </View>
              <Text style={[styles.title, { color: colors.textPrimary }]}>
                {t('Privacy Policy')}
              </Text>
              <Text style={[styles.updated, { color: colors.textMuted }]}>
                {t(`Last updated: ${POLICY_UPDATED_AT}`)}
              </Text>
            </View>

            <TouchableOpacity
              onPress={onClose}
              style={[
                styles.iconButton,
                {
                  backgroundColor: isLight ? '#F5ECDD' : colors.cardAlt,
                  borderColor: colors.border,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('Close Privacy Policy')}
              activeOpacity={0.78}
            >
              <Ionicons name="close" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator
          >
            <Text
              style={[
                styles.intro,
                { color: colors.textSecondary },
                Platform.OS === 'web' ? ({ whiteSpace: 'pre-wrap' } as any) : null,
              ]}
            >
              {t(POLICY_INTRO)}
            </Text>

            {POLICY_SECTIONS.map((section) => (
              <View key={section.title} style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
                  {t(section.title)}
                </Text>

                {section.body ? (
                  <Text
                    style={[
                      styles.bodyText,
                      { color: colors.textSecondary },
                      Platform.OS === 'web' ? ({ whiteSpace: 'pre-wrap' } as any) : null,
                    ]}
                  >
                    {t(section.body)}
                  </Text>
                ) : null}

                {section.bullets?.map((bullet) => (
                  <View key={bullet} style={styles.bulletRow}>
                    <Text style={[styles.bulletMark, { color: colors.accent }]}>-</Text>
                    <Text style={[styles.bodyText, styles.bulletText, { color: colors.textSecondary }]}>
                      {t(bullet)}
                    </Text>
                  </View>
                ))}
              </View>
            ))}

            <TouchableOpacity
              onPress={openSupportEmail}
              style={[
                styles.contactBox,
                {
                  backgroundColor: isLight ? '#F8F0E3' : colors.cardAlt,
                  borderColor: colors.border,
                },
              ]}
              activeOpacity={0.84}
            >
              <Text style={[styles.contactLabel, { color: colors.textMuted }]}>
                {t('Privacy contact')}
              </Text>
              <Text style={[styles.contactEmail, { color: colors.accent }]}>
                {SUPPORT_EMAIL}
              </Text>
            </TouchableOpacity>
          </ScrollView>

          <TouchableOpacity
            onPress={onClose}
            style={[styles.closeButton, { backgroundColor: colors.primary }]}
            activeOpacity={0.86}
          >
            <Text style={[styles.closeButtonText, { color: colors.textOnPrimary }]}>
              {t('Close')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SmoothModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 760,
    borderRadius: 26,
    borderWidth: 1,
    padding: 22,
    shadowOpacity: 0.22,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 18 },
    elevation: 16,
  },
  cardCompact: {
    borderRadius: 22,
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 18,
  },
  headerCopy: {
    flex: 1,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 10,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '900',
  },
  updated: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '700',
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingBottom: 6,
  },
  intro: {
    fontSize: 14.5,
    lineHeight: 22,
    marginBottom: 18,
  },
  section: {
    marginBottom: 18,
  },
  sectionTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
    marginBottom: 8,
  },
  bodyText: {
    fontSize: 13.5,
    lineHeight: 20,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 7,
  },
  bulletMark: {
    width: 10,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '900',
  },
  bulletText: {
    flex: 1,
  },
  contactBox: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    marginTop: 2,
  },
  contactLabel: {
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  contactEmail: {
    fontSize: 15,
    fontWeight: '900',
  },
  closeButton: {
    marginTop: 18,
    minHeight: 48,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  closeButtonText: {
    fontSize: 15,
    fontWeight: '900',
  },
});
