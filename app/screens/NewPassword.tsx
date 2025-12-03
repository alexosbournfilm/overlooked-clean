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
  const [hasSession, setHasSession] = useState(false);
  const [message, setMessage] = useState("");

  //--------------------------------------------------------------------
  // FIX: Process Supabase URL → session
  //--------------------------------------------------------------------
  async function processRecoveryUrl(url: string) {
    try {
      const parsed = new URL(url);
      const code = parsed.searchParams.get("code");
      const type = parsed.searchParams.get("type");

      if (code && type === "recovery") {
        const { error } = await supabase.auth.exchangeCodeForSession(url);
        if (error) console.log("exchangeCodeForSession:", error);
      }

      // Old format
      if (url.includes("#")) {
        const hash = url.split("#")[1];
        const params = new URLSearchParams(hash);
        const access = params.get("access_token");
        const refresh = params.get("refresh_token");
        const t = params.get("type");

        if (t === "recovery" && access && refresh) {
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

  //--------------------------------------------------------------------
  // Load + validate recovery session
  //--------------------------------------------------------------------
  useEffect(() => {
    let active = true;

    async function load() {
      const initial = await Linking.getInitialURL();
      if (initial) await processRecoveryUrl(initial);

      // Check for session AFTER processing
      const { data } = await supabase.auth.getSession();
      if (active) {
        setHasSession(!!data.session);
        setRestoring(false);
      }
    }

    load();

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

  //--------------------------------------------------------------------
  // ALWAYS navigate back to sign-in safely
  //--------------------------------------------------------------------
  const handleBack = () => {
    navigation.reset({
      index: 0,
      routes: [{ name: "SignIn" }],
    });
  };

  //--------------------------------------------------------------------
  // UPDATE PASSWORD
  //--------------------------------------------------------------------
  const handleUpdate = async () => {
    if (password.length < 6) {
      setMessage("Password must be at least 6 characters.");
      return;
    }

    const { error } = await supabase.auth.updateUser({
      password: password.trim(),
    });

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

  //--------------------------------------------------------------------
  // UI STATES
  //--------------------------------------------------------------------

  // 1) STILL restoring URL/session
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

  // 2) No valid recovery session found
  if (!hasSession) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: T.bg,
          padding: 30,
        }}
      >
        <Text style={{ color: T.text, fontSize: 18, textAlign: "center" }}>
          Your password reset link is invalid or expired.
        </Text>

        <TouchableOpacity
          style={[
            styles.button,
            { marginTop: 22, width: 200, alignSelf: "center" },
          ]}
          onPress={handleBack}
        >
          <Text style={styles.buttonText}>Back to Sign In</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // 3) Normal UI
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
