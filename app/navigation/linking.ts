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
      // ROOT SCREENS
      NewPassword: "reset-password",

      // AUTH STACK
      Auth: {
        screens: {
          SignIn: "signin",
          SignUp: "signup",
          ForgotPassword: "forgot-password",
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

      PublicProfile: {
        path: "creative/:slug",
        parse: {
          slug: (value: string) => decodeURIComponent(value),
        },
      },

      Paywall: "paywall",
      PaySuccess: "pay-success",
    },
  },
};