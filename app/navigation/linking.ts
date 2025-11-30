import { LinkingOptions } from "@react-navigation/native";

export const linking: LinkingOptions<any> = {
  prefixes: [
    // Web
    "https://overlooked.cloud",
    "https://www.overlooked.cloud",

    // Mobile deep links
    "overlooked://callback",
    "overlooked://reset-password",
    "overlooked://",

    // Dev environments
    "http://localhost:3000",
    "exp://localhost:19000"
  ],

  config: {
    screens: {
      // -----------------------------------------------
      // AUTH FLOW SCREENS
      // -----------------------------------------------
      SignIn: "signin",               // Supabase confirmation lands here
      SignUp: "signup",
      ForgotPassword: "forgot-password",

      // Email confirmed / recovery deep link for Web
      CreateProfile: "create-profile",

      // Password reset (web + mobile)
      NewPassword: "reset-password",

      // -----------------------------------------------
      // MAIN APP (tabs)
      // -----------------------------------------------
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

      // -----------------------------------------------
      // CHAT
      // -----------------------------------------------
      ChatRoom: "chats/:id",

      // -----------------------------------------------
      // USER PROFILE
      // -----------------------------------------------
      UserProfile: "u/:id",

      // -----------------------------------------------
      // PAYMENTS
      // -----------------------------------------------
      PaySuccess: "pay/success"
    }
  },

  // Prevent crash on malformed URLs
  getStateFromPath(path, options) {
    try {
      const { getStateFromPath } = require("@react-navigation/native");
      return getStateFromPath(path, options);
    } catch (e) {
      console.warn("[linking] Could not parse:", path, e);
      return {
        routes: [
          {
            name: "MainTabs",
            state: { routes: [{ name: "Featured" }] }
          }
        ]
      };
    }
  }
};
