import { Plug, PlugZap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useMcpStatus } from "@pi/artifact";

export function McpBadge() {
	const { data } = useMcpStatus();
	if (!data?.connected) {
		return (
			<Badge variant="outline" className="text-muted-foreground" title="Start the viewer from pi to use MCP">
				<Plug /> pi offline
			</Badge>
		);
	}
	return (
		<Badge
			variant="outline"
			title={data.ready ? "MCP tools available" : "Connected; MCP becomes available after the agent writes an artifact"}
		>
			<PlugZap className={data.ready ? "text-emerald-500" : "text-amber-500"} /> pi {data.ready ? "connected" : "waiting"}
		</Badge>
	);
}
