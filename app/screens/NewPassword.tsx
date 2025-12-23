// app/screens/NewPassword.tsx
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, CommonActions } from "@react-navigation/native";
import { supabase } from "../lib/supabase";
import { navigationRef } from "../navigation/navigationRef";

const BG = "#000";
const CARD = "#0B0B0B";
const TEXT = "#F5F3EF";
const SUB = "#A9A7A3";
const GOLD = "#C6A664";
const BORDER = "#262626";

export default function NewPassword() {
  const navigation = useNavigation<any>();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // EXACT SAME TOKEN PARSER USED IN SIGNUP
  const parseTokensFromUrl = () => {
    let params: Record<string, any> = {};

    // 1. Read HASH fragment (Safari + Supabase use this)
    if (Platform.OS === "web") {
      const hash = window.location.hash?.replace(/^#/, "") ?? "";
      const hashParams = new URLSearchParams(hash);
      hashParams.forEach((v, k) => (params[k] = v));
    }

    // 2. Read query params (?token_hash=...)
    const search = Platform.OS === "web" ? window.location.search : "";
    const searchParams = new URLSearchParams(search);
    searchParams.forEach((v, k) => (params[k] = v));

    return {
      access_token: params["access_token"],
      refresh_token: params["refresh_token"],
      token_hash: params["token_hash"],
      email: params["email"],
      type: params["type"],
    };
  };

  const establishSession = async () => {
    const { access_token, refresh_token, token_hash, email } =
      parseTokensFromUrl();

    console.log("Parsed Tokens:", {
      access_token,
      refresh_token,
      token_hash,
      email,
    });

    // CASE 1: Supabase recovery gives you a full session in hash
    if (access_token && refresh_token) {
      console.log("✔ Using full access_token session");
      const { error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });
      if (!error) return true;
    }

    // CASE 2: Recovery uses token_hash (verifyOtp)
    if (token_hash && email) {
      console.log("✔ Using token_hash to verify recovery session");
      const { error } = await supabase.auth.verifyOtp({
        type: "recovery",
        token_hash,
        email,
      });
      if (!error) return true;
    }

    console.log("❌ No valid session could be created");
    return false;
  };

  useEffect(() => {
    const run = async () => {
      const ok = await establishSession();
      if (ok) {
        console.log("✔ Recovery session established");
        setSessionReady(true);

        // CLEAN URL (remove tokens from browser)
        if (Platform.OS === "web") {
          const clean = window.location.origin + window.location.pathname;
          window.history.replaceState({}, document.title, clean);
        }
      }
    };
    run();
  }, []);

  const goToSignIn = async () => {
    if (signingOut) return;
    setSigningOut(true);

    try {
      // 1) Sign out so Auth stack becomes available in AppNavigator
      await supabase.auth.signOut();

      // 2) WEB: if the browser path is /reset-password, linking will keep sending you back here.
      // So we must move the URL to /signin before resetting navigation.
      if (Platform.OS === "web") {
        try {
          const origin = window.location.origin;
          window.history.replaceState({}, document.title, `${origin}/signin`);
        } catch (e) {
          // hard fallback
          window.location.href = "/signin";
          return;
        }
      }

      // 3) Reset nav to Auth -> SignIn
      const action = CommonActions.reset({
        index: 0,
        routes: [{ name: "Auth", params: { screen: "SignIn" } }],
      });

      if (navigationRef.isReady()) navigationRef.dispatch(action);
      else navigation.dispatch(action);
    } catch (e) {
      console.log("goToSignIn error:", e);

      if (Platform.OS === "web") {
        window.location.href = "/signin";
      }
    } finally {
      setSigningOut(false);
    }
  };

  const updatePassword = async () => {
    if (!sessionReady)
      return Alert.alert("Invalid Link", "Please open the reset link again.");

    if (!password || !confirm)
      return Alert.alert("Error", "Fill in both fields.");

    if (password !== confirm)
      return Alert.alert("Error", "Passwords do not match.");

    if (password.length < 6)
      return Alert.alert("Error", "Password must be at least 6 characters.");

    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    setLoading(false);

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    // ✅ Redirect to SignIn after update
    Alert.alert("Success", "Your password has been updated.", [
      { text: "OK", onPress: () => goToSignIn() },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }}>
      <View style={styles.container}>
        <TouchableOpacity
          onPress={() => goToSignIn()}
          style={styles.back}
          disabled={signingOut}
        >
          {signingOut ? (
            <ActivityIndicator color={SUB} />
          ) : (
            <Ionicons name="chevron-back" size={18} color={SUB} />
          )}
          <Text style={styles.backText}>Back to Sign In</Text>
        </TouchableOpacity>

        <View style={styles.card}>
          <Text style={styles.title}>Set a New Password</Text>
          <Text style={styles.subtitle}>Enter your new password below.</Text>

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
            onPress={updatePassword}
            disabled={loading || signingOut}
            style={[
              styles.button,
              (loading || signingOut) && { opacity: 0.6 },
            ]}
          >
            {loading ? (
              <ActivityIndicator color={BG} />
            ) : (
              <Text style={styles.buttonText}>UPDATE PASSWORD</Text>
            )}
          </TouchableOpacity>

          {!sessionReady && (
            <Text style={styles.error}>Waiting for valid reset link…</Text>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  back: { flexDirection: "row", alignItems: "center", marginBottom: 20 },
  backText: { marginLeft: 6, color: SUB, fontSize: 15 },
  card: {
    backgroundColor: CARD,
    padding: 26,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
  },
  title: {
    fontSize: 22,
    color: TEXT,
    textAlign: "center",
    fontWeight: "800",
    marginBottom: 4,
  },
  subtitle: { color: SUB, textAlign: "center", marginBottom: 18 },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  input: { flex: 1, marginLeft: 10, color: TEXT, fontSize: 15 },
  button: {
    backgroundColor: GOLD,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonText: { color: BG, fontWeight: "900", fontSize: 15 },
  error: { color: "red", marginTop: 10, textAlign: "center" },
});
