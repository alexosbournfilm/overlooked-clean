type Listener = () => void;

const listeners = new Set<Listener>();

export const subscribeChatBadgeRefresh = (listener: Listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const emitChatBadgeRefresh = () => {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (e) {
      console.error('chat badge listener error:', e);
    }
  });
};