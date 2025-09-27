import { ItemView, WorkspaceLeaf } from "obsidian";
import * as THREE from "three";

export const VIEW_TYPE_THREE_JS = "threejs-demo";

export class ThreeJsView extends ItemView {
	private renderer: THREE.WebGLRenderer | null = null;
	private camera: THREE.PerspectiveCamera | null = null;
	private scene: THREE.Scene | null = null;
	private cube: THREE.Mesh | null = null;
	private animationFrame: number | null = null;
	private resizeObserver: ResizeObserver | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_THREE_JS;
	}

	getDisplayText(): string {
		return "Three.js demo";
	}

	getIcon(): string {
		return "dice";
	}

	async onOpen() {
		this.contentEl.empty();
		this.contentEl.addClass("threejs-view");

		const canvas = this.contentEl.createEl("canvas", {
			cls: "threejs-canvas",
		});

		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color(0x202020);

		this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
		this.camera.position.z = 3;

		const renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: true,
			alpha: true,
		});
		renderer.setPixelRatio(window.devicePixelRatio ?? 1);
		this.renderer = renderer;

		const geometry = new THREE.BoxGeometry();
		const material = new THREE.MeshStandardMaterial({ color: 0x4da3ff });
		this.cube = new THREE.Mesh(geometry, material);
		this.scene.add(this.cube);

		const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
		directionalLight.position.set(5, 5, 5);
		this.scene.add(directionalLight);

		const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
		this.scene.add(ambientLight);

		this.resizeRenderer();

		this.resizeObserver = new ResizeObserver(() => this.resizeRenderer());
		this.resizeObserver.observe(this.contentEl);

		this.registerDomEvent(window, "resize", () => this.resizeRenderer());

		this.startAnimation();
	}

	async onClose() {
		if (this.animationFrame !== null) {
			cancelAnimationFrame(this.animationFrame);
			this.animationFrame = null;
		}

		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}

		if (this.cube) {
			this.cube.geometry.dispose();
			if (Array.isArray(this.cube.material)) {
				for (const material of this.cube.material) {
					material.dispose();
				}
			} else {
				this.cube.material.dispose();
			}
			this.cube = null;
		}

		if (this.renderer) {
			this.renderer.dispose();
			this.renderer = null;
		}

		this.camera = null;
		this.scene = null;

		this.contentEl.empty();
		this.contentEl.removeClass("threejs-view");
	}

	private startAnimation() {
		const tick = () => {
			if (!this.renderer || !this.scene || !this.camera || !this.cube) {
				return;
			}

			this.cube.rotation.x += 0.01;
			this.cube.rotation.y += 0.01;

			this.renderer.render(this.scene, this.camera);
			this.animationFrame = requestAnimationFrame(tick);
		};

		this.animationFrame = requestAnimationFrame(tick);
	}

	private resizeRenderer() {
		if (!this.renderer || !this.camera) {
			return;
		}

		const { width, height } = this.contentEl.getBoundingClientRect();
		if (width === 0 || height === 0) {
			return;
		}

		this.renderer.setSize(width, height, false);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
	}
}
