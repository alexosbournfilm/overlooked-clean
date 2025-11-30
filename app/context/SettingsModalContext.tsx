// app/context/SettingsModalContext.tsx
import React, { createContext, useContext, useState, useMemo, ReactNode } from 'react';

type Ctx = {
  open: () => void;
  close: () => void;
  isOpen: boolean;
};

const SettingsModalContext = createContext<Ctx>({
  open: () => {},
  close: () => {},
  isOpen: false,
});

export function SettingsModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const value = useMemo(
    () => ({
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
    }),
    [isOpen]
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
