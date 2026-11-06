/**
 * Template: diagram explainer — Mermaid diagrams (architecture, sequence, state) in tabs,
 * each with a caption and its source. The tab is remembered in memory.
 *
 * Adapt: replace DIAGRAMS. Keep one idea per diagram, 5–12 nodes, short labels; put detail
 * in the caption, not in the boxes.
 */
import { useMemory } from "@pi/artifact";
import { DiagramCard, Page, PageHeader, Section } from "@/components/blocks";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const CONFIG = { title: "How checkout works", description: "From the cart to a confirmed order." };

const DIAGRAMS = [
	{
		id: "architecture",
		label: "Architecture",
		caption: "The web app talks to one API; payments and email are external services.",
		chart: `flowchart LR
  user([Customer]) --> web[Web app]
  web --> api[Orders API]
  api --> db[(Postgres)]
  api --> pay[[Payment provider]]
  api --> queue{{Job queue}}
  queue --> mail[[Email service]]`,
	},
	{
		id: "sequence",
		label: "Request flow",
		caption: "Payment is confirmed before the order is stored; the email is sent asynchronously.",
		chart: `sequenceDiagram
  actor C as Customer
  participant W as Web app
  participant A as Orders API
  participant P as Payments
  C->>W: Place order
  W->>A: POST /orders
  A->>P: Charge card
  P-->>A: Approved
  A->>A: Save order
  A-->>W: 201 Created
  W-->>C: Confirmation page
  A-)A: Queue confirmation email`,
	},
	{
		id: "states",
		label: "Order states",
		caption: "Orders only move forward; a refund is a separate state, not a rollback.",
		chart: `stateDiagram-v2
  [*] --> Pending
  Pending --> Paid: payment approved
  Pending --> Cancelled: payment failed
  Paid --> Shipped
  Shipped --> Delivered
  Delivered --> Refunded: return accepted
  Cancelled --> [*]
  Refunded --> [*]
  Delivered --> [*]`,
	},
] as const;

export default function DiagramExplainer() {
	const [tab, setTab] = useMemory<string>("tab", DIAGRAMS[0].id);
	return (
		<Page width="lg">
			<PageHeader eyebrow="Diagrams" title={CONFIG.title} description={CONFIG.description} />
			<Tabs value={tab} onValueChange={setTab}>
				<TabsList>
					{DIAGRAMS.map((d) => (
						<TabsTrigger key={d.id} value={d.id}>
							{d.label}
						</TabsTrigger>
					))}
				</TabsList>
				{DIAGRAMS.map((d) => (
					<TabsContent key={d.id} value={d.id} className="mt-4">
						<Section>
							<DiagramCard title={d.label} description={d.caption} chart={d.chart} />
							<details className="text-sm">
								<summary className="text-muted-foreground cursor-pointer">Mermaid source</summary>
								<pre className="bg-muted mt-2 overflow-x-auto rounded-md p-3 font-mono text-xs">{d.chart}</pre>
							</details>
						</Section>
					</TabsContent>
				))}
			</Tabs>
		</Page>
	);
}
