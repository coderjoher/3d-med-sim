/**
 * Babylon.js scene controller for the anatomy viewer (PRD §9.1, §12).
 * React-free so it can be driven by ModelViewer, the bench page and unit tests
 * (with Babylon's NullEngine).
 */
import {
  AbstractEngine, ArcRotateCamera, Camera, Color3, Color4, DirectionalLight, Engine, HemisphericLight,
  HighlightLayer, ImportMeshAsync, Matrix, Mesh, MeshBuilder, PBRMaterial, Plane, Scene, TransformNode,
  Vector3, Viewport, WebGPUEngine, type AbstractMesh, type Nullable,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import type { CameraView, ModelDef, SemanticEvent, StructureDef } from '@medsim/core';
import {
  buildSpecFor, cardiacScale, DEFAULT_RADIUS, normId, presetAngles, variantMods, type Rgb, type ShapeSpec, type VariantMod,
} from './anatomy';

export type EngineKind = 'webgpu' | 'webgl2' | 'null';

export interface ClipSpec { axis: 'x' | 'y' | 'z'; offset: number }

export interface ParallaxOffset { dAlpha: number; dBeta: number; radiusScale: number }

export interface StructureMeta { structureId: string; layer: string }

/** Create the best available engine: WebGPU, falling back to WebGL2 (PRD §12). `?engine=webgl2` forces WebGL. */
export async function createEngine(canvas: HTMLCanvasElement, prefer: 'auto' | 'webgpu' | 'webgl2' = 'auto'): Promise<{ engine: AbstractEngine; kind: EngineKind }> {
  let forced = prefer;
  try {
    const q = new URLSearchParams(window.location.search).get('engine');
    if (q === 'webgl2' || q === 'webgpu') forced = q;
  } catch { /* no location */ }
  if (forced !== 'webgl2') {
    try {
      if (await WebGPUEngine.IsSupportedAsync) {
        const engine = new WebGPUEngine(canvas, { antialias: true, stencil: true, adaptToDeviceRatio: true });
        await engine.initAsync();
        return { engine, kind: 'webgpu' };
      }
    } catch (e) {
      console.warn('[viewer] WebGPU unavailable, falling back to WebGL2', e);
    }
  }
  const engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: true, disableWebGL2Support: false }, true);
  return { engine, kind: 'webgl2' };
}

function cssColor(name: string, fallback: string): Color3 {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) return Color3.FromHexString(v);
  } catch { /* no DOM */ }
  return Color3.FromHexString(fallback);
}

export interface ControllerOptions {
  model: ModelDef;
  variant: string;
  /** Called when a structure is selected via input (click / pinch). */
  onSelect?: (id: string | null) => void;
  onHover?: (id: string | null) => void;
  /** Called (debounced) after the camera moved through input. */
  onViewChange?: (v: CameraView) => void;
}

export class ViewerController {
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  private root: TransformNode;
  private meshes = new Map<string, AbstractMesh[]>(); // structure id -> meshes (incl. variant extras)
  private structures = new Map<string, StructureDef>();
  private baseScale = new Map<AbstractMesh, Vector3>();
  private hl: HighlightLayer | null = null;
  private hiddenLayers = new Set<string>();
  private selected: string[] = [];
  private isolateId: string | null = null;
  private labels = false;
  private labelEls = new Map<string, HTMLElement>();
  private labelHost: HTMLElement | null = null;
  private clip: ClipSpec | null = null;
  private animating = false;
  private animStart = 0;
  private stereo = false;
  private parallax: ParallaxOffset = { dAlpha: 0, dBeta: 0, radiusScale: 1 };
  private homeView: CameraView = { camera: 'anterior' };
  private tween: { from: [number, number, number, Vector3]; to: [number, number, number, Vector3]; t0: number; ms: number } | null = null;
  private viewChangeTimer: ReturnType<typeof setTimeout> | null = null;
  private extent = 1.5;
  private disposed = false;
  readonly ready: Promise<void>;

