// app/navigation/navigationRef.ts

import {
  CommonActions,
  createNavigationContainerRef,
  type NavigationContainerRef,
} from "@react-navigation/native";

/* =====================================================
   ROOT NAVIGATION TYPE DEFINITIONS
   ===================================================== */
export type RootStackParamList = {
  // ✅ ROOT AUTH STACK (AUTH SCREENS LIVE *INSIDE* THIS)
  Auth:
    | {
        screen?:
          | "SignIn"
          | "SignUp"
          | "ForgotPassword"
          | "CreateProfile"
          | "NewPassword";
        params?: any;
      }
    | undefined;

  // PASSWORD RESET (also accessible at root)
  NewPassword: undefined;

  // PAYFLOW
  Paywall: undefined;
  PaySuccess: undefined;

  // ROOT TABS
  MainTabs: undefined;

  // TAB SCREENS
  Featured: undefined;
  Jobs: undefined;
  Challenge: undefined;
  Workshop: undefined;
  Location: undefined;
  Chats: undefined;

  // PROFILE
  Profile:
    | { user?: { id: string; full_name: string } }
    | { userId?: string }
    | undefined;

  // (Optional) if you ever register ChatRoom at root, this keeps typing happy.
  ChatRoom: any;
};

export type ChatRoomParams = {
  conversationId?: string;
  conversation?: any;
  peerUser?: { id: string; full_name: string; avatar_url?: string | null };
};

/* =====================================================
   GLOBAL NAV STORE
   ===================================================== */
type NavGlobals = {
  ref: NavigationContainerRef<any>;
  ready: boolean;
  queue: Array<() => void>;
  patched: boolean;
  mountToken: number;
};

const G = globalThis as any;

if (!G.__OVERLOOKED_NAV__) {
  G.__OVERLOOKED_NAV__ = {
    ref: createNavigationContainerRef<RootStackParamList>(),
    ready: false,
    queue: [],
    patched: false,
    mountToken: 0,
  };
}

const store: NavGlobals = G.__OVERLOOKED_NAV__;

/* =====================================================
   PATCH REF FOR QUEUEING
   ===================================================== */
function patchRefForQueueing() {
  if (store.patched) return;
  const refAny = store.ref as any;

  if (refAny.__patched) return;

  const raw = {
    navigate: refAny.navigate.bind(refAny),
    dispatch: refAny.dispatch.bind(refAny),
    goBack: refAny.goBack.bind(refAny),
    canGoBack: refAny.canGoBack.bind(refAny),
  };

  function enqueue(action: () => void, name: string, args: any[]) {
    if (store.ready && store.ref.isReady()) action();
    else {
      console.warn(`[nav] queued: ${name}`, args);
      store.queue.push(action);
    }
  }

  refAny.navigate = (...args: any[]) =>
    enqueue(() => raw.navigate(...args), "navigate", args);

  refAny.dispatch = (...args: any[]) =>
    enqueue(() => raw.dispatch(...args), "dispatch", args);

  refAny.goBack = (...args: any[]) =>
    enqueue(() => {
      if (raw.canGoBack()) raw.goBack(...args);
    }, "goBack", args);

  refAny.__patched = true;
  store.patched = true;
}

patchRefForQueueing();

/* =====================================================
   EXPORTS
   ===================================================== */
export const navigationRef = store.ref;

export function setNavigatorReady(ready: boolean) {
  store.ready = ready;
  if (ready && store.ref.isReady() && store.queue.length) {
    const queued = [...store.queue];
    store.queue.length = 0;
    queued.forEach((fn) => fn());
  }
}

export function navigate<RouteName extends keyof RootStackParamList>(
  name: RouteName,
  params?: RootStackParamList[RouteName]
) {
  store.ref.navigate(name as any, params as any);
}

export function resetToMain() {
  store.ref.dispatch(
    CommonActions.reset({
      index: 0,
      routes: [{ name: "MainTabs" }],
    })
  );
}

/* =====================================================
   CHAT HELPER (FIXES YOUR ProfileScreen IMPORT ERROR)
   ===================================================== */
export function openChat(params: ChatRoomParams) {
  // Most apps have ChatRoom inside the Chats stack.
  // This works whether Chats is a stack or tab-stack.
  try {
    store.ref.navigate("Chats" as any, {
      screen: "ChatRoom",
      params,
    });
  } catch (e) {
    // Fallback: if ChatRoom exists at root in some builds
    try {
      store.ref.navigate("ChatRoom" as any, params as any);
    } catch (err) {
      console.warn("[nav] openChat failed", err);
    }
  }
}
