declare module "three/examples/jsm/controls/OrbitControls.js" {
	import type { Camera } from "three";
	import { EventDispatcher } from "three";

	export class OrbitControls extends EventDispatcher {
		constructor(object: Camera, domElement?: HTMLElement);
		enabled: boolean;
		enableDamping: boolean;
		dampingFactor: number;
		minDistance: number;
		maxDistance: number;
		enableZoom: boolean;
		enablePan: boolean;
		update(): void;
	}
}
