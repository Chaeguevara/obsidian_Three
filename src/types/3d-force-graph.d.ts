declare module "3d-force-graph" {
	type GraphObject = any;

	interface GraphData {
		nodes: GraphObject[];
		links: GraphObject[];
	}

	interface ForceGraph3DInstance {
		(element: HTMLElement): ForceGraph3DInstance;
		graphData(data: GraphData): ForceGraph3DInstance;
		width(width: number): ForceGraph3DInstance;
		height(height: number): ForceGraph3DInstance;
		backgroundColor(color: string): ForceGraph3DInstance;
		nodeRelSize(size: number): ForceGraph3DInstance;
		nodeLabel(labelAccessor: (node: GraphObject) => string): ForceGraph3DInstance;
		nodeVal(valueAccessor: (node: GraphObject) => number): ForceGraph3DInstance;
		nodeColor(colorAccessor: (node: GraphObject) => string): ForceGraph3DInstance;
		linkWidth(widthAccessor: (link: GraphObject) => number): ForceGraph3DInstance;
		linkOpacity(opacity: number): ForceGraph3DInstance;
		linkColor(colorAccessor: (link: GraphObject) => string): ForceGraph3DInstance;
		d3Force(forceName: string): unknown;
		d3ReheatSimulation(): ForceGraph3DInstance;
		pauseAnimation(): ForceGraph3DInstance;
		resumeAnimation(): ForceGraph3DInstance;
		onEngineStop(callback: () => void): ForceGraph3DInstance;
		zoomToFit(ms?: number, padding?: number): ForceGraph3DInstance;
		controls(): unknown;
		camera(): unknown;
		scene(): unknown;
	}

	type ForceGraph3DFactory = (options?: Record<string, unknown>) => ForceGraph3DInstance;

	const ForceGraph3D: ForceGraph3DFactory;
	export default ForceGraph3D;
}
