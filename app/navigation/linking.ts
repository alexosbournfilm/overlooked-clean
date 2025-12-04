// app/navigation/linking.ts
import { LinkingOptions } from "@react-navigation/native";

export const linking: LinkingOptions<any> = {
  prefixes: [
    "https://overlooked.cloud",
    "https://www.overlooked.cloud",

    // Supabase will send recovery links here:
    "https://overlooked.cloud/auth/v1/verify",
    "https://overlooked.cloud/auth/confirm",

    // Mobile schemes
    "overlooked://",
    "overlooked://callback",
    "overlooked://reset-password",

    // Dev / Expo
    "http://localhost:3000",
    "exp://localhost:19000",
  ],

  config: {
    screens: {
      /* -----------------------------------------------------------
         ⭐ ROUTE ALL RESET URLS → NewPassword
         ----------------------------------------------------------- 
         These cover EVERY password reset flow Supabase uses:
         - /reset-password
         - /auth/v1/verify?type=recovery
         - /auth/confirm?type=recovery
         - /auth/v1/verify#access_token=...
         - /auth/confirm#access_token=...
         - overlooked://reset-password
      ----------------------------------------------------------- */

      NewPassword: {
        // One wildcard path matching ALL different URL forms
        path: "*", // We handle filtering inside AppNavigator
        parse: {
          token: (v) => v,
          access_token: (v) => v,
          refresh_token: (v) => v,
          type: (v) => v,
        },
      },

      /* -----------------------------------------------------------
         AUTH SCREENS
      ----------------------------------------------------------- */
      Auth: {
        screens: {
          SignIn: "signin",
          SignUp: "signup",
          ForgotPassword: "forgot-password",
          CreateProfile: "create-profile",
        },
      },

      /* -----------------------------------------------------------
         MAIN APPLICATION TABS
      ----------------------------------------------------------- */
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

      ChatRoom: "chats/:id",
      UserProfile: "u/:id",
      PaySuccess: "pay/success",
    },
  },

  /* -----------------------------------------------------------
     FALLBACK HANDLER (keeps app stable)
  ----------------------------------------------------------- */
  getStateFromPath(path, options) {
    try {
      const { getStateFromPath } = require("@react-navigation/native");
      return getStateFromPath(path, options);
    } catch (e) {
      console.warn("[linking] Failed to parse path:", path, e);
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
