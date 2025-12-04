import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { supabase } from "../lib/supabase";

/* --------------------------- THEME --------------------------- */

const DARK_BG = "#000000";
const CARD_BG = "#0B0B0B";
const GOLD = "#C6A664";
const TEXT = "#F5F3EF";
const SUB = "#A9A7A3";
const BORDER = "#262626";

const SYSTEM_SANS =
  Platform.select({ ios: "System", android: "Roboto", web: undefined }) ||
  undefined;

/* --------------------------- COMPONENT --------------------------- */

export default function NewPassword() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [message, setMessage] = useState("");

  /* --------------------------------------------------------
        PARSE RECOVERY URL AND HYDRATE SESSION
     -------------------------------------------------------- */
  async function processRecoveryUrl(url: string) {
    try {
      const parsed = new URL(url);
      const type = parsed.searchParams.get("type");

      if (type === "recovery") {
        await supabase.auth.exchangeCodeForSession(url);
      }

      if (url.includes("#")) {
        const hash = url.split("#")[1];
        const params = new URLSearchParams(hash);

        const access = params.get("access_token");
        const refresh = params.get("refresh_token");

        if (access && refresh && params.get("type") === "recovery") {
          await supabase.auth.setSession({
            access_token: access,
            refresh_token: refresh,
          });
        }
      }
    } catch (e) {
      console.log("URL parse error:", e);
    }
  }

  /* --------------------------------------------------------
        INITIAL LOAD — HANDLE RECOVERY
     -------------------------------------------------------- */
  useEffect(() => {
    let active = true;

    async function init() {
      const url = await Linking.getInitialURL();
      if (url) await processRecoveryUrl(url);

      await new Promise((res) => setTimeout(res, 150));

      const { data } = await supabase.auth.getSession();
      if (active) {
        setHasSession(!!data.session);
        setRestoring(false);
      }
    }

    init();

    const sub = Linking.addEventListener("url", async (e) => {
      await processRecoveryUrl(e.url);

      const { data } = await supabase.auth.getSession();
      if (active) setHasSession(!!data.session);
    });

    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  /* --------------------------------------------------------
        REDIRECT HELPERS
     -------------------------------------------------------- */

  const redirectToSignIn = () => {
    if (Platform.OS === "web") {
      window.location.replace("https://overlooked.cloud/signin");
      return;
    }

    navigation.reset({
      index: 0,
      routes: [{ name: "SignIn" }],
    });
  };

  /* --------------------------------------------------------
        HANDLE UPDATE PASSWORD
     -------------------------------------------------------- */

  const handleUpdate = async () => {
    setMessage("");

    if (!password || !confirmPassword) {
      setMessage("Please fill out both fields.");
      return;
    }

    if (password.length < 6) {
      setMessage("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      // ⭐ 1. Force-hydrate fresh session (fixes first-try issue)
      if (Platform.OS === "web") {
        const currentUrl = window.location.href;
        await supabase.auth.exchangeCodeForSession(currentUrl);
      }

      // Allow Supabase to finalize auth
      await new Promise((res) => setTimeout(res, 120));

      // ⭐ 2. Update password (now in a validated session)
      const result = await supabase.auth.updateUser({
        password: password.trim(),
      });

      if (result?.error) {
        setMessage(result.error.message);
        setLoading(false);
        return;
      }

      setMessage("Password updated! Redirecting…");

      // ⭐ 3. EXIT RECOVERY MODE — required
      await supabase.auth.signOut();

      // ⭐ 4. Final redirect (instant)
      redirectToSignIn();
      return;

    } catch (err: any) {
      console.log("Update password error:", err);
      setMessage(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  /* --------------------------------------------------------
        UI STATES
     -------------------------------------------------------- */

  if (restoring) {
    return (
      <SafeAreaView style={styles.fullCenter}>
        <ActivityIndicator size="large" color={GOLD} />
        <Text style={styles.loadingText}>Preparing reset…</Text>
      </SafeAreaView>
    );
  }

  if (!restoring && !hasSession) {
    return (
      <SafeAreaView style={styles.fullCenter}>
        <Text style={styles.invalidText}>
          Your password reset link is invalid or expired.
        </Text>

        <TouchableOpacity onPress={redirectToSignIn} style={styles.button}>
          <Text style={styles.buttonText}>BACK TO SIGN IN</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  /* --------------------------------------------------------
        MAIN UI
     -------------------------------------------------------- */

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: DARK_BG }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View
          style={[
            styles.container,
            {
              paddingTop: insets.top + 20,
              paddingBottom: insets.bottom + 20,
            },
          ]}
        >
          <TouchableOpacity onPress={redirectToSignIn} style={styles.backButton}>
            <Ionicons name="chevron-back" size={18} color={SUB} />
            <Text style={styles.backLabel}>Back</Text>
          </TouchableOpacity>

          <View style={styles.card}>
            <Text style={styles.title}>Set a New Password</Text>
            <Text style={styles.subtitle}>Enter and confirm your password.</Text>

            <View style={styles.inputWrap}>
              <Ionicons name="lock-closed" size={16} color={SUB} />
              <TextInput
                style={styles.input}
                placeholder="New password"
                placeholderTextColor={SUB}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
            </View>

            <View style={styles.inputWrap}>
              <Ionicons name="shield-checkmark" size={16} color={SUB} />
              <TextInput
                style={styles.input}
                placeholder="Confirm password"
                placeholderTextColor={SUB}
                secureTextEntry
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
            </View>

            <TouchableOpacity
              onPress={handleUpdate}
              disabled={loading}
              style={[styles.button, loading && { opacity: 0.6 }]}
            >
              {loading ? (
                <ActivityIndicator color={DARK_BG} />
              ) : (
                <Text style={styles.buttonText}>UPDATE PASSWORD</Text>
              )}
            </TouchableOpacity>

            {message ? <Text style={styles.message}>{message}</Text> : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* --------------------------- STYLES --------------------------- */

const styles = StyleSheet.create({
  fullCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: DARK_BG,
  },
  loadingText: {
    color: SUB,
    marginTop: 12,
    fontFamily: SYSTEM_SANS,
  },
  invalidText: {
    color: TEXT,
    fontSize: 18,
    textAlign: "center",
    marginBottom: 20,
    paddingHorizontal: 30,
    fontFamily: SYSTEM_SANS,
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  backLabel: {
    color: SUB,
    fontFamily: SYSTEM_SANS,
    marginLeft: 6,
    fontSize: 15,
  },
  card: {
    backgroundColor: CARD_BG,
    padding: 26,
    borderRadius: 18,
    borderColor: BORDER,
    borderWidth: 1,
    width: "100%",
    alignSelf: "center",
    maxWidth: 420,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 30,
  },
  title: {
    color: TEXT,
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 6,
    textAlign: "center",
    fontFamily: SYSTEM_SANS,
  },
  subtitle: {
    color: SUB,
    textAlign: "center",
    marginBottom: 20,
    fontSize: 14,
    fontFamily: SYSTEM_SANS,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderColor: BORDER,
    borderWidth: 1,
    backgroundColor: "#0A0A0A",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  input: {
    flex: 1,
    color: TEXT,
    marginLeft: 10,
    fontSize: 15,
    fontFamily: SYSTEM_SANS,
  },
  button: {
    backgroundColor: GOLD,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 6,
  },
  buttonText: {
    color: DARK_BG,
    fontWeight: "900",
    fontSize: 15,
    fontFamily: SYSTEM_SANS,
  },
  message: {
    marginTop: 14,
    textAlign: "center",
    color: SUB,
    fontSize: 14,
    fontFamily: SYSTEM_SANS,
  },
});
