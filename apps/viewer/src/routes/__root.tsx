import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import styles from "../styles.css?url";

const themeScript = `(()=>{try{const t=localStorage.getItem("pi-theme");const d=t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d)}catch{}})()`;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "pi artifacts" },
		],
		links: [{ rel: "stylesheet", href: styles }],
	}),
	component: RootComponent,
});

function RootComponent() {
	const { queryClient } = Route.useRouteContext();
	return (
		<RootDocument>
			<QueryClientProvider client={queryClient}>
				<Outlet />
			</QueryClientProvider>
		</RootDocument>
	);
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: sets the theme before paint */}
				<script dangerouslySetInnerHTML={{ __html: themeScript }} />
				<HeadContent />
			</head>
			<body className="min-h-dvh">
				{children}
				<Scripts />
			</body>
		</html>
	);
}
