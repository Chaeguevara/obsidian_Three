import { App } from "obsidian";

export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

export interface GraphNode {
	id: string;
	path: string;
	label: string;
	position: Vec3;
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

	const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));
	const positions = fibonacciSphere(sortedFiles.length);
	sortedFiles.forEach((file, index) => {
		nodeMap.set(file.path, {
			id: file.path,
			path: file.path,
			label: file.basename,
			position: positions[index] ?? { x: 0, y: 0, z: 0 },
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

	return {
		nodes: Array.from(nodeMap.values()),
		edges: Array.from(edgeMap.values()).sort((a, b) => {
			if (a.sourceId !== b.sourceId) {
				return a.sourceId.localeCompare(b.sourceId);
			}
			if (a.targetId !== b.targetId) {
				return a.targetId.localeCompare(b.targetId);
			}
			return a.weight - b.weight;
		}),
	};
}

function sortPair(a: string, b: string): [string, string] {
	return a < b ? [a, b] : [b, a];
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
