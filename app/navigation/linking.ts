// app/navigation/linking.ts
import { LinkingOptions } from "@react-navigation/native";

export const linking: LinkingOptions<any> = {
  prefixes: [
    "https://overlooked.cloud",
    "https://www.overlooked.cloud",
    "overlooked://",
  ],

  config: {
    screens: {
      // DIRECT screen — must exist here!
      NewPassword: "reset-password",

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
          Featured: "featured",
          Jobs: "jobs",
          Challenge: "challenge",
          Location: "location",
          Chats: "chats",
          Profile: "profile",
        },
      },

      // OPTIONAL ROUTES SO TS DOESN’T COMPLAIN
      Paywall: "paywall",
      PaySuccess: "pay-success",
    },
  },
};
