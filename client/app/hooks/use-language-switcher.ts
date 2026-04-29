import { useEffect, useState } from "react";

export function useLanguageSwitcher() {
  const [language, setLanguage] = useState<string>(() => {
    if (typeof window === "undefined") return "en";
    return localStorage.getItem("language") || "en";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("language", language);
    document.documentElement.lang = language;
  }, [language]);

  const changeLanguage = (newLanguage: string) => {
    setLanguage(newLanguage);
  };

  return { language, changeLanguage };
}

