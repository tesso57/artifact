import { Plug, PlugZap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useMcpStatus } from "@pi/artifact";

export function McpBadge() {
	const { data } = useMcpStatus();
	if (!data?.connected) {
		return (
			<Badge variant="outline" className="text-muted-foreground" title="No pi session is connected; MCP calls will fail">
				<Plug /> pi offline
			</Badge>
		);
	}
	if (!data.ready) {
		return (
			<Badge variant="outline" title="pi is connected; MCP works after the agent uses an artifact tool in that session">
				<PlugZap className="text-amber-500" /> pi waiting
			</Badge>
		);
	}
	return (
		<Badge variant="outline" title="A pi session can run MCP tools">
			<PlugZap className="text-emerald-500" /> pi connected
		</Badge>
	);
}
