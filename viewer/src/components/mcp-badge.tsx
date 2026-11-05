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
	return (
		<Badge variant="outline" title="A pi session is connected">
			<PlugZap className="text-emerald-500" /> pi connected
		</Badge>
	);
}
