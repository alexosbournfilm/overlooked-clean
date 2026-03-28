// app/navigation/linking.ts
import { LinkingOptions } from "@react-navigation/native";

export const linking: LinkingOptions<any> = {
  prefixes: [
    "https://overlooked.cloud",
    "https://www.overlooked.cloud",
    "overlooked://",
    "http://localhost:8081",
    "http://localhost:19006",
    "http://localhost:3000",
  ],

  config: {
    screens: {
      // DIRECT screens
      NewPassword: "reset-password",
      PublicProfile: "creative/:slug",

      // ✅ NEW SHARED FILM LINK
    

      // AUTH STACK
      Auth: {
        screens: {
          SignIn: "signin",
          SignUp: "signup",
          ForgotPassword: "forgot-password",
          CreateProfile: "create-profile",
        },
      },

      // MAIN TABS
      MainTabs: {
        screens: {
          Featured: {
  path: "f/:openShareSlug",
  parse: {
    openShareSlug: (value: string) => decodeURIComponent(value),
  },
},
          Jobs: "jobs",
          Challenge: "challenge",
          Location: "location",
          Chats: "chats",
          Profile: "profile",
        },
      },

      // OPTIONAL ROUTES
      Paywall: "paywall",
      PaySuccess: "pay-success",
    },
  },
};