// app/navigation/linking.ts
import { LinkingOptions } from "@react-navigation/native";

export const linking: LinkingOptions<any> = {
  prefixes: [
    "https://overlooked.cloud",
    "https://www.overlooked.cloud",

    // Supabase reset flow
    "https://overlooked.cloud/auth/v1/verify",
    "https://overlooked.cloud/auth/confirm",

    // Mobile deep links
    "overlooked://",
    "overlooked://callback",
    "overlooked://reset-password",

    // Dev
    "http://localhost:3000",
    "exp://localhost:19000",
  ],

  config: {
    screens: {
      /* ----------------------------------------------------
         EACH RESET PATH GETS ITS OWN ROUTE → SAME SCREEN
         ---------------------------------------------------- */

      // Normal reset-password route
      ResetPassword: "reset-password",

      // Supabase verify route with params
      VerifyPassword: "auth/v1/verify",

      // Supabase confirm route
      ConfirmPassword: "auth/confirm",

      /* All map to the SAME screen internally (NewPassword)
         because AppNavigator registers NewPassword globally
      */

      /* ----------------------------------------------------
         AUTH SCREENS
         ---------------------------------------------------- */
      Auth: {
        screens: {
          SignIn: "signin",
          SignUp: "signup",
          ForgotPassword: "forgot-password",
          CreateProfile: "create-profile",
        },
      },

      /* ----------------------------------------------------
         MAIN TABS
         ---------------------------------------------------- */
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

  getStateFromPath(path, options) {
    try {
      const { getStateFromPath } = require("@react-navigation/native");
      return getStateFromPath(path, options);
    } catch (e) {
      console.warn("[linking] Failed to parse:", path, e);
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
