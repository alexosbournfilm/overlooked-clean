// app/screens/NewPassword.tsx
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
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
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

/* --------------------------- WAIT FOR SAFARI to DELIVER URL --------------------------- */
const waitForUrl = async () => {
  for (let i = 0; i < 25; i++) {
    const url = await Linking.getInitialURL();
    if (url) return url;
    await new Promise((res) => setTimeout(res, 120));
  }
  return null;
};

/* ========================================================================
    NEW PASSWORD SCREEN — FINAL FIXED VERSION
======================================================================== */

export default function NewPassword() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [message, setMessage] = useState("");

  /* ------------------------------------------------------------------
      1. PROCESS THE RECOVERY URL (supports hash + query)
  ------------------------------------------------------------------ */
  async function processRecoveryUrl(url: string) {
    try {
      // case 1: standard Supabase ?type=recovery URLs
      if (url.includes("type=recovery")) {
        await supabase.auth.exchangeCodeForSession(url);
      }

      // case 2: hash-based URLs (#access_token=...)
      if (url.includes("#")) {
        const fragment = url.split("#")[1];
        const params = new URLSearchParams(fragment);

        if (params.get("type") === "recovery") {
          const access = params.get("access_token");
          const refresh = params.get("refresh_token");

          if (access && refresh) {
            await supabase.auth.setSession({
              access_token: access,
              refresh_token: refresh,
            });
          }
        }
      }
    } catch (err) {
      console.warn("Error parsing recovery URL:", err);
    }
  }

  /* ------------------------------------------------------------------
      2. INITIAL LOAD — handle full deep-link lifecycle
  ------------------------------------------------------------------ */
  useEffect(() => {
    let active = true;

    async function init() {
      // ⭐ wait for Safari to properly give us the URL
      const url = await waitForUrl();
      if (url) await processRecoveryUrl(url);

      // small wait to ensure Supabase hydrates session
      await new Promise((res) => setTimeout(res, 150));

      const { data } = await supabase.auth.getSession();

      if (active) {
        setHasSession(!!data.session);
        setRestoring(false);
      }
    }

    init();

    // Listen for in-app deep link events
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

  /* ------------------------------------------------------------------
      REDIRECT HELPERS
  ------------------------------------------------------------------ */
  const goToSignIn = () => {
    if (Platform.OS === "web") {
      window.location.replace("https://overlooked.cloud/signin");
      return;
    }
    navigation.reset({
      index: 0,
      routes: [{ name: "SignIn" }],
    });
  };

  /* ------------------------------------------------------------------
      3. UPDATE PASSWORD — first try, guaranteed
  ------------------------------------------------------------------ */
  const handleUpdatePassword = async () => {
    setMessage("");

    if (!password || !confirm) {
      setMessage("Please fill out both fields.");
      return;
    }
    if (password.length < 6) {
      setMessage("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setMessage("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      // ⭐ Refresh Supabase session one more time before updating
      if (Platform.OS === "web") {
        await supabase.auth.exchangeCodeForSession(window.location.href);
      }

      await new Promise((res) => setTimeout(res, 120));

      const { error } = await supabase.auth.updateUser({
        password: password.trim(),
      });

      if (error) {
        setMessage(error.message);
        setLoading(false);
        return;
      }

      setMessage("Password updated! Redirecting…");

      // ⭐ Must sign out or Supabase remains in recovery-state
      await supabase.auth.signOut();

      // ⭐ Guaranteed redirect
      goToSignIn();
      return;
    } catch (err: any) {
      console.error("Password update error:", err);
      setMessage(err.message || "Unexpected error.");
    } finally {
      setLoading(false);
    }
  };

  /* ------------------------------------------------------------------
      UI — Restoring
  ------------------------------------------------------------------ */
  if (restoring) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
        <Text style={styles.loading}>Preparing reset…</Text>
      </SafeAreaView>
    );
  }

  /* ------------------------------------------------------------------
      UI — Invalid or expired reset link
  ------------------------------------------------------------------ */
  if (!hasSession) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.invalid}>
          Your password reset link is invalid or expired.
        </Text>

        <TouchableOpacity style={styles.button} onPress={goToSignIn}>
          <Text style={styles.buttonText}>BACK TO SIGN IN</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  /* ------------------------------------------------------------------
      MAIN UI
  ------------------------------------------------------------------ */
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: DARK_BG }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <View
          style={[
            styles.wrapper,
            {
              paddingTop: insets.top + 20,
              paddingBottom: insets.bottom + 20,
            },
          ]}
        >
          <TouchableOpacity onPress={goToSignIn} style={styles.back}>
            <Ionicons name="chevron-back" size={18} color={SUB} />
            <Text style={styles.backLabel}>Back</Text>
          </TouchableOpacity>

          <View style={styles.card}>
            <Text style={styles.title}>Set a New Password</Text>
            <Text style={styles.subtitle}>
              Enter and confirm your password.
            </Text>

            <View style={styles.inputRow}>
              <Ionicons name="lock-closed" size={16} color={SUB} />
              <TextInput
                placeholder="New password"
                placeholderTextColor={SUB}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                style={styles.input}
              />
            </View>

            <View style={styles.inputRow}>
              <Ionicons name="shield-checkmark" size={16} color={SUB} />
              <TextInput
                placeholder="Confirm password"
                placeholderTextColor={SUB}
                secureTextEntry
                value={confirm}
                onChangeText={setConfirm}
                style={styles.input}
              />
            </View>

            <TouchableOpacity
              onPress={handleUpdatePassword}
              disabled={loading}
              style={[styles.button, loading && { opacity: 0.6 }]}
            >
              {loading ? (
                <ActivityIndicator color={DARK_BG} />
              ) : (
                <Text style={styles.buttonText}>UPDATE PASSWORD</Text>
              )}
            </TouchableOpacity>

            {message ? <Text style={styles.msg}>{message}</Text> : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ========================================================================
    STYLES
======================================================================== */

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: DARK_BG,
    justifyContent: "center",
    alignItems: "center",
  },
  loading: {
    marginTop: 10,
    color: SUB,
    fontFamily: SYSTEM_SANS,
  },
  invalid: {
    color: TEXT,
    fontSize: 18,
    textAlign: "center",
    paddingHorizontal: 30,
    marginBottom: 20,
    fontFamily: SYSTEM_SANS,
  },
  wrapper: {
    flex: 1,
    paddingHorizontal: 24,
  },
  back: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 25,
  },
  backLabel: {
    marginLeft: 6,
    fontSize: 15,
    color: SUB,
    fontFamily: SYSTEM_SANS,
  },
  card: {
    backgroundColor: CARD_BG,
    padding: 26,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
  title: {
    fontSize: 22,
    color: TEXT,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 4,
    fontFamily: SYSTEM_SANS,
  },
  subtitle: {
    textAlign: "center",
    color: SUB,
    marginBottom: 18,
    fontFamily: SYSTEM_SANS,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 14,
    backgroundColor: "#0A0A0A",
  },
  input: {
    flex: 1,
    marginLeft: 10,
    fontSize: 15,
    color: TEXT,
    fontFamily: SYSTEM_SANS,
  },
  button: {
    backgroundColor: GOLD,
    paddingVertical: 14,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 6,
  },
  buttonText: {
    color: DARK_BG,
    fontSize: 15,
    fontWeight: "900",
    fontFamily: SYSTEM_SANS,
  },
  msg: {
    marginTop: 14,
    textAlign: "center",
    color: SUB,
    fontSize: 14,
    fontFamily: SYSTEM_SANS,
  },
});
