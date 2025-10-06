import { EventRef, Events, Plugin, WorkspaceLeaf } from "obsidian";
import { ThreeJsView, VIEW_TYPE_GRAPH_VISUALIZER } from "./src/three-view";
import {
	DEFAULT_SETTINGS,
	ThreeJsGraphVisualizerSettings,
} from "./src/settings";

export default class ThreeJsGraphVisualizerPlugin extends Plugin {
	settings: ThreeJsGraphVisualizerSettings = DEFAULT_SETTINGS;
	private readonly tagColorEvents = new Events();

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_GRAPH_VISUALIZER,
			(leaf) => new ThreeJsView(this, leaf)
		);

		this.addRibbonIcon("dice", "Open Three JS graph visualizer", () => {
			void this.activateGraphVisualizerView();
		});

		this.addCommand({
			id: "open-three-js-graph-visualizer",
			name: "Open Three JS graph visualizer",
			callback: () => this.activateGraphVisualizerView(),
		});

		this.app.workspace.onLayoutReady(() => {
			if (!this.getGraphVisualizerLeaf()) {
				void this.activateGraphVisualizerView();
			}
		});
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_GRAPH_VISUALIZER);
	}

	getDefaultNodeColor(): string {
		return this.settings.defaultNodeColor;
	}

	getTagColorOverrides(): Record<string, string> {
		return { ...this.settings.tagColors };
	}

	getColorForTag(tag: string): string {
		return this.settings.tagColors[tag] ?? this.settings.defaultNodeColor;
	}

	onTagColorsChanged(callback: () => void): EventRef {
		return this.tagColorEvents.on("tag-colors-changed", callback);
	}

	async setTagColor(tag: string, color: string): Promise<void> {
		if (!tag) {
			return;
		}
		const trimmed = color?.trim();
		if (!trimmed) {
			return;
		}
		if (this.settings.tagColors[tag] === trimmed) {
			return;
		}
		if (trimmed === this.settings.defaultNodeColor) {
			await this.clearTagColor(tag);
			return;
		}
		this.settings = {
			...this.settings,
			tagColors: {
				...this.settings.tagColors,
				[tag]: trimmed,
			},
		};
		await this.saveSettings();
		this.notifyTagColorChange();
	}

	async clearTagColor(tag: string): Promise<void> {
		if (!this.settings.tagColors[tag]) {
			return;
		}
		const { [tag]: _removed, ...rest } = this.settings.tagColors;
		this.settings = {
			...this.settings,
			tagColors: rest,
		};
		await this.saveSettings();
		this.notifyTagColorChange();
	}

	async setDefaultNodeColor(color: string): Promise<void> {
		if (!color || this.settings.defaultNodeColor === color) {
			return;
		}
		this.settings = {
			...this.settings,
			defaultNodeColor: color,
		};
		await this.saveSettings();
		this.notifyTagColorChange();
	}

	private notifyTagColorChange() {
		this.tagColorEvents.trigger("tag-colors-changed");
	}

	private async loadSettings() {
		const stored = (await this.loadData()) ?? {};
		const tagColors = {
			...DEFAULT_SETTINGS.tagColors,
			...(stored.tagColors ?? {}),
		};
		this.settings = {
			...DEFAULT_SETTINGS,
			...stored,
			tagColors,
		};
	}

	private async saveSettings() {
		await this.saveData(this.settings);
	}

	private async activateGraphVisualizerView() {
		const leaf =
			this.getGraphVisualizerLeaf() ??
			this.app.workspace.getRightLeaf(false) ??
			this.app.workspace.getLeaf(true);

		if (!leaf) {
			return;
		}

		await leaf.setViewState({ type: VIEW_TYPE_GRAPH_VISUALIZER, active: true });
		this.app.workspace.revealLeaf(leaf);
	}

	private getGraphVisualizerLeaf(): WorkspaceLeaf | null {
		const existing = this.app.workspace.getLeavesOfType(
			VIEW_TYPE_GRAPH_VISUALIZER
		);
		return existing.length > 0 ? existing[0] : null;
	}
}
