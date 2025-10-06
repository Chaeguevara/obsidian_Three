import { App, CachedMetadata } from "obsidian";

export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

export type GraphNodeKind = "file" | "tag";

export interface GraphNode {
	id: string;
	path: string;
	label: string;
	position: Vec3;
	tags: string[];
	kind: GraphNodeKind;
}

export interface GraphEdge {
	sourceId: string;
	targetId: string;
	weight: number;
}

export interface GraphSnapshot {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

export function collectGraphSnapshot(app: App): GraphSnapshot {
	const files = app.vault.getMarkdownFiles();
	const nodeMap = new Map<string, GraphNode>();
	const fileTagsMap = new Map<string, string[]>();
	const tagSet = new Set<string>();

	const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));
	sortedFiles.forEach((file) => {
		const tags = collectFileTags(app.metadataCache.getFileCache(file));
		fileTagsMap.set(file.path, tags);
		tags.forEach((tag) => tagSet.add(tag));
	});

	const sortedTags = Array.from(tagSet).sort((a, b) => a.localeCompare(b));
	const totalNodes = sortedFiles.length + sortedTags.length;
	const positions = fibonacciSphere(totalNodes);
	let positionIndex = 0;

	sortedFiles.forEach((file) => {
		nodeMap.set(file.path, {
			id: file.path,
			path: file.path,
			label: file.basename,
			position: positions[positionIndex++] ?? { x: 0, y: 0, z: 0 },
			tags: fileTagsMap.get(file.path) ?? [],
			kind: "file",
		});
	});

	sortedTags.forEach((tag) => {
		const id = tagNodeId(tag);
		nodeMap.set(id, {
			id,
			path: `#${tag}`,
			label: `#${tag}`,
			position: positions[positionIndex++] ?? { x: 0, y: 0, z: 0 },
			tags: [tag],
			kind: "tag",
		});
	});

	const edgeMap = new Map<string, GraphEdge>();
	const resolvedLinks = app.metadataCache.resolvedLinks;

	Object.entries(resolvedLinks).forEach(([sourcePath, targets]) => {
		if (!nodeMap.has(sourcePath)) {
			return;
		}

		Object.entries(targets).forEach(([targetPath, weight]) => {
			if (!nodeMap.has(targetPath)) {
				return;
			}

			if (sourcePath === targetPath) {
				return;
			}

			const [from, to] = sortPair(sourcePath, targetPath);
			const key = `${from}::${to}`;
			const existing = edgeMap.get(key);
			if (existing) {
				existing.weight += weight;
				return;
			}

			edgeMap.set(key, {
				sourceId: from,
				targetId: to,
				weight,
			});
		});
	});

	const tagEdges: GraphEdge[] = [];
	for (const [filePath, tags] of fileTagsMap.entries()) {
		for (const tag of tags) {
			const tagId = tagNodeId(tag);
			if (!nodeMap.has(tagId)) {
				continue;
			}
			tagEdges.push({
				sourceId: filePath,
				targetId: tagId,
				weight: 1,
			});
		}
	}

	const edges = [
		...edgeMap.values(),
		...tagEdges,
	].sort((a, b) => {
		if (a.sourceId !== b.sourceId) {
			return a.sourceId.localeCompare(b.sourceId);
		}
		if (a.targetId !== b.targetId) {
			return a.targetId.localeCompare(b.targetId);
		}
		return a.weight - b.weight;
	});

	return {
		nodes: Array.from(nodeMap.values()),
		edges,
	};
}

function sortPair(a: string, b: string): [string, string] {
	return a < b ? [a, b] : [b, a];
}

function tagNodeId(tag: string): string {
	return `tag::${tag}`;
}

function collectFileTags(cache: CachedMetadata | null): string[] {
	if (!cache) {
		return [];
	}

	const tags = new Set<string>();
	if (Array.isArray(cache.tags)) {
		for (const entry of cache.tags) {
			if (!entry?.tag) {
				continue;
			}
			addTagValue(tags, entry.tag);
		}
	}

	const frontmatter = cache.frontmatter;
	if (frontmatter) {
		const frontmatterTags = frontmatter.tags ?? frontmatter.tag;
		addTagValue(tags, frontmatterTags);
	}

	return Array.from(tags).sort((a, b) => a.localeCompare(b));
}

function addTagValue(target: Set<string>, value: unknown) {
	if (!value) {
		return;
	}

	if (typeof value === "string") {
		const tag = normalizeTag(value);
		if (tag) {
			target.add(tag);
		}
		return;
	}

	if (Array.isArray(value)) {
		for (const entry of value) {
			addTagValue(target, entry);
		}
	}
}

function normalizeTag(tag: string): string {
	const trimmed = tag.trim();
	if (!trimmed) {
		return "";
	}
	return trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
}

function fibonacciSphere(count: number): Vec3[] {
	if (count <= 0) {
		return [];
	}

	if (count === 1) {
		return [{ x: 0, y: 0, z: 0 }];
	}

	const result: Vec3[] = [];
	const goldenAngle = Math.PI * (3 - Math.sqrt(5));

	for (let i = 0; i < count; i++) {
		const t = i / (count - 1);
		const y = 1 - 2 * t;
		const radius = Math.sqrt(Math.max(0, 1 - y * y));
		const theta = goldenAngle * i;
		const x = Math.cos(theta) * radius;
		const z = Math.sin(theta) * radius;
		result.push({ x, y, z });
	}

	return result;
}
