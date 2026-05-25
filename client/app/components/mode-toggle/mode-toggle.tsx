import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui-kits/button/button";
import { useTheme } from "@/hooks/use-theme";

export function ModeToggle() {
  const { setTheme, resolvedTheme } = useTheme();

  return (
    <Button
      onClick={() => setTheme(resolvedTheme === "light" ? "dark" : "light")}
      variant="ghost"
      size="icon"
      className="h-9 w-9 rounded-full border border-transparent text-muted-foreground transition-all hover:border-input hover:bg-accent hover:text-accent-foreground hover:shadow-sm"
    >
      <Moon className="aspect-square w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Sun className="absolute aspect-square w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
