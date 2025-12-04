// app/navigation/linking.ts
import { LinkingOptions } from "@react-navigation/native";

export const linking: LinkingOptions<any> = {
  /** -------------------------------------------------------------
   *  Prefixes the app will respond to
   *  DO NOT add /reset-password here — recovery links come with HASH (#)
   *  and must not be treated as a path match.
   * ------------------------------------------------------------- */
  prefixes: [
    "https://overlooked.cloud",
    "https://www.overlooked.cloud",

    // Supabase recovery URLs (valid hash-based callback)
    "https://overlooked.cloud/auth/v1/verify",
    "https://overlooked.cloud/auth/confirm",

    // Mobile deep links
    "overlooked://",

    // Dev
    "http://localhost:3000",
    "exp://localhost:19000",
  ],

  /** -------------------------------------------------------------
   * App screens mapping (no Recovery route here)
   * Recovery is handled in AppNavigator BEFORE React Navigation loads.
   * ------------------------------------------------------------- */
  config: {
    screens: {
      /* AUTH FLOW */
      Auth: {
        screens: {
          SignIn: "signin",
          SignUp: "signup",
          ForgotPassword: "forgot-password",
          CreateProfile: "create-profile",
        },
      },

      /* MAIN TABS */
      MainTabs: {
        screens: {
          Featured: "featured",
          Jobs: "jobs",
          Challenge: "challenge",
          Location: "location",
          Chats: "chats",
          Profile: "profile",
        },
      },

      /* OTHER SCREENS */
      ChatRoom: "chats/:id",
      UserProfile: "u/:id",
      PaySuccess: "pay/success",
    },
  },

  /** -------------------------------------------------------------
   * Safe fallback — prevents crash if a path can't be parsed.
   * ------------------------------------------------------------- */
  getStateFromPath(path, options) {
    try {
      const { getStateFromPath } = require("@react-navigation/native");
      return getStateFromPath(path, options);
    } catch (e) {
      console.warn("[linking] Failed to parse deep link:", path, e);
      return {
        routes: [
          {
            name: "MainTabs",
            state: { routes: [{ name: "Featured" }] },
          },
        ],
      };
    }
  },
};
