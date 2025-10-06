import { ItemView, Platform, WorkspaceLeaf } from "obsidian";
import ForceGraph3D from "3d-force-graph";
import {
	Euler,
	MathUtils,
	PerspectiveCamera,
	Quaternion,
	Vector3,
} from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { collectGraphSnapshot, GraphSnapshot } from "./graph-data";
import type ThreeJsGraphVisualizerPlugin from "../main";

export const VIEW_TYPE_GRAPH_VISUALIZER = "three-js-graph-visualizer";

type ForceGraphBuilder = ReturnType<typeof ForceGraph3D>;
type ForceGraphInstance = ReturnType<ForceGraphBuilder>;

interface ForceGraphNode {
	readonly id: string;
	readonly label: string;
	readonly path: string;
	readonly val: number;
	readonly tags: string[];
	readonly kind: "file" | "tag";
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
	private readonly nodeColorResolver = (node: ForceGraphNode) =>
		this.resolveNodeColor(node);
	private readonly onTagColorsChanged = () => this.handleTagColorsChanged();
	private tagColorOverrides: Record<string, string> = {};
	private defaultColorInput: HTMLInputElement | null = null;
	private tagListEl: HTMLElement | null = null;
	private currentTags: string[] = [];
	private panelEl: HTMLElement | null = null;
	private orientationButton: HTMLButtonElement | null = null;
	private orbitControls: OrbitControls | null = null;
	private orientationHandler: ((event: DeviceOrientationEvent) => void) | null = null;
	private screenOrientationListener: (() => void) | null = null;
	private lastDeviceOrientationEvent: DeviceOrientationEvent | null = null;
	private orientationCamera: PerspectiveCamera | null = null;
	private screenOrientation = 0;
	private readonly orientationEuler = new Euler(0, 0, 0, "YXZ");
	private readonly orientationQ0 = new Quaternion();
	private readonly orientationQ1 = new Quaternion(
		-Math.sqrt(0.5),
		0,
		0,
		Math.sqrt(0.5)
	);
	private readonly orientationZee = new Vector3(0, 0, 1);

	constructor(
		private readonly plugin: ThreeJsGraphVisualizerPlugin,
		leaf: WorkspaceLeaf
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_GRAPH_VISUALIZER;
	}

	getDisplayText(): string {
		return "Three JS graph visualizer";
	}

	getIcon(): string {
		return "dice";
	}

	async onOpen() {
		this.contentEl.empty();
		this.contentEl.addClass("graph-visualizer-view");

		this.panelEl = this.contentEl.createDiv({
			cls: "graph-visualizer-panel",
		});
		this.initialiseTagPanel();

		const container = this.contentEl.createDiv({
			cls: "graph-visualizer-force-graph",
		});
		container.style.width = "100%";
		container.style.height = "100%";
		container.style.touchAction = "none";
		this.container = container;
		this.enableMobileInteractionHandlers(container);

		const graphBuilder = ForceGraph3D();
		const graph = graphBuilder(container);
		overrideTickFrame(graph);
		try {
			graph.pauseAnimation();
		} catch (error) {
			console.debug("3D graph: pause animation during init failed", error);
		}
		this.graph = graph;
		const renderer = (graph as unknown as {
			renderer?: () => { domElement?: HTMLElement };
		}).renderer?.();
		if (renderer?.domElement) {
			renderer.domElement.style.touchAction = "none";
		}
		this.orbitControls = (graph.controls() as OrbitControls | undefined) ?? null;
		console.debug("3D graph: force instance created");

		graph
			.backgroundColor("#101018")
			.nodeRelSize(6)
			.nodeLabel((node: ForceGraphNode) =>
				node.kind === "tag" ? node.label : `${node.label}\n${node.path}`
			)
			.nodeVal((node: ForceGraphNode) => node.val)
			.nodeColor(this.nodeColorResolver)
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
		this.tagColorOverrides = this.plugin.getTagColorOverrides();
		this.registerEvent(
			this.plugin.onTagColorsChanged(this.onTagColorsChanged)
		);
		this.updateDefaultColorInput();
		this.rebuildGraph(true);
		await this.tryEnableDeviceOrientationControls(false);
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
		this.tagColorOverrides = {};
		this.defaultColorInput = null;
		this.tagListEl = null;
		this.currentTags = [];
		this.panelEl = null;
		this.disableDeviceOrientationControls();
		this.orientationButton = null;
		this.orbitControls = null;

		this.contentEl.empty();
		this.contentEl.removeClass("graph-visualizer-view");
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
			tags: node.tags,
			kind: node.kind,
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
		graph.nodeColor(this.nodeColorResolver);
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

		this.updateCurrentTags(snapshot);
	}

