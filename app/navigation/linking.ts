// app/navigation/linking.ts
import { LinkingOptions } from "@react-navigation/native";

export const linking: LinkingOptions<any> = {
  prefixes: [
    "https://overlooked.cloud",
    "https://www.overlooked.cloud",

    // Supabase reset flows
    "https://overlooked.cloud/auth/v1/verify",
    "https://overlooked.cloud/auth/confirm",

    // Optional clean reset route
    "https://overlooked.cloud/reset-password",

    // Mobile
    "overlooked://",
    "overlooked://reset-password",

    // Dev
    "http://localhost:3000",
    "exp://localhost:19000",
  ],

  config: {
    screens: {
      /* -----------------------------------------------------------
         🔐 Recovery URLs → Recovery screen
         MUST MATCH AppNavigator route: name="Recovery"
      ----------------------------------------------------------- */
      Recovery: {
        path: "reset-password",
        parse: {
          access_token: (v: string) => v,
          refresh_token: (v: string) => v,
          type: (v: string) => v,
        },
      },

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

  // Safe fallback
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
