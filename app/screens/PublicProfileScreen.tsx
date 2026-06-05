import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, Text, Platform } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../context/ThemeContext";

export default function PublicProfileScreen() {
  const { colors } = useAppTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const routeSlug = route.params?.slug;
  const pathSlug =
    Platform.OS === "web" && typeof window !== "undefined"
      ? window.location.pathname.match(/^\/creative\/([^/]+)/)?.[1]
      : null;

  const slug = (() => {
    const raw = routeSlug || pathSlug || "";
    try {
      return decodeURIComponent(String(raw)).trim();
    } catch {
      return String(raw).trim();
    }
  })();

  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    let cancelled = false;

    const openRealProfile = async () => {
      try {
        if (!slug) {
          if (!cancelled) {
            setErrorText("Missing public profile slug.");
            setLoading(false);
          }
          return;
        }

        const { data, error } = await supabase
          .from("users")
          .select("id, is_profile_public")
          .eq("public_slug", slug)
          .maybeSingle();

        if (cancelled) return;

        if (error) {
          setErrorText(error.message || "Could not load profile.");
          setLoading(false);
          return;
        }

        if (!data?.id) {
          setErrorText("Profile not found.");
          setLoading(false);
          return;
        }

        if (data.is_profile_public === false) {
          setErrorText("This profile is private.");
          setLoading(false);
          return;
        }

        navigation.replace("MainTabs", {
          screen: "Profile",
          params: { userId: data.id },
        });
      } catch (e: any) {
        if (!cancelled) {
          setErrorText(e?.message || "Could not load profile.");
          setLoading(false);
        }
      }
    };

    openRealProfile();

    return () => {
      cancelled = true;
    };
  }, [slug, navigation]);

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator size="large" color={colors.loader} />
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 24,
      }}
    >
      <Text
        style={{
          color: colors.textPrimary,
          fontSize: 18,
          textAlign: "center",
          marginBottom: 10,
        }}
      >
        {errorText || "Profile not found."}
      </Text>

      <Text
        style={{
          color: colors.textSecondary,
          fontSize: 13,
          textAlign: "center",
        }}
      >
        The shared profile could not be opened.
      </Text>
    </View>
  );
}
