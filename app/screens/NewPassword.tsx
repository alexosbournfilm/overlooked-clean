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

/* ---------------- Safari deep link fix ---------------- */
const waitForUrl = async () => {
  for (let i = 0; i < 60; i++) {
    const url = await Linking.getInitialURL();
    if (url) return url;
    await new Promise((res) => setTimeout(res, 120));
  }
  return null;
};

export default function NewPassword() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [message, setMessage] = useState("");

  /* ---------------------------------------------------------------
      PROCESS RESET URL (query + fragment)
  ---------------------------------------------------------------- */
  async function processUrl(url: string) {
    try {
      if (url.includes("type=recovery")) {
        await supabase.auth.exchangeCodeForSession(url);
      }

      if (url.includes("#")) {
        const fragment = url.split("#")[1];
        const params = new URLSearchParams(fragment);

        const type = params.get("type");
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");

        if (type === "recovery" && access_token && refresh_token) {
          await supabase.auth.setSession({
            access_token,
            refresh_token,
          });
        }
      }
    } catch (err) {
      console.warn("processUrl error:", err);
    }
  }

  /* ---------------------------------------------------------------
      INITIAL LOAD
  ---------------------------------------------------------------- */
  useEffect(() => {
    let active = true;

    async function init() {
      // Always sign out first to clear broken sessions
      await supabase.auth.signOut();

      const url = await waitForUrl();
      if (url) await processUrl(url);

      // allow hydration
      await new Promise((res) => setTimeout(res, 200));

      const { data } = await supabase.auth.getSession();
      if (active) {
        setHasSession(!!data.session);
        setRestoring(false);
      }
    }

    init();

    const sub = Linking.addEventListener("url", async (e) => {
      await processUrl(e.url);
      const { data } = await supabase.auth.getSession();
      if (active) setHasSession(!!data.session);
    });

    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  /* ---------------------------------------------------------------
      REDIRECT TO SIGN IN
  ---------------------------------------------------------------- */
  const goToSignIn = () => {
    if (Platform.OS === "web") {
      window.location.assign("/signin");
    } else {
      navigation.reset({
        index: 0,
        routes: [{ name: "SignIn" }],
      });
    }
  };

  /* ---------------------------------------------------------------
      UPDATE PASSWORD — FIXED
  ---------------------------------------------------------------- */
  const handleUpdatePassword = async () => {
    setMessage("");

    if (!password || !confirm) return setMessage("Please fill out both fields.");
    if (password.length < 6) return setMessage("Password must be at least 6 characters.");
    if (password !== confirm) return setMessage("Passwords do not match.");

    setLoading(true);

    try {
      /* ---------------------------------------------------
        ⭐ CRITICAL SAFARI FIX ⭐
        Exchange code *again* before updateUser()
      --------------------------------------------------- */
      if (Platform.OS === "web") {
        await supabase.auth.exchangeCodeForSession(window.location.href);
        await new Promise((r) => setTimeout(r, 200));
      }

      const { error } = await supabase.auth.updateUser({
        password: password.trim(),
      });

      if (error) {
        setMessage(error.message);
        setLoading(false);
        return;
      }

      setMessage("Password updated! Redirecting…");

      // Mandatory sign-out to exit recovery mode
      await supabase.auth.signOut();

      // redirect
      goToSignIn();
      return;
    } catch (err: any) {
      setMessage(err.message || "Unexpected error.");
    } finally {
      setLoading(false);
    }
  };

  /* ---------------------------------------------------------------
      UI STATES
  ---------------------------------------------------------------- */
  if (restoring) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
        <Text style={styles.loading}>Preparing reset…</Text>
      </SafeAreaView>
    );
  }

  if (!hasSession) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.invalid}>Your password reset link is invalid or expired.</Text>

        <TouchableOpacity style={styles.button} onPress={goToSignIn}>
          <Text style={styles.buttonText}>BACK TO SIGN IN</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  /* ---------------------------------------------------------------
      MAIN UI
  ---------------------------------------------------------------- */
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
            <Text style={styles.subtitle}>Enter and confirm your password.</Text>

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

/* --------------------------- STYLES --------------------------- */
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
