// app/context/SettingsModalContext.tsx
import React, { createContext, useContext, useState, useMemo, ReactNode } from 'react';

type SettingsOpenOptions = {
  showNotifications?: boolean;
};

type Ctx = {
  open: (options?: SettingsOpenOptions) => void;
  close: () => void;
  isOpen: boolean;
  revealNotificationsNonce: number;
};

const SettingsModalContext = createContext<Ctx>({
  open: () => {},
  close: () => {},
  isOpen: false,
  revealNotificationsNonce: 0,
});

type SettingsModalGlobals = {
  openHandler: ((options?: SettingsOpenOptions) => void) | null;
  pending: SettingsOpenOptions[];
};

const G = globalThis as any;

if (!G.__OVERLOOKED_SETTINGS_MODAL__) {
  G.__OVERLOOKED_SETTINGS_MODAL__ = {
    openHandler: null,
    pending: [],
  } as SettingsModalGlobals;
}

const settingsModalStore = G.__OVERLOOKED_SETTINGS_MODAL__ as SettingsModalGlobals;

export function openSettingsModal(options?: SettingsOpenOptions) {
  if (settingsModalStore.openHandler) {
    settingsModalStore.openHandler(options);
    return;
  }

  settingsModalStore.pending.push(options ?? {});
}

export function SettingsModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [revealNotificationsNonce, setRevealNotificationsNonce] = useState(0);

  const open = React.useCallback((options?: SettingsOpenOptions) => {
    if (options?.showNotifications) {
      setRevealNotificationsNonce((value) => value + 1);
    }

    setIsOpen(true);
  }, []);

  React.useEffect(() => {
    settingsModalStore.openHandler = open;

    if (settingsModalStore.pending.length) {
      const pending = [...settingsModalStore.pending];
      settingsModalStore.pending.length = 0;
      pending.forEach((options) => open(options));
    }

    return () => {
      if (settingsModalStore.openHandler === open) {
        settingsModalStore.openHandler = null;
      }
    };
  }, [open]);

  const value = useMemo(
    () => ({
      isOpen,
      revealNotificationsNonce,
      open,
      close: () => setIsOpen(false),
    }),
    [isOpen, open, revealNotificationsNonce]
  );

  return (
    <SettingsModalContext.Provider value={value}>
      {children}
    </SettingsModalContext.Provider>
  );
}

export function useSettingsModal() {
  return useContext(SettingsModalContext);
}
