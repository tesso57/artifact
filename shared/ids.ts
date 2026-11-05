// Browser-safe.

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Memory scope readable by every artifact; no artifact may use it as its id. */
export const SHARED_SCOPE = "shared";
/** Template previews run as `template-<name>`; artifacts may not take such ids. */
export const TEMPLATE_PREFIX = "template-";
const RESERVED_IDS = new Set([SHARED_SCOPE]);
const isReserved = (id: string) => RESERVED_IDS.has(id) || id.startsWith(TEMPLATE_PREFIX);

/** Artifact ids, memory scopes and template names: lowercase slug, max 64 chars. */
export function isValidId(id: unknown): id is string {
	return typeof id === "string" && ID_RE.test(id);
}

function assertValidId(id: unknown, what = "artifact id"): asserts id is string {
	if (!isValidId(id)) throw new Error(`Invalid ${what} ${JSON.stringify(id)}: use lowercase letters, digits and "-" (max 64)`);
}

export function assertArtifactId(id: unknown): asserts id is string {
	assertValidId(id);
	if (isReserved(id)) throw new Error(`"${id}" is reserved and cannot be an artifact id`);
}

/** Turn a title into a URL-safe slug (never a reserved id). */
export function slugify(input: string): string {
	const slug = input
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60)
		.replace(/-+$/g, "");
	if (!slug) return `artifact-${Date.now().toString(36)}`;
	return isReserved(slug) ? `artifact-${slug}`.slice(0, 64).replace(/-+$/g, "") : slug;
}
