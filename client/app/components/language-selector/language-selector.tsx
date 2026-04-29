import { ChevronDown } from "lucide-react";
import { useLanguageSwitcher } from "@/hooks/use-language-switcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui-kits/dropdown-menu/dropdown-menu";

const languages = [
  { key: "en", title: "English" },
  { key: "de", title: "German" },
  { key: "fr", title: "French" },
];

export function LanguageSelector() {
  const { changeLanguage, language } = useLanguageSwitcher();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative z-50 pointer-events-auto flex cursor-pointer items-center gap-1 text-sm font-medium uppercase"
        >
          <span>{language}</span>
          <ChevronDown className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {languages.map((lang, index) => (
          <div key={lang.key}>
            <DropdownMenuItem
              className={lang.key === language ? "font-semibold" : ""}
              onClick={() => changeLanguage(lang.key)}
              disabled={lang.key !== "en"}
            >
              {lang.title}
            </DropdownMenuItem>
            {index !== languages.length - 1 && <DropdownMenuSeparator />}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
