import { Plugin, WorkspaceLeaf } from "obsidian";
import { ThreeJsView, VIEW_TYPE_THREE_JS } from "./src/three-view";

export default class ThreeJsPlugin extends Plugin {
	async onload() {
		this.registerView(VIEW_TYPE_THREE_JS, (leaf) => new ThreeJsView(leaf));

		this.addRibbonIcon("dice", "Open Three.js demo", () => {
			void this.activateThreeJsView();
		});

		this.addCommand({
			id: "open-threejs-demo",
			name: "Open Three.js demo",
			callback: () => this.activateThreeJsView(),
		});

		this.app.workspace.onLayoutReady(() => {
			if (!this.getThreeJsLeaf()) {
				void this.activateThreeJsView();
			}
		});
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_THREE_JS);
	}

	private async activateThreeJsView() {
		const leaf =
			this.getThreeJsLeaf() ??
			this.app.workspace.getRightLeaf(false) ??
			this.app.workspace.getLeaf(true);

		if (!leaf) {
			return;
		}

		await leaf.setViewState({ type: VIEW_TYPE_THREE_JS, active: true });
		this.app.workspace.revealLeaf(leaf);
	}

	private getThreeJsLeaf(): WorkspaceLeaf | null {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_THREE_JS);
		return existing.length > 0 ? existing[0] : null;
	}
}
