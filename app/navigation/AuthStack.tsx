// app/navigation/AuthStack.tsx
import React from "react";
import { createStackNavigator } from "@react-navigation/stack";

import SignInScreen from "../screens/SignInScreen";
import SignUpScreen from "../screens/SignUpScreen";
import ForgotPasswordScreen from "../screens/ForgotPassword";
import { useAppTheme } from "../context/ThemeContext";
import { getOverlookedStackScreenOptions } from "./transitions";

const Stack = createStackNavigator();

type AuthStackProps = {
  initialRouteName?: "SignIn";
};

export default function AuthStack({ initialRouteName = "SignIn" }: AuthStackProps) {
  const { colors } = useAppTheme();

  return (
    <Stack.Navigator
      initialRouteName={initialRouteName}
      screenOptions={getOverlookedStackScreenOptions(colors.background)}
    >
      <Stack.Screen name="SignIn" component={SignInScreen} />
      <Stack.Screen name="SignUp" component={SignUpScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </Stack.Navigator>
  );
}
