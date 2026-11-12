import { useEffect, useId, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { Markdown } from "./markdown";

/** A Markdown snapshot. Paths are unique and relative to the same document root. */
export interface MarkdownDocument {
	path: string;
	title: string;
	content: string;
}

const BASE = "https://markdown.invalid/";
const ORIGIN = new URL(BASE).origin;

function documentUrl(path: string): URL | undefined {
	try {
		// Document paths are filesystem-style names, not URL strings: encode literal
		// delimiters such as # and ? before resolving relative links against them.
		const url = new URL(path.split("/").map(encodeURIComponent).join("/"), BASE);
		return url.origin === ORIGIN ? url : undefined;
	} catch { return undefined; }
}

function pathKey(url: URL): string {
	try { return decodeURIComponent(url.pathname); } catch { return url.pathname; }
}

/** Display a collection of Markdown snapshots and navigate between relative .md links. */
export function MarkdownDocuments({ documents, initialPath, className }: { documents: readonly MarkdownDocument[]; initialPath?: string; className?: string }) {
	const id = useId();
	const [selected, setSelected] = useState(initialPath ?? documents[0]?.path);
	const [notice, setNotice] = useState("");
	const [section, setSection] = useState<{ hash: string; sequence: number } | null>(null);
	const content = useRef<HTMLDivElement>(null);
	const current = documents.find((document) => document.path === selected) ?? documents[0];
	useEffect(() => {
		if (!section) return;
		const focusDocument = () => {
			const heading = content.current?.querySelector<HTMLElement>("h1,h2,h3,h4,h5,h6") ?? content.current;
			if (heading) {
				heading.tabIndex = -1;
				heading.focus({ preventScroll: true });
				heading.scrollIntoView({ block: "start" });
			}
		};
		if (!section.hash) { focusDocument(); return; }
		let requested: string;
		try { requested = decodeURIComponent(section.hash.slice(1)); } catch { setNotice("The section link is invalid."); focusDocument(); return; }
		const used = new Set<string>();
		for (const heading of content.current?.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6") ?? []) {
			const base = (heading.textContent ?? "").trim().toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, "").replace(/\s/g, "-");
			let slug = base;
			for (let count = 1; used.has(slug); count++) slug = `${base}-${count}`;
			used.add(slug);
			if (slug !== requested) continue;
			heading.tabIndex = -1;
			heading.focus({ preventScroll: true });
			heading.scrollIntoView({ block: "start" });
			return;
		}
		setNotice("The linked section was not found.");
		focusDocument();
	}, [section, current?.path, current?.content]);
	if (!current) return <p className={cn("text-muted-foreground text-sm", className)}>No documents.</p>;

	const follow = (href: string) => {
		const base = documentUrl(current.path);
		let target: URL;
		try { target = new URL(href, base); } catch { setNotice("This document link is invalid."); return; }
		const match = documents.find((document) => { const url = documentUrl(document.path); return url && pathKey(url) === pathKey(target); });
		if (!match) { setSection(null); setNotice("The linked document is not included."); return; }
		setSelected(match.path);
		setNotice("");
		setSection({ hash: target.hash, sequence: (section?.sequence ?? 0) + 1 });
	};

	return <div className={cn("space-y-4", className)}>
		<div className="flex flex-wrap items-center gap-2 text-sm">
			<label htmlFor={id} className="font-medium">Document</label>
			<select id={id} value={current.path} onChange={(event) => { setSelected(event.target.value); setSection(null); setNotice(""); }} className="border-input bg-background min-w-0 max-w-full rounded-md border px-3 py-2">
				{documents.map((document) => <option key={document.path} value={document.path}>{document.title}</option>)}
			</select>
		</div>
		{notice && <p role="status" className="text-muted-foreground text-sm">{notice}</p>}
		<div ref={content}><Markdown onDocumentLink={follow}>{current.content}</Markdown></div>
	</div>;
}
