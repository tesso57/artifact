import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * The viewer daemon keeps browser sessions in memory, so a restart (idle exit, update)
 * signs open tabs out. Say so plainly instead of failing every request.
 */
export function SessionBanner() {
	const [signedOut, setSignedOut] = useState(false);
	useEffect(() => {
		const check = () =>
			fetch("/__pi/session", { cache: "no-store" })
				.then((r) => setSignedOut(r.status === 401))
				.catch(() => setSignedOut(true));
		const timer = setInterval(check, 15_000);
		window.addEventListener("focus", check);
		return () => {
			clearInterval(timer);
			window.removeEventListener("focus", check);
		};
	}, []);
	if (!signedOut) return null;
	return (
		<div role="alert" className="bg-destructive text-white sticky top-0 z-50 flex items-center gap-2 px-4 py-2 text-sm">
			<TriangleAlert className="size-4" />
			The artifact viewer restarted or stopped. Run <code className="font-mono">/artifacts</code> in pi to open it again.
		</div>
	);
}
