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
      NewPassword: "reset-password",
      CreateProfile: "create-profile",

      Auth: {
        screens: {
          SignIn: "signin",
          SignUp: "signup",
          ForgotPassword: "forgot-password",
        },
      },

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

      PublicProfile: {
        path: "creative/:slug",
        parse: {
          slug: (value: string) => decodeURIComponent(value),
        },
      },

      SharedFilm: {
        path: "f/:shareSlug",
        parse: {
          shareSlug: (value: string) => decodeURIComponent(value),
        },
      },

      Paywall: "paywall",
      PaySuccess: "pay-success",
      PrivacyPolicy: "privacy",
    },
  },
};
