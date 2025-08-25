import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { Session } from '@supabase/supabase-js';
import { MonthlyChallenge } from '../types';
import COLORS from '../theme/colors';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import { WebView } from 'react-native-webview';

dayjs.extend(duration);

function extractYouTubeId(url: string): string | null {
  const regex =
    /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|embed)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

// Same source of truth as Featured: ensure/create challenge, then read latest.
async function fetchCurrentChallenge() {
  await supabase.rpc('insert_monthly_challenge_if_not_exists');
  const { data, error } = await supabase
    .from('monthly_challenges')
    .select('*')
    .order('month_start', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    console.warn('Failed to fetch current challenge:', error.message);
  }
  return data as MonthlyChallenge | null;
}

export default function ChallengeScreen() {
  const navigation = useNavigation();
  const [challenge, setChallenge] = useState<MonthlyChallenge | null>(null);
  const [countdown, setCountdown] = useState('');
  const [title, setTitle] = useState('');
  const [word, setWord] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [youtubeId, setYoutubeId] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      const c = await fetchCurrentChallenge();
      setChallenge(c || null);

      const { data } = await supabase.auth.getSession();
      setSession(data.session);
    };
    init();
  }, []);

  useEffect(() => {
    if (!challenge) return;

    const updateCountdown = () => {
      const end = dayjs(challenge.month_end);
      const now = dayjs();
      const diff = end.diff(now);

      if (diff <= 0) {
        setCountdown('This challenge has ended.');
      } else {
        const dur = dayjs.duration(diff);
        setCountdown(`${dur.days()}d ${dur.hours()}h ${dur.minutes()}m`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 60000);
    return () => clearInterval(interval);
  }, [challenge]);

  useEffect(() => {
    setYoutubeId(extractYouTubeId(youtubeUrl));
  }, [youtubeUrl]);

  const handleSubmit = async () => {
    if (!session) {
      Alert.alert('You must be logged in to submit a film.');
      return;
    }
    if (!title || !word || !youtubeUrl) {
      Alert.alert('Please complete all fields.');
      return;
    }

    if (!youtubeId) {
      Alert.alert('Invalid YouTube link', 'Please paste a valid YouTube URL (public or unlisted).');
      return;
    }

    setLoading(true);

    const { data: duplicates, error: checkError } = await supabase
      .from('submissions')
      .select('id')
      .eq('youtube_url', youtubeUrl)
      .limit(1);

    if (checkError) {
      setLoading(false);
      Alert.alert('Submission error', checkError.message);
      return;
    }

    if (duplicates && duplicates.length > 0) {
      setLoading(false);
      Alert.alert('Duplicate Submission', 'This film has already been submitted.');
      return;
    }

    const { error } = await supabase.from('submissions').insert({
      user_id: session.user.id,
      title,
      word,
      youtube_url: youtubeUrl,
    });

    setLoading(false);

    if (error) {
      Alert.alert('Submission failed', error.message);
    } else {
      Alert.alert(
        'Film submitted!',
        'Nice! Reminder: your YouTube video should include “Overlooked Film Challenge” in the title and #overlookedfilmchallenge in the description. Public or unlisted links are both fine.'
      );
      setTitle('');
      setWord('');
      setYoutubeUrl('');
      setYoutubeId(null);
    }
  };

  if (!challenge) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading this month’s challenge...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <View style={styles.inner}>
        <Text style={styles.headerText}>
          {dayjs(challenge.month_start).format('MMMM')} Film Challenge
        </Text>
        <Text style={styles.descriptionText}>
          Theme: <Text style={styles.themeWord}>"{challenge.theme_word}"</Text>
        </Text>
        <Text style={styles.countdown}>Time left: {countdown}</Text>

        {/* Info card with the (non-blocking) requirements for the YouTube video */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Before you submit</Text>
          <Text style={styles.infoItem}>
            • Put <Text style={styles.bold}>“Overlooked Film Challenge”</Text> in your <Text style={styles.bold}>YouTube video title</Text>.
          </Text>
          <Text style={styles.infoItem}>
            • Add <Text style={styles.mono}>#overlookedfilmchallenge</Text> in the <Text style={styles.bold}>YouTube description</Text>.
          </Text>
          <Text style={styles.infoItem}>
            • You can submit <Text style={styles.bold}>public or unlisted</Text> YouTube links (private links won’t play).
          </Text>
        </View>

        <Text style={styles.instructions}>
          Create a film of any length inspired by the theme{' '}
          <Text style={styles.themeWord}>"{challenge.theme_word}"</Text>. Upload your film to YouTube (public or unlisted)
          and submit it below!
        </Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Film Title"
            placeholderTextColor={COLORS.textSecondary}
            value={title}
            onChangeText={setTitle}
          />
          <TextInput
            style={styles.input}
            placeholder="One Word to Describe Your Film"
            placeholderTextColor={COLORS.textSecondary}
            value={word}
            onChangeText={setWord}
          />
          <TextInput
            style={styles.input}
            placeholder="YouTube URL (public or unlisted)"
            placeholderTextColor={COLORS.textSecondary}
            value={youtubeUrl}
            onChangeText={setYoutubeUrl}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.helperText}>
            Private links won’t work. Unlisted is perfect if you don’t want it publicly on your channel.
          </Text>

          {youtubeId && (
            <View style={styles.previewContainer}>
              {Platform.OS === 'web' ? (
                <iframe
                  src={`https://www.youtube.com/embed/${youtubeId}`}
                  width="100%"
                  height="200"
                  style={{ borderRadius: 12 }}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <View style={{ height: 200, borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
                  <WebView
                    source={{ uri: `https://www.youtube.com/embed/${youtubeId}` }}
                    style={{ flex: 1 }}
                    javaScriptEnabled
                    allowsFullscreenVideo
                  />
                </View>
              )}
            </View>
          )}

          <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={loading}>
            <Text style={styles.buttonText}>
              {loading ? 'Submitting...' : 'Submit Film'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  inner: {
    maxWidth: 500,
    width: '100%',
    alignItems: 'center',
  },
  headerText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginBottom: 8,
    textAlign: 'center',
  },
  descriptionText: {
    fontSize: 18,
    color: COLORS.textSecondary,
    marginBottom: 4,
    textAlign: 'center',
  },
  themeWord: {
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  countdown: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginBottom: 12,
    textAlign: 'center',
  },
  instructions: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginBottom: 20,
    textAlign: 'center',
  },
  infoCard: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.outline,
    borderRadius: 16,
    padding: 16,
    width: '100%',
    marginBottom: 16,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  infoItem: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 6,
    lineHeight: 20,
  },
  mono: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', web: 'monospace' }),
    color: COLORS.textPrimary,
    fontWeight: '600',
  },
  bold: {
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  form: {
    backgroundColor: COLORS.card,
    padding: 20,
    borderRadius: 16,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    width: '100%',
  },
  input: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: COLORS.outline,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  helperText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: COLORS.textOnPrimary,
    fontWeight: 'bold',
    fontSize: 16,
  },
  centered: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: COLORS.textSecondary,
  },
  previewContainer: {
    width: '100%',
    marginBottom: 12,
  },
});
