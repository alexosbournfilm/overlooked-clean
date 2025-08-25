import { createNavigationContainerRef, CommonActions } from '@react-navigation/native';

export type RootStackParamList = {
  SignIn: undefined;
  SignUp: undefined;
  CheckEmail: undefined;
  CreateProfile: undefined;
  Main: undefined;
  Featured: undefined;
  Jobs: undefined;
  Challenge: undefined;
  Location: undefined;
  Chats: undefined;
  ChatRoom: { chatId: string; name: string };
  Profile: { user?: { id: string; full_name: string } } | { userId?: string } | undefined;
};

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigate<RouteName extends keyof RootStackParamList>(
  name: RouteName,
  params?: RootStackParamList[RouteName]
): void;

export function navigate(name: any, params?: any) {
  if (navigationRef.isReady()) {
    navigationRef.navigate(name, params);
  }
}

export function resetToMain() {
  if (navigationRef.isReady()) {
    navigationRef.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Main' }],
      })
    );
  }
}
