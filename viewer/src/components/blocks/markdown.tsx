import { createContext, useContext, type ComponentProps } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../../lib/utils";

const TaskLabel = createContext<string | undefined>(undefined);
const DocumentLink = createContext<((href: string) => void) | undefined>(undefined);

function taskText(node: unknown): string {
	if (!node || typeof node !== "object") return "";
	const item = node as { type?: string; value?: unknown; tagName?: string; children?: unknown[]; properties?: { alt?: unknown } };
	if (item.type === "text") return typeof item.value === "string" ? item.value : "";
	if (item.tagName === "ul" || item.tagName === "ol" || item.tagName === "input") return "";
	if (item.tagName === "img") return typeof item.properties?.alt === "string" ? item.properties.alt : "";
	return (item.children ?? []).map(taskText).join("");
}

function MarkdownInput(props: ComponentProps<"input">) {
	const label = useContext(TaskLabel);
	return <input {...props} aria-label={props.type === "checkbox" ? label : undefined} />;
}

function MarkdownAnchor({ href, children, ...props }: ComponentProps<"a">) {
	const onDocumentLink = useContext(DocumentLink);
	const path = href?.split(/[?#]/, 1)[0] ?? "";
	const localDocument = onDocumentLink && href && (href.startsWith("#") && href.length > 1 || !/^(?:\/|[a-z][a-z0-9+.-]*:)/i.test(href) && /(?:\.md|%2emd)$/i.test(path));
	if (localDocument) return <button type="button" title={props.title} className="text-primary cursor-pointer underline underline-offset-4" onClick={() => onDocumentLink(href)}>{children}</button>;
	return <a className="text-primary underline underline-offset-4" href={href} {...props}>{children}</a>;
}

const MARKDOWN_COMPONENTS: Components = {
	h1: ({ node: _node, ...props }) => <h1 className="mt-8 mb-4 text-3xl font-semibold tracking-tight first:mt-0" {...props} />,
	h2: ({ node: _node, ...props }) => <h2 className="mt-8 mb-3 border-b pb-2 text-2xl font-semibold tracking-tight" {...props} />,
	h3: ({ node: _node, ...props }) => <h3 className="mt-6 mb-2 text-lg font-semibold" {...props} />,
	h4: ({ node: _node, ...props }) => <h4 className="mt-6 mb-2 text-base font-semibold" {...props} />,
	h5: ({ node: _node, ...props }) => <h5 className="mt-5 mb-2 text-sm font-semibold" {...props} />,
	h6: ({ node: _node, ...props }) => <h6 className="text-muted-foreground mt-5 mb-2 text-sm font-semibold" {...props} />,
	p: ({ node: _node, ...props }) => <p className="my-4" {...props} />,
	a: ({ node: _node, ...props }) => <MarkdownAnchor {...props} />,
	ul: ({ node: _node, className, ...props }) => <ul className={cn("my-4 list-disc space-y-1 pl-6", className)} {...props} />,
	ol: ({ node: _node, className, ...props }) => <ol className={cn("my-4 list-decimal space-y-1 pl-6", className)} {...props} />,
	li: ({ node, className, children, ...props }) => {
		const task = className?.split(/\s+/).includes("task-list-item");
		const label = task ? taskText(node).replace(/\s+/g, " ").trim() || "Task" : undefined;
		return <li className={cn(className, task && "list-none")} {...props}><TaskLabel.Provider value={label}>{children}</TaskLabel.Provider></li>;
	},
	input: ({ node: _node, ...props }) => <MarkdownInput {...props} />,
	blockquote: ({ node: _node, ...props }) => <blockquote className="text-muted-foreground my-4 border-l-2 pl-4 italic" {...props} />,
	pre: ({ node: _node, ...props }) => <pre role="region" aria-label="Markdown code block" tabIndex={0} className="bg-muted focus-visible:ring-ring my-4 overflow-x-auto rounded-lg p-4 text-xs leading-6 focus-visible:ring-2 focus-visible:outline-none" {...props} />,
	code: ({ node: _node, className, ...props }) => <code className={cn("bg-muted rounded px-1 py-0.5 font-mono text-[0.9em]", className)} {...props} />,
	img: ({ node: _node, ...props }) => <img className="h-auto max-w-full rounded-md" {...props} />,
	table: ({ node: _node, ...props }) => <div role="region" aria-label="Markdown table" tabIndex={0} className="focus-visible:ring-ring my-4 overflow-x-auto focus-visible:ring-2 focus-visible:outline-none"><table className="w-full border-collapse text-left" {...props} /></div>,
	th: ({ node: _node, ...props }) => <th className="bg-muted border px-3 py-2 font-semibold" {...props} />,
	td: ({ node: _node, ...props }) => <td className="border px-3 py-2" {...props} />,
	hr: ({ node: _node, ...props }) => <hr className="border-border my-6" {...props} />,
};

/** Render Markdown and GitHub-flavored tables, task lists and strikethrough; raw HTML is ignored. */
export function Markdown({ children, className, onDocumentLink }: { children: string; className?: string; onDocumentLink?: (href: string) => void }) {
	return <div className={cn("space-y-4 text-sm leading-7 break-words", className)}>
		<DocumentLink.Provider value={onDocumentLink}>
			<ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={MARKDOWN_COMPONENTS}>{children}</ReactMarkdown>
		</DocumentLink.Provider>
	</div>;
}
