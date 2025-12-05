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
  const [sessionReady, setSessionReady] = useState(false);

  // 🔍 Parse tokens from URL (works for both Web hash & Mobile query params)
  const parseTokens = (url: string | null) => {
    if (!url) return {};

    const parsed = Linking.parse(url);
    let params: Record<string, any> = {};

    // Web uses the hash (#access_token=...)
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const hash = window.location.hash.replace(/^#/, "");
      const hashParams = new URLSearchParams(hash);
      hashParams.forEach((v, k) => (params[k] = v));
    }

    // Mobile uses parsed.queryParams
    if (parsed?.queryParams) {
      params = { ...params, ...parsed.queryParams };
    }

    return {
      access_token: params["access_token"],
      refresh_token: params["refresh_token"],
      type: params["type"],
    };
  };

  // Restore Supabase recovery session
  const restoreSession = async (url: string | null) => {
    if (!url) return;

    const { access_token, refresh_token } = parseTokens(url);

    if (access_token && refresh_token) {
      const { error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });

      if (!error) {
        console.log("🔐 Recovery session restored.");
        setSessionReady(true);
      }
    }
  };

  // Auto-run restoration when screen mounts
  useEffect(() => {
    const init = async () => {
      if (Platform.OS === "web") {
        await restoreSession(window.location.href);
      } else {
        const initial = await Linking.getInitialURL();
        await restoreSession(initial ?? null);
      }

      // Also handle any future URL open events (mobile)
      const sub = Linking.addEventListener("url", async (event) => {
        await restoreSession(event.url);
      });

      return () => sub.remove();
    };

    init();
  }, []);

  // Redirect helper
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

  // Update password handler
  const handleUpdatePassword = async () => {
    if (!sessionReady) {
      return Alert.alert(
        "Session Not Ready",
        "Please open the password reset link from your email again."
      );
    }

    if (!password || !confirm)
      return Alert.alert("Missing Fields", "Please fill both fields.");

    if (password !== confirm)
      return Alert.alert("Error", "Passwords do not match.");

    if (password.length < 6)
      return Alert.alert("Error", "Password must be at least 6 characters.");

    setLoading(true);

    const { error } = await supabase.auth.updateUser({
      password: password.trim(),
    });

    if (error) {
      setLoading(false);
      return Alert.alert("Error", error.message);
    }

    // REQUIRED by Supabase
    await supabase.auth.signOut();

    setLoading(false);
    Alert.alert("Success", "Your password has been updated.");

    goToSignIn();
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
              Enter your new password below.
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
              style={[styles.button, loading && { opacity: 0.6 }]}
            >
              {loading ? (
                <ActivityIndicator color={DARK_BG} />
              ) : (
                <Text style={styles.buttonText}>UPDATE PASSWORD</Text>
              )}
            </TouchableOpacity>
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
