// app/navigation/linking.ts
import { LinkingOptions } from "@react-navigation/native";

export const linking: LinkingOptions<any> = {
  prefixes: [
    "https://overlooked.cloud",
    "https://www.overlooked.cloud",

    // Supabase sends these:
    "https://overlooked.cloud/auth/v1/verify",
    "https://overlooked.cloud/auth/confirm",

    // Optional clean route
    "https://overlooked.cloud/reset-password",

    // Mobile
    "overlooked://",
    "overlooked://reset-password",

    // Local dev
    "http://localhost:3000",
    "exp://localhost:19000"
  ],

  config: {
    screens: {
      /* -----------------------------------------------------------
         ⭐ All recovery URLs → NewPassword screen
      ----------------------------------------------------------- */
      NewPassword: {
        path: "reset-password",
        parse: {
          access_token: (v) => v,
          refresh_token: (v) => v,
          type: (v) => v
        }
      },

      /* AUTH */
      Auth: {
        screens: {
          SignIn: "signin",
          SignUp: "signup",
          ForgotPassword: "forgot-password",
          CreateProfile: "create-profile"
        }
      },

      /* MAIN TABS */
      MainTabs: {
        screens: {
          Featured: "featured",
          Jobs: "jobs",
          Challenge: "challenge",
          Location: "location",
          Chats: "chats",
          Profile: "profile"
        }
      },

      ChatRoom: "chats/:id",
      UserProfile: "u/:id",
      PaySuccess: "pay/success"
    }
  },

  /* fallback */
  getStateFromPath(path, options) {
    try {
      const { getStateFromPath } = require("@react-navigation/native");
      return getStateFromPath(path, options);
    } catch (e) {
      console.warn("[linking] Failed to parse", path, e);
      return {
        routes: [{ name: "MainTabs", state: { routes: [{ name: "Featured" }] } }]
      };
    }
  }
};
