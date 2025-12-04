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
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { supabase } from "../lib/supabase";

const DARK_BG = "#000";
const CARD_BG = "#0B0B0B";
const GOLD = "#C6A664";
const TEXT = "#F5F3EF";
const SUB = "#A9A7A3";
const BORDER = "#262626";

const SYSTEM_SANS =
  Platform.select({ ios: "System", android: "Roboto", web: undefined }) ||
  undefined;

/* ------------------------------------------
      FAST URL GETTER
------------------------------------------- */
const getUrl = async () => {
  if (Platform.OS === "web") return window.location.href;

  const initial = await Linking.getInitialURL();
  if (initial) return initial;

  return new Promise<string | null>((resolve) => {
    const t = setTimeout(() => resolve(null), 3000);
    const sub = Linking.addEventListener("url", (e) => {
      clearTimeout(t);
      resolve(e.url);
      sub.remove();
    });
  });
};

export default function NewPassword() {
  const navigation = useNavigation<any>();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [restoring, setRestoring] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [passwordWasUpdated, setPasswordWasUpdated] = useState(false);

  /* ------------------------------------------
      REDIRECT USER INTO APP
------------------------------------------- */
  const goToApp = () => {
    if (Platform.OS === "web") {
      window.location.replace("/");
    } else {
      navigation.reset({
        index: 0,
        routes: [{ name: "Featured" }],
      });
    }
  };

  /* ------------------------------------------
      DEEP LINK HANDLING — ONLY BEFORE UPDATE
------------------------------------------- */
  const processReset = async (url: string) => {
    if (!url || passwordWasUpdated) return;

    try {
      if (url.includes("type=recovery")) {
        await supabase.auth.exchangeCodeForSession(url);
      }

      if (url.includes("#")) {
        const params = new URLSearchParams(url.split("#")[1]);
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");

        if (access_token && refresh_token) {
          await supabase.auth.setSession({ access_token, refresh_token });
        }
      }
    } catch (e) {
      console.warn("Reset process error:", e);
    }
  };

  /* ------------------------------------------
      INITIAL MOUNT
------------------------------------------- */
  useEffect(() => {
    let mounted = true;

    (async () => {
      if (!passwordWasUpdated) {
        const url = await getUrl();
        if (url) await processReset(url);
      }

      const { data } = await supabase.auth.getSession();

      if (mounted) {
        setHasSession(!!data.session);
        setRestoring(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [passwordWasUpdated]);

  /* ------------------------------------------
      UPDATE PASSWORD
------------------------------------------- */
  const handleUpdatePassword = async () => {
    if (submitting) return;

    if (!password || !confirm) return alert("Fill both fields");
    if (password !== confirm) return alert("Passwords do not match");
    if (password.length < 6) return alert("Password too short");

    setSubmitting(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: password.trim(),
      });

      if (error) {
        alert(error.message);
        setSubmitting(false);
        return;
      }

      // 🚀 Key improvement
      setPasswordWasUpdated(true);

      // Clear secure fields
      setPassword("");
      setConfirm("");

      // Navigate instantly
      goToApp();
    } catch {
      alert("Unexpected error");
    } finally {
      setSubmitting(false);
    }
  };

  /* ------------------------------------------
      LOADING SCREEN
------------------------------------------- */
  if (restoring) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
        <Text style={styles.loading}>Preparing reset…</Text>
      </SafeAreaView>
    );
  }

  /* ------------------------------------------
      INVALID LINK
------------------------------------------- */
  if (!hasSession) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.invalid}>Invalid or expired reset link.</Text>

        <TouchableOpacity style={styles.button} onPress={goToApp}>
          <Text style={styles.buttonText}>BACK TO APP</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  /* ------------------------------------------
      MAIN UI
------------------------------------------- */
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: DARK_BG }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.wrapper}>
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
              disabled={submitting}
              style={[styles.button, submitting && { opacity: 0.6 }]}
            >
              {submitting ? (
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

/* ------------------------------------------
      STYLES
------------------------------------------- */
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
    marginBottom: 20,
    textAlign: "center",
    fontFamily: SYSTEM_SANS,
  },
  wrapper: {
    flex: 1,
    padding: 24,
  },
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
    fontFamily: SYSTEM_SANS,
  },
  subtitle: {
    color: SUB,
    textAlign: "center",
    marginBottom: 18,
    fontFamily: SYSTEM_SANS,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 12,
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
    alignItems: "center",
    marginTop: 6,
  },
  buttonText: {
    color: DARK_BG,
    fontSize: 15,
    fontWeight: "900",
    fontFamily: SYSTEM_SANS,
  },
});
