import { LinkingOptions } from "@react-navigation/native";

export const linking: LinkingOptions<any> = {
  prefixes: [
    // Web
    "https://overlooked.cloud",
    "https://www.overlooked.cloud",

    // Mobile schemes
    "overlooked://",
    "overlooked://callback",
    "overlooked://reset-password",

    // Dev
    "http://localhost:3000",
    "exp://localhost:19000"
  ],

  config: {
    screens: {
      // ⭐ DIRECT ROUTE FOR PASSWORD RESET
      NewPassword: "reset-password",

      // ⭐ AUTH STACK MUST BE DECLARED AS A GROUP
      Auth: {
        screens: {
          SignIn: "signin",
          SignUp: "signup",
          ForgotPassword: "forgot-password",
          CreateProfile: "create-profile",
        },
      },

      // MAIN APP
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

  // SAFETY FALLBACK
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
            state: { routes: [{ name: "Featured" }] }
          }
        ]
      };
    }
  }
};