	private initialiseTagPanel() {
		if (!this.panelEl) {
			return;
		}

		this.panelEl.empty();

		this.panelEl.createEl("h3", {
			text: "Tag colors",
			cls: "graph-visualizer-panel-title",
		});
		this.panelEl.createEl("p", {
			text: "Assign colors per tag. Nodes without a custom color use the default.",
			cls: "graph-visualizer-panel-description",
		});

		const defaultRow = this.panelEl.createDiv({
			cls: "graph-visualizer-tag-row",
		});
		defaultRow.createDiv({
			cls: "graph-visualizer-tag-label",
			text: "Default color",
		});
		const defaultInput = defaultRow.createEl("input", {
			attr: { type: "color" },
			cls: "graph-visualizer-tag-color-input",
		}) as HTMLInputElement;
		defaultInput.value = this.plugin.getDefaultNodeColor();
		defaultInput.addEventListener("change", () => {
			const value = defaultInput.value;
			void this.plugin.setDefaultNodeColor(value);
		});
		this.defaultColorInput = defaultInput;

		if (this.shouldOfferDeviceOrientation()) {
			const motionSection = this.panelEl.createDiv({
				cls: "graph-visualizer-motion-section",
			});
			motionSection.createDiv({
				cls: "graph-visualizer-panel-subtitle",
				text: "Motion controls",
			});
			motionSection.createEl("p", {
				text: "Use your device orientation to steer the camera on mobile.",
				cls: "graph-visualizer-panel-description",
			});
			const orientationButton = motionSection.createEl("button", {
				cls: "graph-visualizer-panel-button",
			}) as HTMLButtonElement;
			orientationButton.addEventListener("click", () => {
				void this.handleOrientationToggle();
			});
			this.orientationButton = orientationButton;
			this.updateOrientationButton();
		}

		this.panelEl.createEl("div", {
			text: "Tags",
			cls: "graph-visualizer-panel-subtitle",
		});

		this.tagListEl = this.panelEl.createDiv({
			cls: "graph-visualizer-tag-list",
		});
		this.renderTagList();
	}

	private renderTagList() {
		if (!this.tagListEl) {
			return;
		}

		this.tagListEl.empty();

		if (this.currentTags.length === 0) {
			this.tagListEl.createDiv({
				cls: "graph-visualizer-empty",
				text: "No tags detected yet.",
			});
			return;
		}

		const overrides = this.tagColorOverrides;
		const defaultColor = this.plugin.getDefaultNodeColor();
		for (const tag of this.currentTags) {
			const row = this.tagListEl.createDiv({
				cls: "graph-visualizer-tag-row",
			});
			row.createDiv({
				cls: "graph-visualizer-tag-label",
				text: `#${tag}`,
			});

			const actions = row.createDiv({
				cls: "graph-visualizer-tag-actions",
			});
			const colorInput = actions.createEl("input", {
				attr: { type: "color" },
				cls: "graph-visualizer-tag-color-input",
			}) as HTMLInputElement;
			colorInput.value = overrides[tag] ?? defaultColor;
			colorInput.addEventListener("change", () => {
				const value = colorInput.value;
				void this.plugin.setTagColor(tag, value);
			});

			const resetButton = actions.createEl("button", {
				cls: "graph-visualizer-tag-reset",
				text: "Reset",
			});
			if (!overrides[tag]) {
				resetButton.disabled = true;
				resetButton.addClass("is-disabled");
			}
			resetButton.addEventListener("click", (event) => {
				event.preventDefault();
				void this.plugin.clearTagColor(tag);
			});
		}
	}

	private async handleOrientationToggle() {
		if (this.orientationHandler) {
			this.disableDeviceOrientationControls();
			return;
		}

		await this.tryEnableDeviceOrientationControls(true);
	}

	private shouldOfferDeviceOrientation(): boolean {
		if (typeof window === "undefined") {
			return false;
		}
		if (!this.isMobileEnvironment()) {
			return false;
		}
		return (
			typeof window.DeviceOrientationEvent !== "undefined" ||
			"ondeviceorientation" in window
		);
	}

	private async tryEnableDeviceOrientationControls(
		userInitiated: boolean
	): Promise<void> {
		if (!this.shouldOfferDeviceOrientation()) {
			this.updateOrientationButton();
			return;
		}

		if (this.orientationHandler) {
			this.updateOrientationButton();
			return;
		}

		const graph = this.graph;
		if (!graph) {
			this.updateOrientationButton();
			return;
		}

		const camera = graph.camera() as PerspectiveCamera | undefined;
		if (!camera) {
			this.updateOrientationButton();
			return;
		}

		const orientationCtor =
			window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
				requestPermission?: () => Promise<PermissionState>;
			};

		if (typeof orientationCtor?.requestPermission === "function") {
			if (!userInitiated) {
				this.updateOrientationButton();
				return;
			}

			try {
				const permission = await orientationCtor.requestPermission();
				if (permission !== "granted") {
					this.updateOrientationButton();
					return;
				}
			} catch (error) {
				console.warn("3D graph: orientation permission rejected", error);
				this.updateOrientationButton();
				return;
			}
		}

