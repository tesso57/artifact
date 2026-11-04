import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
	return (
		<Button
			variant="ghost"
			size="icon"
			aria-label="Toggle theme"
			onClick={() => {
				const dark = !document.documentElement.classList.contains("dark");
				document.documentElement.classList.toggle("dark", dark);
				try {
					localStorage.setItem("pi-theme", dark ? "dark" : "light");
				} catch {}
			}}
		>
			<Sun className="hidden dark:block" />
			<Moon className="dark:hidden" />
		</Button>
	);
}
