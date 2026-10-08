/**
 * `window.__medsim` — test / diagnostics hooks (engine type, fps, viewer state).
 * Used by Playwright (deterministic structure clicks) and the bench page.
 */
import type { CameraView } from '@medsim/core';

export interface ViewerTestApi {
  ready: boolean;
  modelId: string;
  variant: string;
  getCamera(): CameraView & { target: [number, number, number] };
  getVisibleStructures(): string[];
  getSelected(): string[];
  getIsolated(): string | null;
  getLabelsVisible(): boolean;
  getClipping(): { axis: 'x' | 'y' | 'z'; offset: number } | null;
  isAnimating(): boolean;
  animationScale(id: string): number;
  getStereo(): { enabled: boolean; viewports: Array<[number, number, number, number]> };
  structureInfo(id: string): { meshes: number; color: [number, number, number]; size: [number, number, number] } | null;
  /** Client (page) px -> structure id. */
  pickAt(x: number, y: number): string | null;
  /** Page px of a point where the structure is visible & pickable, or null. */
  structureScreenPos(id: string): { x: number; y: number } | null;
}

export interface MedsimDebug {
  engine?: 'webgpu' | 'webgl2' | 'null' | 'unsupported';
  fps?: number;
  viewer?: ViewerTestApi;
  viewers: Record<string, ViewerTestApi>;
  /** Last measured hand-to-cursor latency samples (ms), see bench. */
  latency?: number[];
  [k: string]: unknown;
}

declare global {
  interface Window { __medsim?: MedsimDebug }
}

export function debugRoot(): MedsimDebug {
  if (typeof window === 'undefined') return { viewers: {} };
  if (!window.__medsim) window.__medsim = { viewers: {} };
  if (!window.__medsim.viewers) window.__medsim.viewers = {};
  return window.__medsim;
}

export function registerViewer(key: string, api: ViewerTestApi, primary: boolean) {
  const d = debugRoot();
  d.viewers[key] = api;
  if (primary) d.viewer = api;
}

export function unregisterViewer(key: string, api: ViewerTestApi) {
  const d = debugRoot();
  if (d.viewers[key] === api) delete d.viewers[key];
  if (d.viewer === api) d.viewer = Object.values(d.viewers)[0];
}
