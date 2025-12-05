// app/navigation/AuthStack.tsx
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import SignInScreen from "../screens/SignInScreen";
import SignUpScreen from "../screens/SignUpScreen";
import ForgotPasswordScreen from "../screens/ForgotPassword";
import CreateProfileScreen from "../screens/CreateProfileScreen";
import NewPassword from "../screens/NewPassword";

const Stack = createNativeStackNavigator();

type AuthStackProps = {
  initialRouteName: "SignIn" | "CreateProfile";
};

export default function AuthStack({ initialRouteName }: AuthStackProps) {
  return (
    <Stack.Navigator
      initialRouteName={initialRouteName}
      screenOptions={{ headerShown: false }}
    >
      {/* Authentication flow */}
      <Stack.Screen name="SignIn" component={SignInScreen} />
      <Stack.Screen name="SignUp" component={SignUpScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />

      {/* ⭐ Critical — must be accessible independently */}
      <Stack.Screen name="NewPassword" component={NewPassword} />

      {/* Create profile */}
      <Stack.Screen name="CreateProfile" component={CreateProfileScreen} />
    </Stack.Navigator>
  );
}
