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

  // This gets ?token_hash= from the URL — no recovery session is needed.
  const [tokenHash, setTokenHash] = useState<string | null>(null);

  const readTokenFromUrl = () => {
    let params: any = {};

    if (Platform.OS === "web") {
      const search = new URLSearchParams(window.location.search);
      search.forEach((v, k) => (params[k] = v));
    } else {
      const parsed = Linking.parse(window.location.href);
      params = parsed?.queryParams ?? {};
    }

    return params["token_hash"] || null;
  };

  useEffect(() => {
    const hash = readTokenFromUrl();
    if (!hash) {
      Alert.alert(
        "Invalid Link",
        "Your password reset link is missing or expired."
      );
    }
    setTokenHash(hash);
  }, []);

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

  // ⚡ MAIN: Update password WITHOUT depending on recovery session
  const handleUpdatePassword = async () => {
    if (!tokenHash) {
      return Alert.alert(
        "Invalid Reset Link",
        "Your reset link does not contain a valid token."
      );
    }

    if (!password || !confirm) {
      return Alert.alert("Missing Fields", "Enter both fields.");
    }
    if (password !== confirm) {
      return Alert.alert("Error", "Passwords do not match.");
    }
    if (password.length < 6) {
      return Alert.alert("Error", "Password must be 6+ characters.");
    }

    setLoading(true);

    try {
      // 1️⃣ Verify OTP and get a temporary session
      const { data, error: otpError } = await supabase.auth.verifyOtp({
        type: "recovery",
        token_hash: tokenHash,
      });

      if (otpError) {
        setLoading(false);
        return Alert.alert("Error", otpError.message);
      }

      // 2️⃣ Now update the password
      const { error: updateError } = await supabase.auth.updateUser({
        password: password.trim(),
      });

      if (updateError) {
        setLoading(false);
        return Alert.alert("Error", updateError.message);
      }

      // 3️⃣ Must sign out after password update
      await supabase.auth.signOut();

      setLoading(false);

      Alert.alert("Success!", "Your password has been updated.");
      goToSignIn();
    } catch (e: any) {
      setLoading(false);
      Alert.alert("Unexpected Error", e.message || "Something went wrong.");
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
              style={[styles.button, loading && { opacity: 0.4 }]}
            >
              {loading ? (
                <ActivityIndicator color={DARK_BG} />
              ) : (
                <Text style={styles.buttonText}>UPDATE PASSWORD</Text>
              )}
            </TouchableOpacity>

            {!tokenHash && (
              <Text style={{ color: "red", marginTop: 10, textAlign: "center" }}>
                Missing reset token. Re-open the link from your email.
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
