import { ItemView, WorkspaceLeaf } from "obsidian";
import ForceGraph3D from "3d-force-graph";
import type { PerspectiveCamera } from "three";
import { collectGraphSnapshot, GraphSnapshot } from "./graph-data";

export const VIEW_TYPE_THREE_JS = "threejs-demo";

type ForceGraphBuilder = ReturnType<typeof ForceGraph3D>;
type ForceGraphInstance = ReturnType<ForceGraphBuilder>;

interface ForceGraphNode {
	readonly id: string;
	readonly label: string;
	readonly path: string;
	readonly val: number;
}

interface ForceGraphLink {
	readonly source: string;
	readonly target: string;
	readonly weight: number;
}

type OrbitControlsLike = {
	enableDamping?: boolean;
	dampingFactor?: number;
	minDistance?: number;
	maxDistance?: number;
};

export class ThreeJsView extends ItemView {
	private graph: ForceGraphInstance | null = null;
	private container: HTMLElement | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private refreshTimeout: number | null = null;
	private currentSnapshotHash: string | null = null;
	private pendingZoomToFit = false;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_THREE_JS;
	}

	getDisplayText(): string {
		return "Vault 3D graph";
	}

	getIcon(): string {
		return "dice";
	}

	async onOpen() {
		this.contentEl.empty();
		this.contentEl.addClass("threejs-view");

		const container = this.contentEl.createDiv({ cls: "threejs-force-graph" });
		container.style.width = "100%";
		container.style.height = "100%";
		this.container = container;

		const graphBuilder = ForceGraph3D();
		const graph = graphBuilder(container);
		overrideTickFrame(graph);
		try {
			graph.pauseAnimation();
		} catch (error) {
			console.debug("3D graph: pause animation during init failed", error);
		}
		this.graph = graph;
		console.debug("3D graph: force instance created");

		graph
			.backgroundColor("#101018")
			.nodeRelSize(6)
			.nodeLabel((node: ForceGraphNode) => `${node.label}\n${node.path}`)
			.nodeVal((node: ForceGraphNode) => node.val)
			.nodeColor(() => "#8ab4ff")
			.linkOpacity(0.32)
			.linkColor(() => "#4c82ff")
			.linkWidth((link: ForceGraphLink) =>
				Math.max(0.4, Math.log((link.weight ?? 1) + 1))
			);

		const controls = graph.controls() as OrbitControlsLike | undefined;
		if (controls) {
			controls.enableDamping = true;
			controls.dampingFactor = 0.1;
			controls.minDistance = 2;
			controls.maxDistance = 200;
		}

		graph.onEngineStop(() => {
			if (this.pendingZoomToFit) {
				this.pendingZoomToFit = false;
				graph.zoomToFit(400, 40);
			}
		});

		this.resizeGraph();
		this.resizeObserver = new ResizeObserver(() => this.resizeGraph());
		this.resizeObserver.observe(this.contentEl);
		this.registerDomEvent(window, "resize", () => this.resizeGraph());

		this.registerDataListeners();
		this.rebuildGraph(true);
	}

	async onClose() {
		if (this.refreshTimeout !== null) {
			window.clearTimeout(this.refreshTimeout);
			this.refreshTimeout = null;
		}

		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}

		if (this.graph) {
			try {
				this.graph.pauseAnimation();
			} catch (error) {
				console.warn("Failed to pause graph animation", error);
			}
			const scene = this.graph.scene() as { clear?: () => void } | undefined;
			if (scene?.clear) {
				scene.clear();
			}
		}

		this.graph = null;
		this.container = null;
		this.currentSnapshotHash = null;
		this.pendingZoomToFit = false;

		this.contentEl.empty();
		this.contentEl.removeClass("threejs-view");
	}

	private registerDataListeners() {
		this.registerEvent(
			this.app.metadataCache.on("resolved", () => this.scheduleGraphRefresh())
		);
		this.registerEvent(
			this.app.metadataCache.on("changed", () => this.scheduleGraphRefresh())
		);
		this.registerEvent(
			this.app.vault.on("create", () => this.scheduleGraphRefresh())
		);
		this.registerEvent(
			this.app.vault.on("rename", () => this.scheduleGraphRefresh())
		);
		this.registerEvent(
			this.app.vault.on("delete", () => this.scheduleGraphRefresh())
		);
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () =>
				this.scheduleGraphRefresh()
			)
		);
	}

	private scheduleGraphRefresh() {
		if (this.refreshTimeout !== null) {
			window.clearTimeout(this.refreshTimeout);
		}

		console.debug("3D graph: scheduling rebuild");
		this.refreshTimeout = window.setTimeout(() => {
			this.refreshTimeout = null;
			this.rebuildGraph();
		}, 250);
	}

	private rebuildGraph(forceZoom = false) {
		if (!this.graph) {
			console.error("3D graph: rebuild requested before graph initialised");
			return;
		}

		const snapshot = collectGraphSnapshot(this.app);
		const hash = snapshotHash(snapshot);
		if (!forceZoom && this.currentSnapshotHash === hash) {
			return;
		}

		this.pendingZoomToFit = forceZoom || this.currentSnapshotHash === null;
		this.currentSnapshotHash = hash;
		console.debug("3D graph: rebuilding", {
			nodes: snapshot.nodes.length,
			links: snapshot.edges.length,
			forceZoom: this.pendingZoomToFit,
		});
		if (snapshot.nodes.length === 0) {
			console.warn("3D graph: vault snapshot contains no markdown notes");
		}
		this.updateGraphData(snapshot);
	}

	private updateGraphData(snapshot: GraphSnapshot) {
		if (!this.graph) {
			console.error("3D graph: update attempted before graph initialised");
			return;
		}

		const nodeWeights = accumulateNodeWeights(snapshot);
		const nodes: ForceGraphNode[] = snapshot.nodes.map((node) => ({
			id: node.id,
			label: node.label,
			path: node.path,
			val: Math.max(1, nodeWeights.get(node.id) ?? 1),
		}));
		const links: ForceGraphLink[] = snapshot.edges.map((edge) => ({
			source: edge.sourceId,
			target: edge.targetId,
			weight: edge.weight,
		}));

		console.debug("3D graph: applying data", {
			nodes: nodes.length,
			links: links.length,
		});
		const graph = this.graph;
		graph.graphData({ nodes, links });
		try {
			graph.d3ReheatSimulation();
		} catch (error) {
			console.warn("Failed to reheat force simulation", error);
		}
		try {
			graph.resumeAnimation();
		} catch (error) {
			console.warn("Failed to resume graph animation", error);
		}
	}

	private resizeGraph() {
		if (!this.graph || !this.container) {
			return;
		}

		const { width, height } = this.contentEl.getBoundingClientRect();
		if (width <= 0 || height <= 0) {
			return;
		}

		this.graph.width(width);
		this.graph.height(height);

		const camera = this.graph.camera() as PerspectiveCamera | undefined;
		if (camera) {
			const aspect = width / height;
			if (Math.abs(camera.aspect - aspect) > 0.0001) {
				camera.aspect = aspect;
				if (typeof camera.updateProjectionMatrix === "function") {
					camera.updateProjectionMatrix();
				}
			}
		}
	}
}

