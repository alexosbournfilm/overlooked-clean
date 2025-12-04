// app/navigation/linking.ts
import { LinkingOptions } from "@react-navigation/native";

export const linking: LinkingOptions<any> = {
  prefixes: [
    "https://overlooked.cloud",
    "https://www.overlooked.cloud",

    // Supabase recovery links
    "https://overlooked.cloud/auth/v1/verify",
    "https://overlooked.cloud/auth/confirm",

    // Mobile schemes
    "overlooked://",

    // Dev
    "http://localhost:3000",
    "exp://localhost:19000",
  ],

  config: {
    screens: {
      /* AUTH STACK */
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
