// app/navigation/linking.ts
import { LinkingOptions } from "@react-navigation/native";

export const linking: LinkingOptions<any> = {
  prefixes: [
    "https://overlooked.cloud",
    "https://www.overlooked.cloud",

    // Supabase callback prefixes (hash-handled)
    "https://overlooked.cloud/auth/v1/verify",
    "https://overlooked.cloud/auth/confirm",

    // Mobile deep link
    "overlooked://",

    // Local dev
    "http://localhost:3000",
    "exp://localhost:19000",
  ],

  config: {
    screens: {
      /* AUTH FLOW */
      Auth: {
        screens: {
          SignIn: "signin",
          SignUp: "signup",
          ForgotPassword: "forgot-password",
          CreateProfile: "create-profile",

          // 🔥 Important: map accessible path → NewPassword route
          NewPassword: "reset-password",
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

  /**
   * SAFETY: ensures navigation doesn't break if a URL
   * is unrecognized or broken (especially on Web).
   */
  getStateFromPath(path, options) {
    try {
      const { getStateFromPath } = require("@react-navigation/native");
      return getStateFromPath(path, options);
    } catch (err) {
      console.warn("[linking] Failed to parse deep link:", path, err);
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
