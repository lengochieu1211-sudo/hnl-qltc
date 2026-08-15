import React, { createContext, useContext, useState, useEffect } from 'react';
import { LanguageType, translations, getSavedLanguage } from '../utils/language';

interface LanguageContextType {
  language: LanguageType;
  setLanguage: (lang: LanguageType) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<LanguageType>('vi');

  useEffect(() => {
    document.documentElement.lang = 'vi';
  }, []);

  const setLanguage = (lang: LanguageType) => {
    setLanguageState('vi');
    document.documentElement.lang = 'vi';
  };

  const t = (key: string): string => {
    // @ts-ignore
    return translations['vi'][key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language: 'vi', setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    // Fallback safe dummy if used outside provider
    return {
      language: 'vi' as LanguageType,
      setLanguage: () => {},
      t: (key: string) => (translations['vi'] as any)?.[key] || key,
    };
  }
  return context;
};
