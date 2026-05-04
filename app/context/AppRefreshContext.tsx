// app/context/AppRefreshContext.tsx
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

type AppRefreshContextValue = {
  refreshKey: number;
  triggerAppRefresh: () => void;
};

const AppRefreshContext = createContext<AppRefreshContextValue | null>(null);

export function AppRefreshProvider({ children }: { children: React.ReactNode }) {
  const [refreshKey, setRefreshKey] = useState(0);

  const triggerAppRefresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  const value = useMemo(
    () => ({
      refreshKey,
      triggerAppRefresh,
    }),
    [refreshKey, triggerAppRefresh]
  );

  return (
    <AppRefreshContext.Provider value={value}>
      {children}
    </AppRefreshContext.Provider>
  );
}

export function useAppRefresh() {
  const ctx = useContext(AppRefreshContext);

  if (!ctx) {
    throw new Error('useAppRefresh must be used inside AppRefreshProvider');
  }

  return ctx;
}