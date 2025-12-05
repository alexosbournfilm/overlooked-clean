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
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import * as Linking from "expo-linking";
import { supabase } from "../lib/supabase";

const DARK_BG = "#000";
const CARD_BG = "#0B0B0B";
const GOLD = "#C6A664";
const TEXT = "#F5F3EF";
const SUB = "#A9A7A3";
const BORDER = "#262626";

export default function NewPassword() {
  const navigation = useNavigation<any>();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [restored, setRestored] = useState(false);

  /** --------------------------------------------------------------------
   * ⭐ Copy/paste of SignUpScreen's deep link + token-parsing logic
   * This is REQUIRED for Safari/iOS recovery flows.
   * ------------------------------------------------------------------*/
  const parseTokensFromUrl = (url: string) => {
    const parsed = Linking.parse(url);
    let params: Record<string, any> = {};

    // Web handles tokens in the hash fragment (#)
    if (typeof window !== "undefined" && Platform.OS === "web") {
      const hash = window.location.hash?.replace(/^#/, "") ?? "";
      const searchParams = new URLSearchParams(hash);
      searchParams.forEach((v, k) => (params[k] = v));
    }

    // Mobile uses parsed.queryParams
    if (parsed?.queryParams) {
      params = { ...params, ...parsed.queryParams };
    }

    return {
      access_token: params["access_token"],
      refresh_token: params["refresh_token"],
      type: params["type"],
      error_description: params["error_description"],
    };
  };

  const restoreRecoverySession = async (url: string | null) => {
    if (!url) return;

    // PKCE or OAuth-style
    if (url.includes("code=")) {
      const { error } = await supabase.auth.exchangeCodeForSession(url);
      if (error) {
        Alert.alert("Error", "Could not restore auth session.");
        return;
      }
      setRestored(true);
      return;
    }

    // Magic recovery token (?type=recovery)
    const { access_token, refresh_token } = parseTokensFromUrl(url);

    if (access_token && refresh_token) {
      console.log("🔐 Restoring recovery session…");

      const { error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });

      if (!error) setRestored(true);
    }
  };

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const init = async () => {
      // 1. Handle initial URL
      if (Platform.OS === "web") {
        await restoreRecoverySession(window.location.href);
      } else {
        const initial = await Linking.getInitialURL();
        await restoreRecoverySession(initial ?? null);
      }

      // 2. Handle opened app event
      const sub = Linking.addEventListener("url", async (event) => {
        await restoreRecoverySession(event.url);
      });

      unsubscribe = () => sub.remove();
    };

    init();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  /** -----------------------------------------------------------
   * Redirect user to Sign In
   * ----------------------------------------------------------*/
  const goToSignIn = () => {
    if (Platform.OS === "web") {
      window.location.replace("/signin");
      return;
    }

    navigation.reset({
      index: 0,
      routes: [{ name: "SignIn" }],
    });
  };

  /** -----------------------------------------------------------
   * Update password → sign out → redirect
   * ----------------------------------------------------------*/
  const handleUpdatePassword = async () => {
    if (!restored) {
      return Alert.alert(
        "Error",
        "Your recovery session is not active. Please open the link from your email again."
      );
    }

    if (!password || !confirm) {
      return Alert.alert("Missing Fields", "Please fill both fields.");
    }
    if (password !== confirm) {
      return Alert.alert("Error", "Passwords do not match.");
    }
    if (password.length < 6) {
      return Alert.alert("Error", "Password must be at least 6 characters.");
    }

    setLoading(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: password.trim(),
      });

      if (updateError) {
        setLoading(false);
        return Alert.alert("Error", updateError.message);
      }

      // REQUIRED: must log out to destroy the recovery token
      await supabase.auth.signOut();

      setLoading(false);

      goToSignIn();
    } catch (e: any) {
      console.log("Unexpected error:", e);
      Alert.alert("Unexpected error", e.message || "");
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: DARK_BG }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.wrapper}>
          <TouchableOpacity onPress={goToSignIn} style={styles.back}>
            <Ionicons name="chevron-back" size={18} color={SUB} />
            <Text style={styles.backLabel}>Back to Sign In</Text>
          </TouchableOpacity>

          <View style={styles.card}>
            <Text style={styles.title}>Set a New Password</Text>
            <Text style={styles.subtitle}>
              Enter and confirm your password.
            </Text>

            <View style={styles.inputRow}>
              <Ionicons name="lock-closed" size={16} color={SUB} />
              <TextInput
                secureTextEntry
                placeholder="New password"
                placeholderTextColor={SUB}
                value={password}
                onChangeText={setPassword}
                style={styles.input}
              />
            </View>

            <View style={styles.inputRow}>
              <Ionicons name="shield-checkmark" size={16} color={SUB} />
              <TextInput
                secureTextEntry
                placeholder="Confirm password"
                placeholderTextColor={SUB}
                value={confirm}
                onChangeText={setConfirm}
                style={styles.input}
              />
            </View>

            <TouchableOpacity
              onPress={handleUpdatePassword}
              disabled={loading}
              style={[styles.button, loading && { opacity: 0.5 }]}
            >
              {loading ? (
                <ActivityIndicator color={DARK_BG} />
              ) : (
                <Text style={styles.buttonText}>UPDATE PASSWORD</Text>
              )}
            </TouchableOpacity>

            {!restored && (
              <Text style={{ color: "red", marginTop: 10, textAlign: "center" }}>
                Waiting for recovery session...
              </Text>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, padding: 24 },
  back: { flexDirection: "row", alignItems: "center", marginBottom: 25 },
  backLabel: { marginLeft: 6, fontSize: 15, color: SUB },
  card: {
    backgroundColor: CARD_BG,
    padding: 26,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
  },
  title: {
    fontSize: 22,
    color: TEXT,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 4,
  },
  subtitle: {
    color: SUB,
    textAlign: "center",
    marginBottom: 18,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    backgroundColor: "#0A0A0A",
  },
  input: {
    flex: 1,
    marginLeft: 10,
    color: TEXT,
    fontSize: 15,
  },
  button: {
    backgroundColor: GOLD,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonText: {
    color: DARK_BG,
    fontSize: 15,
    fontWeight: "900",
  },
});
