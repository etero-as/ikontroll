'use client';

import { createContext, useContext, useEffect, useState } from 'react';

import { getPreferredLocale, getSavedLocale, saveLocale } from '@/utils/localization';

interface LocaleContextValue {
  locale: string;
  setLocale: (locale: string) => void;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'no',
  setLocale: () => {},
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState('no');

  useEffect(() => {
    setLocaleState(getPreferredLocale(['no', 'en'], getSavedLocale()));
  }, []);

  const setLocale = (next: string) => {
    saveLocale(next);
    setLocaleState(next);
  };

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

export const useLocale = () => useContext(LocaleContext);

