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

// Theme
const DARK_BG = "#0D0D0D";
const T = {
  bg: DARK_BG,
  card: "#111111",
  text: "#EDEBE6",
  sub: "#D0CEC8",
  mute: "#A7A6A2",
  accent: "#C6A664",
  border: "#2E2E2E",
};
const SYSTEM_SANS =
  Platform.select({ ios: "System", android: "Roboto", web: undefined }) ||
  undefined;

export default function NewPassword() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [message, setMessage] = useState("");

  // --------------------------------------------------------------------
  // ⭐ FIXED: Supabase password-reset URLs must use the FULL URL
  // --------------------------------------------------------------------
  async function handleFullUrlLogin(fullUrl: string) {
    try {
      const { data, error } = await supabase.auth.exchangeCodeForSession(
        fullUrl
      );
      if (error) console.log("exchangeCodeForSession error", error);
    } catch (err) {
      console.log("Failed to exchange session:", err);
    }
  }

  // --------------------------------------------------------------------
  // ⭐ MAIN TOKEN PROCESSING LOGIC (handles ALL Supabase cases)
  // --------------------------------------------------------------------
  useEffect(() => {
    let mounted = true;

    const processUrl = async (rawUrl: string | null) => {
      if (!rawUrl) {
        mounted && setRestoring(false);
        return;
      }

      try {
        const url = new URL(rawUrl);

        const code = url.searchParams.get("code");
        const type = url.searchParams.get("type");

        if (code && type === "recovery") {
          await handleFullUrlLogin(rawUrl);
          mounted && setRestoring(false);
          return;
        }

        // OLD HASH FORMAT
        if (rawUrl.includes("#")) {
          const hash = rawUrl.split("#")[1];
          const params = new URLSearchParams(hash);

          const access_token = params.get("access_token");
          const refresh_token = params.get("refresh_token");
          const typeHash = params.get("type");

          if (typeHash === "recovery" && access_token && refresh_token) {
            await supabase.auth.setSession({
              access_token,
              refresh_token,
            });
          }
        }
      } catch (e) {
        console.log("URL parse error:", e);
      }

      mounted && setRestoring(false);
    };

    Linking.getInitialURL().then((u) => processUrl(u));
    const sub = Linking.addEventListener("url", (e) => processUrl(e.url));

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  // --------------------------------------------------------------------
  // ⭐ UPDATE PASSWORD
  // --------------------------------------------------------------------
  const handleUpdate = async () => {
    if (password.length < 6) {
      setMessage("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.updateUser({
      password: password.trim(),
    });

    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Password updated! Redirecting…");

    setTimeout(() => {
      navigation.reset({
        index: 0,
        routes: [{ name: "SignIn" }],
      });
    }, 1200);
  };

  // --------------------------------------------------------------------
  // ⭐ BACK BUTTON FIX: ALWAYS GO TO SIGNIN
  // --------------------------------------------------------------------
  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.reset({
        index: 0,
        routes: [{ name: "SignIn" }],
      });
    }
  };

  // --------------------------------------------------------------------
  // LOADING UI DURING SESSION RESTORATION
  // --------------------------------------------------------------------
  if (restoring) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: T.bg,
        }}
      >
        <ActivityIndicator size="large" color={T.accent} />
        <Text style={{ color: T.sub, marginTop: 12 }}>Preparing reset…</Text>
      </SafeAreaView>
    );
  }

  // --------------------------------------------------------------------
  // UI
  // --------------------------------------------------------------------
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View
          style={[
            styles.container,
            { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 },
          ]}
        >
          {/* ⭐ FIX APPLIED HERE */}
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Ionicons name="chevron-back" size={20} color={T.sub} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          <View style={styles.card}>
            <Text style={styles.title}>Set a New Password</Text>
            <Text style={styles.subtitle}>
              Enter your new password and confirm.
            </Text>

            <View style={styles.inputWrap}>
              <Ionicons name="lock-closed" size={16} color={T.mute} />
              <TextInput
                style={styles.input}
                placeholder="New password"
                placeholderTextColor={T.mute}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
            </View>

            <TouchableOpacity
              onPress={handleUpdate}
              disabled={loading}
              style={[styles.button, loading && { opacity: 0.7 }]}
            >
              {loading ? (
                <ActivityIndicator color={DARK_BG} />
              ) : (
                <Text style={styles.buttonText}>Update Password</Text>
              )}
            </TouchableOpacity>

            {message ? <Text style={styles.message}>{message}</Text> : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 22,
    alignItems: "center",
    backgroundColor: T.bg,
  },
  backButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  backText: {
    color: T.sub,
    fontFamily: SYSTEM_SANS,
    fontWeight: "600",
    marginLeft: 4,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: T.card,
    borderRadius: 18,
    padding: 22,
    borderWidth: 1,
    borderColor: T.border,
  },
  title: {
    fontSize: 20,
    color: T.text,
    fontWeight: "900",
    textAlign: "center",
    marginBottom: 6,
    fontFamily: SYSTEM_SANS,
  },
  subtitle: {
    color: T.sub,
    fontSize: 14,
    textAlign: "center",
    marginBottom: 18,
    fontFamily: SYSTEM_SANS,
  },
  inputWrap: {
    flexDirection: "row",
    gap: 10,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#0C0C0C",
    marginBottom: 16,
  },
  input: {
    flex: 1,
    color: T.text,
    fontSize: 15,
    fontFamily: SYSTEM_SANS,
  },
  button: {
    backgroundColor: T.accent,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 4,
  },
  buttonText: {
    color: DARK_BG,
    fontSize: 15,
    fontWeight: "900",
    fontFamily: SYSTEM_SANS,
    textTransform: "uppercase",
  },
  message: {
    marginTop: 16,
    color: T.sub,
    textAlign: "center",
    fontFamily: SYSTEM_SANS,
    fontSize: 13.5,
  },
});