		this.startDeviceOrientation(camera);
		if (this.orbitControls) {
			this.orbitControls.enabled = false;
		}
		this.updateOrientationButton();
	}

	private startDeviceOrientation(camera: PerspectiveCamera) {
		this.orientationCamera = camera;
		this.screenOrientation = this.getScreenOrientation();

		const orientationHandler = (event: DeviceOrientationEvent) => {
			this.lastDeviceOrientationEvent = event;
			this.applyDeviceOrientation(camera, event);
		};

		const screenOrientationListener = () => {
			this.screenOrientation = this.getScreenOrientation();
			if (this.orientationCamera && this.lastDeviceOrientationEvent) {
				this.applyDeviceOrientation(
					this.orientationCamera,
					this.lastDeviceOrientationEvent
				);
			}
		};

		this.orientationHandler = orientationHandler;
		this.screenOrientationListener = screenOrientationListener;

		window.addEventListener("deviceorientation", orientationHandler, true);
		window.addEventListener("orientationchange", screenOrientationListener);
	}

	private disableDeviceOrientationControls() {
		if (this.orientationHandler) {
			window.removeEventListener(
				"deviceorientation",
				this.orientationHandler,
				true
			);
			this.orientationHandler = null;
		}

		if (this.screenOrientationListener) {
			window.removeEventListener(
				"orientationchange",
				this.screenOrientationListener
			);
			this.screenOrientationListener = null;
		}

		this.orientationCamera = null;
		this.lastDeviceOrientationEvent = null;
		this.screenOrientation = 0;

		if (this.orbitControls) {
			this.orbitControls.enabled = true;
		}

		this.updateOrientationButton();
	}

	private applyDeviceOrientation(
		camera: PerspectiveCamera,
		event: DeviceOrientationEvent
	) {
		const alpha = MathUtils.degToRad(event.alpha ?? 0);
		const beta = MathUtils.degToRad(event.beta ?? 0);
		const gamma = MathUtils.degToRad(event.gamma ?? 0);
		const orient = MathUtils.degToRad(this.screenOrientation);

		const euler = this.orientationEuler;
		const q0 = this.orientationQ0;
		const q1 = this.orientationQ1;
		const zee = this.orientationZee;

		euler.set(beta, alpha, -gamma, "YXZ");
		camera.quaternion.setFromEuler(euler);
		camera.quaternion.multiply(q1);
		camera.quaternion.multiply(q0.setFromAxisAngle(zee, -orient));
		if (typeof camera.updateProjectionMatrix === "function") {
			camera.updateProjectionMatrix();
		}
	}

	private getScreenOrientation(): number {
		if (typeof window === "undefined") {
			return 0;
		}
		const angle =
			window.screen?.orientation?.angle ??
			((window as unknown as { orientation?: number }).orientation ?? 0);
		return typeof angle === "number" ? angle : 0;
	}

	private updateOrientationButton() {
		if (!this.orientationButton) {
			return;
		}

		if (!this.shouldOfferDeviceOrientation()) {
			this.orientationButton.textContent = "Motion control unavailable";
			this.orientationButton.disabled = true;
			return;
		}

		this.orientationButton.disabled = false;
		this.orientationButton.textContent = this.orientationHandler
			? "Disable motion control"
			: "Enable motion control";
	}

	private enableMobileInteractionHandlers(container: HTMLElement) {
		if (!this.isMobileEnvironment()) {
			return;
		}

		const stopPropagation = (event: TouchEvent) => {
			event.stopPropagation();
		};

		this.registerDomEvent(container, "touchstart", stopPropagation);
		this.registerDomEvent(container, "touchmove", stopPropagation);
		this.registerDomEvent(container, "touchend", stopPropagation);
		this.registerDomEvent(container, "touchcancel", stopPropagation);
	}

	private isMobileEnvironment(): boolean {
		return Platform.isMobile || Platform.isMobileApp;
	}

	private handleTagColorsChanged() {
		this.tagColorOverrides = this.plugin.getTagColorOverrides();
		this.updateDefaultColorInput();
		this.renderTagList();
		this.refreshNodeColors();
	}

	private updateDefaultColorInput() {
		if (!this.defaultColorInput) {
			return;
		}

		this.defaultColorInput.value = this.plugin.getDefaultNodeColor();
	}

	private updateCurrentTags(snapshot: GraphSnapshot) {
		const tags = uniqueTagsFromSnapshot(snapshot);
		if (
			tags.length === this.currentTags.length &&
			tags.every((tag, index) => tag === this.currentTags[index])
		) {
			return;
		}

		this.currentTags = tags;
		this.renderTagList();
	}

	private refreshNodeColors() {
		if (!this.graph) {
			return;
		}

		this.graph.nodeColor(this.nodeColorResolver);
		const refresh = (this.graph as { refresh?: () => void }).refresh;
		if (typeof refresh === "function") {
			try {
				refresh.call(this.graph);
			} catch (error) {
				console.warn("Failed to refresh graph colors", error);
			}
		}
	}

	private resolveNodeColor(node: ForceGraphNode): string {
		for (const tag of node.tags ?? []) {
			const override = this.tagColorOverrides[tag];
			if (override) {
				return override;
			}
		}
		return this.plugin.getDefaultNodeColor();
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

function uniqueTagsFromSnapshot(snapshot: GraphSnapshot): string[] {
	const tagSet = new Set<string>();
	for (const node of snapshot.nodes) {
		for (const tag of node.tags) {
			tagSet.add(tag);
		}
	}
	return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
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
