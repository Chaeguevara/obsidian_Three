export interface ThreeJsGraphVisualizerSettings {
	readonly defaultNodeColor: string;
	readonly tagColors: Record<string, string>;
}

export const DEFAULT_SETTINGS: ThreeJsGraphVisualizerSettings = {
	defaultNodeColor: "#8ab4ff",
	tagColors: {},
};
