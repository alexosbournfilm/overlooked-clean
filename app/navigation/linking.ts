import { LinkingOptions } from "@react-navigation/native";

export const linking: LinkingOptions<any> = {
  prefixes: [
    "https://overlooked.cloud",
    "https://www.overlooked.cloud",

    "overlooked://callback",
    "overlooked://reset-password",
    "overlooked://",

    "http://localhost:3000",
    "exp://localhost:19000",
  ],

  config: {
    screens: {
      // ====================================================
      // TOP LEVEL SCREENS
      // ====================================================
      NewPassword: "reset-password",

      // ====================================================
      // AUTH WRAPPER (must be declared!!)
      // ====================================================
      Auth: {
        screens: {
          SignIn: "signin",
          SignUp: "signup",
          ForgotPassword: "forgot-password",
          CreateProfile: "create-profile",
        },
      },

      // ====================================================
      // MAIN APP
      // ====================================================
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

      // ====================================================
      // OTHER ROUTES
      // ====================================================
      ChatRoom: "chats/:id",
      UserProfile: "u/:id",
      PaySuccess: "pay/success",
    },
  },

  // fallback safe parser
  getStateFromPath(path, options) {
    try {
      const { getStateFromPath } = require("@react-navigation/native");
      return getStateFromPath(path, options);
    } catch (e) {
      console.warn("[linking] Failed to parse URL:", path, e);
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