  constructor(readonly engine: AbstractEngine, private opts: ControllerOptions) {
    const scene = new Scene(engine);
    this.scene = scene;
    scene.clearColor = new Color4(0.07, 0.1, 0.12, 1);
    const { alpha, beta } = presetAngles('anterior');
    this.camera = new ArcRotateCamera('cam', alpha, beta, DEFAULT_RADIUS, Vector3.Zero(), scene);
    this.camera.minZ = 0.05;
    this.camera.lowerRadiusLimit = 1.2;
    this.camera.upperRadiusLimit = 14;
    this.camera.lowerBetaLimit = 0.01;
    this.camera.upperBetaLimit = Math.PI - 0.01;
    const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, -0.3), scene);
    hemi.intensity = 0.75;
    hemi.groundColor = new Color3(0.25, 0.2, 0.2);
    const key = new DirectionalLight('key', new Vector3(0.4, -0.6, 0.8), scene);
    key.intensity = 1.6;
    const rim = new DirectionalLight('rim', new Vector3(-0.5, 0.2, -0.8), scene);
    rim.intensity = 0.6;
    this.root = new TransformNode('model-root', scene);
    for (const s of opts.model.structures) this.structures.set(s.id, s);
    try {
      this.hl = new HighlightLayer('hl', scene, { isStroke: false, blurHorizontalSize: 0.6, blurVerticalSize: 0.6 });
      this.hl.innerGlow = true;
      this.hl.outerGlow = true;
    } catch { this.hl = null; }
    scene.onBeforeRenderObservable.add(() => this.beforeRender());
    this.ready = this.build();
  }

  // ------------------------------------------------------------------ model building

  private async build() {
    const { model, variant } = this.opts;
    if (model.asset_url) {
      try {
        await this.loadGltf(model.asset_url);
      } catch (e) {
        console.warn('[viewer] glTF load failed, using procedural placeholder', e);
        this.buildProcedural();
      }
    } else {
      this.buildProcedural();
    }
    void variant;
    this.applyVisibility();
    this.applySelection();
    this.applyClip();
  }

  private material(name: string, color: Rgb, alpha = 1, roughness = 0.55): PBRMaterial {
    const m = new PBRMaterial(name, this.scene);
    m.albedoColor = new Color3(color[0], color[1], color[2]);
    m.metallic = 0;
    m.roughness = roughness;
    m.alpha = alpha;
    if (alpha < 1) {
      m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
      m.backFaceCulling = false;
    }
    m.environmentIntensity = 0.4;
    return m;
  }

  private shapeMesh(name: string, shape: ShapeSpec, mod: VariantMod | undefined): Mesh {
    const s = this.scene;
    const k = mod?.scale ?? 1;
    let mesh: Mesh;
    switch (shape.kind) {
      case 'ellipsoid': {
        mesh = MeshBuilder.CreateSphere(name, { diameter: 2, segments: 24 }, s);
        mesh.scaling = new Vector3(shape.radii[0] * k, shape.radii[1] * k, shape.radii[2] * k);
        mesh.position = new Vector3(...shape.center);
        if (shape.rotation) mesh.rotation = new Vector3(...shape.rotation);
        break;
      }
      case 'ring': {
        mesh = MeshBuilder.CreateTorus(name, {
          diameter: shape.diameter * (mod?.ringDiameter ?? 1) * k,
          thickness: shape.thickness * (mod?.ringThickness ?? 1),
          tessellation: 36,
        }, s);
        mesh.position = new Vector3(...shape.center);
        if (shape.rotation) mesh.rotation = new Vector3(...shape.rotation);
        break;
      }
      case 'tube': {
        mesh = MeshBuilder.CreateTube(name, { path: shape.path.map((p) => new Vector3(...p)), radius: shape.radius * k, tessellation: 16, cap: Mesh.CAP_ALL }, s);
        break;
      }
      case 'box': {
        mesh = MeshBuilder.CreateBox(name, { width: shape.size[0] * k, height: shape.size[1] * k, depth: shape.size[2] * k }, s);
        mesh.position = new Vector3(...shape.center);
        if (shape.rotation) mesh.rotation = new Vector3(...shape.rotation);
        break;
      }
    }
    return mesh;
  }

  private buildProcedural() {
    const { model, variant } = this.opts;
    const ids = model.structures.map((s) => s.id);
    const vdef = model.variants.find((v) => v.id === variant);
    const mods = variantMods(variant, model.organ, ids, vdef?.affects, vdef ? vdef.pathological : variant !== 'normal');
    model.structures.forEach((st, i) => {
      const spec = buildSpecFor(model.organ, st.id, i, model.structures.length);
      const mod = mods.get(st.id);
      const color = mod?.color ?? spec.look.color;
      const mat = this.material(`mat:${st.id}`, color, spec.look.alpha ?? 1, spec.look.roughness);
      // A structure node groups its shapes; every mesh is pickable and tagged.
      const node = new TransformNode(`node:${st.id}`, this.scene);
      node.parent = this.root;
      if (mod?.scaleXYZ) node.scaling = new Vector3(...mod.scaleXYZ);
      const list: AbstractMesh[] = [];
      spec.shapes.forEach((shape, j) => {
        const m = this.shapeMesh(j === 0 ? st.id : `${st.id}#${j}`, shape, mod);
        m.material = mat;
        m.parent = node;
        m.metadata = { structureId: st.id, layer: st.layer } satisfies StructureMeta;
        list.push(m);
      });
      for (const ex of mod?.extras ?? []) {
        const m = this.shapeMesh(`${st.id}~${ex.name}`, ex.shape, undefined);
        m.material = this.material(`mat:${st.id}~${ex.name}`, ex.color, ex.alpha ?? 1, 0.7);
        m.parent = node;
        m.metadata = { structureId: st.id, layer: st.layer, variantExtra: ex.name };
        list.push(m);
      }
      this.meshes.set(st.id, list);
      for (const m of list) this.baseScale.set(m, m.scaling.clone());
    });
    this.computeExtent();
  }

  private async loadGltf(url: string) {
    const res = await ImportMeshAsync(url, this.scene);
    const byNorm = new Map<string, string>();
    for (const st of this.opts.model.structures) {
      byNorm.set(normId(st.id), st.id);
      byNorm.set(st.id.toLowerCase(), st.id);
    }
    const variant = this.opts.variant;
    for (const m of res.meshes) {
      if (!m.getTotalVertices || m.getTotalVertices() === 0) continue;
      // Node naming convention: "<structure id>[@<variant>]" (PRD §11 stage 6 "Tag").
      let name = m.name;
      let node: Nullable<import('@babylonjs/core').Node> = m;
      let id: string | undefined;
      while (node && !id) {
        name = node.name;
        const [base, v] = name.split('@');
        const sid = byNorm.get(base.toLowerCase()) ?? byNorm.get(normId(base));
        if (sid) {
          if (v && v !== variant) { m.setEnabled(false); id = '__skip'; break; }
          id = sid;
        }
        node = node.parent;
      }
      if (!id || id === '__skip') continue;
      const st = this.structures.get(id)!;
      m.metadata = { structureId: id, layer: st.layer } satisfies StructureMeta;
      m.isPickable = true;
      const list = this.meshes.get(id) ?? [];
      list.push(m);
      this.meshes.set(id, list);
      this.baseScale.set(m, m.scaling.clone());
    }
    if (res.meshes[0]) res.meshes[0].parent = this.root;
    this.computeExtent();
  }

  private computeExtent() {
    let max = 0;
    for (const list of this.meshes.values()) {
      for (const m of list) {
        m.computeWorldMatrix(true);
        const b = m.getBoundingInfo().boundingBox;
        for (const v of [b.minimumWorld, b.maximumWorld]) max = Math.max(max, Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
      }
    }
    this.extent = max || 1.5;
  }

  // ------------------------------------------------------------------ render loop hooks

  private beforeRender() {
    const now = performance.now();
    if (this.tween) {
      const k = Math.min(1, (now - this.tween.t0) / this.tween.ms);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const [a0, b0, r0, t0] = this.tween.from;
      const [a1, b1, r1, t1] = this.tween.to;
      this.camera.alpha = a0 + (a1 - a0) * e;
      this.camera.beta = b0 + (b1 - b0) * e;
      this.camera.radius = r0 + (r1 - r0) * e;
      this.camera.target = Vector3.Lerp(t0, t1, e);
      if (k >= 1) this.tween = null;
    }
    if (this.animating) {
      const t = now - this.animStart;
      for (const [id, list] of this.meshes) {
        const f = cardiacScale(id, t);
        for (const m of list) {
          const b = this.baseScale.get(m);
          if (b) m.scaling.set(b.x * f, b.y * f, b.z * f);
        }
      }
    }
    if (this.stereo) this.syncEyes();
    if (this.labels) this.updateLabels();
  }

  // ------------------------------------------------------------------ camera (V-02)

  private viewToTarget(view: CameraView): [number, number, number, Vector3] {
    const p = presetAngles(view.camera);
    const alpha = view.camera === 'custom' && typeof view.alpha === 'number' ? view.alpha : p.alpha;
    const beta = view.camera === 'custom' && typeof view.beta === 'number' ? view.beta : p.beta;
    const radius = typeof view.radius === 'number' ? view.radius : DEFAULT_RADIUS;
    return [alpha + this.parallax.dAlpha, beta + this.parallax.dBeta, radius * this.parallax.radiusScale, Vector3.Zero()];
  }

  /** Move the camera to a view. animateMs = 0 jumps. */
  setView(view: CameraView, animateMs = 450, makeHome = true) {
    if (makeHome) this.homeView = view;
    const to = this.viewToTarget(view);
    // take the short way round in alpha
    const cur = this.camera.alpha;
    let a = to[0];
    while (a - cur > Math.PI) a -= Math.PI * 2;
    while (cur - a > Math.PI) a += Math.PI * 2;
    to[0] = a;
    if (animateMs <= 0) {
      this.tween = null;
      this.camera.alpha = to[0]; this.camera.beta = to[1]; this.camera.radius = to[2]; this.camera.target = to[3];
    } else {
      this.tween = { from: [this.camera.alpha, this.camera.beta, this.camera.radius, this.camera.target.clone()], to, t0: performance.now(), ms: animateMs };
    }
  }

  resetView(animateMs = 450) {
    this.setView(this.homeView, animateMs, false);
  }

  /** Current camera, excluding any parallax offset. */
  getCamera(): CameraView & { target: [number, number, number] } {
    const c = this.camera;
    const t = this.tween?.to;
    const alpha = (t ? t[0] : c.alpha) - this.parallax.dAlpha;
    const beta = (t ? t[1] : c.beta) - this.parallax.dBeta;
    const radius = (t ? t[2] : c.radius) / this.parallax.radiusScale;
    const tg = t ? t[3] : c.target;
    return { camera: 'custom', alpha, beta, radius, target: [tg.x, tg.y, tg.z] };
  }

  setParallax(p: ParallaxOffset | null) {
    const next = p ?? { dAlpha: 0, dBeta: 0, radiusScale: 1 };
    const prev = this.parallax;
    this.camera.alpha += next.dAlpha - prev.dAlpha;
    this.camera.beta = Math.min(Math.PI - 0.01, Math.max(0.01, this.camera.beta + next.dBeta - prev.dBeta));
    this.camera.radius = (this.camera.radius / prev.radiusScale) * next.radiusScale;
    this.parallax = next;
  }

  private notifyViewChange() {
    if (!this.opts.onViewChange) return;
    if (this.viewChangeTimer) clearTimeout(this.viewChangeTimer);
    this.viewChangeTimer = setTimeout(() => {
      if (this.disposed) return;
      const { alpha, beta, radius } = this.getCamera();
      this.opts.onViewChange?.({ camera: 'custom', alpha, beta, radius });
    }, 120);
  }

  /** Apply a semantic input event (PRD §7: one input language for every device). Returns true if handled. */
  applyEvent(e: SemanticEvent, canvasRect?: DOMRect): boolean {
    const c = this.camera;
    switch (e.type) {
      case 'rotate':
        this.tween = null;
        c.alpha -= e.dx * Math.PI * 1.6;
        c.beta = Math.min(Math.PI - 0.01, Math.max(0.01, c.beta - e.dy * Math.PI * 1.2));
        this.notifyViewChange();
        return true;
      case 'pan': {
        this.tween = null;
        const view = c.getViewMatrix();
        const inv = Matrix.Invert(view);
        const right = Vector3.TransformNormal(new Vector3(1, 0, 0), inv).normalize();
        const up = Vector3.TransformNormal(new Vector3(0, 1, 0), inv).normalize();
        const k = c.radius * 0.9;
        c.target = c.target.add(right.scale(-e.dx * k)).add(up.scale(e.dy * k));
        this.notifyViewChange();
        return true;
      }
      case 'zoom':
        this.tween = null;
        if (e.factor > 0) c.radius = Math.min(c.upperRadiusLimit ?? 20, Math.max(c.lowerRadiusLimit ?? 0.5, c.radius / e.factor));
        this.notifyViewChange();
        return true;
      case 'reset':
        this.resetView();
        this.notifyViewChange();
        return true;
      case 'select': {
        if (!canvasRect) return false;
        const id = this.pickNormalized(e.x, e.y, canvasRect);
        this.opts.onSelect?.(id);
        return true;
      }
      case 'point': {
        if (!canvasRect || !this.opts.onHover) return false;
        this.opts.onHover(this.pickNormalized(e.x, e.y, canvasRect));
        return true;
      }
      default:
        return false;
    }
  }

  /** Window-normalised coords -> structure id (null if outside the canvas or nothing hit). */
  private pickNormalized(x: number, y: number, rect: DOMRect): string | null {
    const cx = x * window.innerWidth;
    const cy = y * window.innerHeight;
    if (cx < rect.left || cx > rect.right || cy < rect.top || cy > rect.bottom) return null;
    return this.pickAt(cx - rect.left, cy - rect.top, rect);
  }

  /** Canvas-local CSS pixel coords -> structure id. */
  pickAt(px: number, py: number, rect?: { width: number; height: number }): string | null {
    const eng = this.engine;
    const w = rect?.width ?? eng.getRenderWidth();
    const h = rect?.height ?? eng.getRenderHeight();
    const sx = (px / w) * eng.getRenderWidth();
    const sy = (py / h) * eng.getRenderHeight();
    let cam: Camera = this.camera;
    let x = sx;
    if (this.stereo && this.eyes.length === 2) {
      cam = this.eyes[sx < eng.getRenderWidth() / 2 ? 0 : 1];
      x = sx;
    }
    const hit = this.scene.pick(x, sy, (m) => this.isPickable(m), false, cam);
    const meta = hit?.pickedMesh?.metadata as StructureMeta | undefined;
    return hit?.hit && meta?.structureId ? meta.structureId : null;
  }

  private isPickable(m: AbstractMesh): boolean {
    const meta = m.metadata as StructureMeta | undefined;
    if (!meta?.structureId || !m.isEnabled() || !m.isVisible) return false;
    // translucent shells (pericardium) should not block picking of what is inside
    const mat = m.material as PBRMaterial | null;
    if (mat && mat.alpha < 0.3) return false;
    // clipped half is not pickable
    return true;
  }

  /** Canvas-local CSS px position where the structure is actually pickable (for tests), or null. */
  structureScreenPos(id: string, rect: { width: number; height: number }): { x: number; y: number } | null {
    const list = this.meshes.get(id);
    if (!list) return null;
    const eng = this.engine;
    const cam: Camera = this.stereo && this.eyes.length === 2 ? this.eyes[0] : this.camera;
    const vp = cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight());
    const transform = this.scene.getTransformMatrix();
    const candidates: Vector3[] = [];
    for (const m of list) {
      if (!m.isEnabled()) continue;
      m.computeWorldMatrix(true);
      candidates.push(m.getBoundingInfo().boundingSphere.centerWorld.clone());
      const pos = m.getVerticesData('position');
      if (pos) {
        const wm = m.getWorldMatrix();
        const step = Math.max(3, Math.floor(pos.length / 3 / 60) * 3);
        for (let i = 0; i + 2 < pos.length; i += step) {
          const local = new Vector3(pos[i], pos[i + 1], pos[i + 2]);
          const world = Vector3.TransformCoordinates(local, wm);
          // nudge toward centre so we hit the surface, not the silhouette edge
          const c = m.getBoundingInfo().boundingSphere.centerWorld;
          candidates.push(Vector3.Lerp(world, c, 0.25));
        }
      }
    }
    for (const w of candidates) {
      const p = Vector3.Project(w, Matrix.Identity(), cam === this.camera ? transform : cam.getTransformationMatrix(), vp);
      if (p.z < 0 || p.z > 1) continue;
      const cssX = (p.x / eng.getRenderWidth()) * rect.width;
      const cssY = (p.y / eng.getRenderHeight()) * rect.height;
      if (cssX < 2 || cssY < 2 || cssX > rect.width - 2 || cssY > rect.height - 2) continue;
      if (this.pickAt(cssX, cssY, rect) === id) return { x: cssX, y: cssY };
    }
    return null;
  }

  // ------------------------------------------------------------------ layers / selection / isolate (V-03, V-04)

  setHiddenLayers(layers: string[] | undefined) {
    this.hiddenLayers = new Set(layers ?? []);
    this.applyVisibility();
  }

  setIsolate(id: string | null | undefined) {
    this.isolateId = id ?? null;
    this.applyVisibility();
  }

  private applyVisibility() {
    for (const [id, list] of this.meshes) {
      const st = this.structures.get(id);
      let visible = !!st && !this.hiddenLayers.has(st.layer);
      if (this.isolateId) visible = id === this.isolateId;
      for (const m of list) m.setEnabled(visible);
    }
    if (this.labels) this.syncLabelEls();
  }

  setSelected(ids: string[] | undefined) {
    this.selected = [...(ids ?? [])];
    this.applySelection();
  }

  refreshPalette() { this.applySelection(); }

  private applySelection() {
    const color = cssColor('--hl-select', '#ffb300');
    if (this.hl) this.hl.removeAllMeshes();
    for (const [id, list] of this.meshes) {
      const sel = this.selected.includes(id);
      for (const m of list) {
        const mat = m.material as PBRMaterial | null;
        if (mat && 'emissiveColor' in mat) mat.emissiveColor = sel ? color.scale(0.45) : Color3.Black();
        if (sel && this.hl && m instanceof Mesh) {
          try { this.hl.addMesh(m, color); } catch { /* highlight layer unsupported */ }
        }
      }
    }
  }

  getSelected(): string[] { return [...this.selected]; }
  getIsolated(): string | null { return this.isolateId; }

  getVisibleStructures(): string[] {
    const out: string[] = [];
    for (const [id, list] of this.meshes) if (list.some((m) => m.isEnabled())) out.push(id);
    return out;
  }

  structureIds(): string[] { return [...this.meshes.keys()]; }

  /** Geometry/material fingerprint of a structure (tests for V-06). */
  structureInfo(id: string): { meshes: number; color: [number, number, number]; size: [number, number, number] } | null {
    const list = this.meshes.get(id);
    if (!list?.length) return null;
    let min = new Vector3(Infinity, Infinity, Infinity);
    let max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const m of list) {
      m.computeWorldMatrix(true);
      const b = m.getBoundingInfo().boundingBox;
      min = Vector3.Minimize(min, b.minimumWorld);
      max = Vector3.Maximize(max, b.maximumWorld);
    }
    const mat = list[0].material as PBRMaterial | null;
    const c = mat?.albedoColor ?? Color3.Black();
    const r = (n: number) => Math.round(n * 1000) / 1000;
    return { meshes: list.length, color: [r(c.r), r(c.g), r(c.b)], size: [r(max.x - min.x), r(max.y - min.y), r(max.z - min.z)] };
  }

  // ------------------------------------------------------------------ labels (V-05)

  setLabelHost(el: HTMLElement | null) {
    this.labelHost = el;
    this.syncLabelEls();
  }

  setLabelsVisible(v: boolean) {
    this.labels = v;
    this.syncLabelEls();
  }

  getLabelsVisible(): boolean { return this.labels; }

  private syncLabelEls() {
    const host = this.labelHost;
    if (!host) return;
    const want = this.labels ? new Set(this.getVisibleStructures()) : new Set<string>();
    for (const [id, el] of this.labelEls) {
      if (!want.has(id)) { el.remove(); this.labelEls.delete(id); }
    }
    for (const id of want) {
      if (this.labelEls.has(id)) continue;
      const el = document.createElement('div');
      el.className = 'viewer-label';
      el.dataset.structure = id;
      el.textContent = this.labelText(id);
      host.appendChild(el);
      this.labelEls.set(id, el);
    }
    if (this.labels) this.updateLabels();
  }

  private labelLang: 'en' | 'ar' = 'en';
  setLabelLang(lang: 'en' | 'ar') {
    this.labelLang = lang;
    for (const [id, el] of this.labelEls) el.textContent = this.labelText(id);
  }

  private labelText(id: string): string {
    const name = this.structures.get(id)?.name;
    if (!name) return id;
    if (typeof name === 'string') return name;
    return (this.labelLang === 'ar' && name.ar) || name.en;
  }

  private updateLabels() {
    const host = this.labelHost;
    if (!host || this.labelEls.size === 0) return;
    const eng = this.engine;
    const w = eng.getRenderWidth();
    const h = eng.getRenderHeight();
    const rect = { width: host.clientWidth || w, height: host.clientHeight || h };
    const vp = this.camera.viewport.toGlobal(w, h);
    const transform = this.scene.getTransformMatrix();
    for (const [id, el] of this.labelEls) {
      const m = this.meshes.get(id)?.[0];
      if (!m) continue;
      const p = Vector3.Project(m.getBoundingInfo().boundingSphere.centerWorld, Matrix.Identity(), transform, vp);
      const visible = p.z >= 0 && p.z <= 1;
      el.style.display = visible ? '' : 'none';
      el.style.transform = `translate(${(p.x / w) * rect.width}px, ${(p.y / h) * rect.height}px) translate(-50%, -50%)`;
    }
  }

  // ------------------------------------------------------------------ clipping (V-07)

  setClipping(c: ClipSpec | null | undefined) {
    this.clip = c ?? null;
    this.applyClip();
  }

  getClipping(): ClipSpec | null { return this.clip; }

  private applyClip() {
    const s = this.scene;
    s.clipPlane = null; s.clipPlane2 = null; s.clipPlane3 = null;
    const c = this.clip;
    if (!c) return;
    const d = -c.offset * this.extent;
    if (c.axis === 'x') s.clipPlane = new Plane(1, 0, 0, d);
    else if (c.axis === 'y') s.clipPlane2 = new Plane(0, 1, 0, d);
    else s.clipPlane3 = new Plane(0, 0, 1, d);
  }

  // ------------------------------------------------------------------ animation (V-08)

  setAnimate(on: boolean) {
    if (on === this.animating) return;
    this.animating = on;
    if (on) this.animStart = performance.now();
    else for (const [m, b] of this.baseScale) m.scaling.copyFrom(b);
  }

  isAnimating(): boolean { return this.animating; }

  /** Current scale factor of a structure's first mesh relative to its rest scale. */
  animationScale(id: string): number {
    const m = this.meshes.get(id)?.[0];
    const b = m && this.baseScale.get(m);
    return m && b ? m.scaling.y / b.y : 1;
  }

  // ------------------------------------------------------------------ stereo output (T3-04)

  private eyes: ArcRotateCamera[] = [];

  /** Side-by-side stereo: two eye cameras with an interocular orbit offset, each rendering half the frame. */
  setStereo(on: boolean) {
    if (on === this.stereo) return;
    this.stereo = on;
    if (on) {
      const mk = (name: string, vp: Viewport) => {
        const cam = new ArcRotateCamera(name, this.camera.alpha, this.camera.beta, this.camera.radius, this.camera.target.clone(), this.scene);
        cam.minZ = this.camera.minZ;
        cam.viewport = vp;
        return cam;
      };
      this.eyes = [mk('eye-left', new Viewport(0, 0, 0.5, 1)), mk('eye-right', new Viewport(0.5, 0, 0.5, 1))];
      this.syncEyes();
      this.scene.activeCameras = [...this.eyes];
    } else {
      this.scene.activeCameras = [];
      this.scene.activeCamera = this.camera;
      for (const e of this.eyes) e.dispose();
      this.eyes = [];
    }
  }

  private syncEyes() {
    if (!this.eyes.length) return;
    const c = this.camera;
    const half = Math.atan2(this.interocular / 2, c.radius);
    this.eyes.forEach((e, i) => {
      e.alpha = c.alpha + (i === 0 ? half : -half);
      e.beta = c.beta;
      e.radius = c.radius;
      e.target.copyFrom(c.target);
    });
  }

  /** Interocular distance in model units (~6.4 cm at heart scale ~ 1 unit = 10 cm). */
  interocular = 0.32;

  getStereo(): { enabled: boolean; viewports: Array<[number, number, number, number]> } {
    const cams = this.stereo ? this.eyes : [this.camera];
    return { enabled: this.stereo, viewports: cams.map((c) => [c.viewport.x, c.viewport.y, c.viewport.width, c.viewport.height]) };
  }

  // ------------------------------------------------------------------ lifecycle

  dispose() {
    this.disposed = true;
    this.setStereo(false);
    if (this.viewChangeTimer) clearTimeout(this.viewChangeTimer);
    for (const el of this.labelEls.values()) el.remove();
    this.labelEls.clear();
    this.scene.dispose();
  }
}