function snapshotHash(snapshot: GraphSnapshot): string {
	const nodeKey = snapshot.nodes.map((node) => node.id).join("|");
	const edgeKey = snapshot.edges
		.map((edge) => `${edge.sourceId}->${edge.targetId}:${edge.weight}`)
		.join("|");
	return `${nodeKey}#${edgeKey}`;
}

function accumulateNodeWeights(snapshot: GraphSnapshot): Map<string, number> {
	const weights = new Map<string, number>();
	for (const edge of snapshot.edges) {
		weights.set(edge.sourceId, (weights.get(edge.sourceId) ?? 0) + edge.weight);
		weights.set(edge.targetId, (weights.get(edge.targetId) ?? 0) + edge.weight);
	}
	return weights;
}

function overrideTickFrame(graph: ForceGraphInstance) {
	const anyGraph = graph as unknown as {
		tickFrame?: (state: unknown) => unknown;
	};
	const original = anyGraph.tickFrame?.bind(graph);
	if (!original) {
		return;
	}

	anyGraph.tickFrame = (state: any) => {
		const engine = state?.forceEngine !== "ngraph";
		const layout = state?.layout;
		const step = layout?.[engine ? "tick" : "step"];
		if (typeof step !== "function") {
			console.error(
				"3D Force Graph halted: missing force layout method",
				{
					engine: state?.forceEngine,
					layout,
				}
			);
			state.engineRunning = false;
			return graph;
		}
		return original(state);
	};
}
