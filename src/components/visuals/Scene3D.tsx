import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Download, FileJson, Loader2, Orbit, RotateCcw } from 'lucide-react';
import type { OrbitControls as OrbitControlsImpl } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Object3D, Scene, WebGLRenderer } from 'three';
import { normalizeScene, parseSpec, type SceneObject, type SceneSpec } from '../../../shared/visuals';
import { downloadBlob, downloadJson, downloadText, safeFilename } from '../../lib/download';
import { FooterButton, VisualError, VisualFooter } from './VisualChrome';

interface ThreeKit {
  THREE: typeof import('three');
  OrbitControls: typeof import('three/examples/jsm/controls/OrbitControls.js').OrbitControls;
  GLTFExporter: typeof import('three/examples/jsm/exporters/GLTFExporter.js').GLTFExporter;
  OBJExporter: typeof import('three/examples/jsm/exporters/OBJExporter.js').OBJExporter;
}

let kit: Promise<ThreeKit> | null = null;

/**
 * three.js is ~600 kB, so it is only fetched when a `scene` block actually
 * appears. The main console (and the phone) stay light until the user asks for
 * something dimensional.
 */
function loadKit(): Promise<ThreeKit> {
  kit ??= Promise.all([
    import('three'),
    import('three/examples/jsm/controls/OrbitControls.js'),
    import('three/examples/jsm/exporters/GLTFExporter.js'),
    import('three/examples/jsm/exporters/OBJExporter.js'),
  ]).then(([THREE, controls, gltf, obj]) => ({
    THREE,
    OrbitControls: controls.OrbitControls,
    GLTFExporter: gltf.GLTFExporter,
    OBJExporter: obj.OBJExporter,
  }));
  return kit;
}

/**
 * Geometry from JSON. A model that can write ten lines of JSON can hand the
 * user a model they can orbit, screenshot, and export to Blender — no image
 * generation credit, no shader knowledge required.
 */
export function Scene3D({ code }: { code: string }) {
  const parsed = parseSpec<SceneSpec>(code);
  const normalized = parsed.spec ? normalizeScene(parsed.spec) : undefined;
  const spec = normalized?.scene?.spec;
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string>('');
  const [spinning, setSpinning] = useState(Boolean(spec?.autoRotate));

  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<WebGLRenderer | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const disposer = useRef<(() => void) | null>(null);
  const spinTargets = useRef<Array<{ object: Object3D; rate: number }>>([]);
  const gridHelper = useRef<Object3D | null>(null);
  const kitRef = useRef<ThreeKit | null>(null);

  const scene = normalized?.scene;

  useEffect(() => {
    if (!scene || !host.current) return;
    const container = host.current;
    let cancelled = false;
    let frame = 0;
    let observer: ResizeObserver | undefined;

    void (async () => {
      try {
        const loaded = await loadKit();
        if (cancelled || !container) return;
        kitRef.current = loaded;
        const { THREE, OrbitControls } = loaded;

        const width = container.clientWidth || 640;
        const height = container.clientHeight || 320;
        const gl = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
        gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        gl.setSize(width, height, false);
        gl.domElement.style.width = '100%';
        gl.domElement.style.height = '100%';
        gl.domElement.style.display = 'block';
        gl.domElement.style.touchAction = 'none';
        container.appendChild(gl.domElement);
        renderer.current = gl;

        const three = new THREE.Scene();
        three.background = new THREE.Color(sceneColor(scene.spec.background));
        sceneRef.current = three;

        const camera = new THREE.PerspectiveCamera(scene.spec.camera?.fov ?? 42, width / Math.max(1, height), 0.1, 400);
        const root = new THREE.Group();
        three.add(root);

        for (const object of scene.objects) {
          const mesh = buildObject(THREE, object);
          root.add(mesh);
          if (object.spin) spinTargets.current.push({ object: mesh, rate: object.spin });
        }

        for (const light of scene.lights) {
          const color = light.color ?? '#ffffff';
          const intensity = light.intensity ?? 1;
          const position = light.position ?? [4, 6, 3];
          if (light.type === 'ambient') three.add(new THREE.AmbientLight(color, intensity));
          else if (light.type === 'point') three.add(new THREE.PointLight(color, intensity, 0, 1.6));
          else {
            const directional = new THREE.DirectionalLight(color, intensity);
            directional.position.set(...position);
            three.add(directional);
          }
        }

        if (scene.spec.grid !== false) {
          const grid = new THREE.GridHelper(14, 28, 0x3a3a48, 0x26262f);
          const box = new THREE.Box3().setFromObject(root);
          const floor = Number.isFinite(box.min.y) ? Math.min(0, box.min.y) : 0;
          grid.position.y = floor - 0.001;
          gridHelper.current = grid;
          three.add(grid);
        }

        const bounds = new THREE.Box3().setFromObject(root);
        const sphere = bounds.getBoundingSphere(new THREE.Sphere());
        const radius = Math.max(0.6, sphere.radius);
        const distance = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.25;
        const direction = new THREE.Vector3(0.85, 0.62, 1).normalize();
        camera.position.copy(sphere.center.clone().add(direction.multiplyScalar(distance)));
        camera.lookAt(sphere.center);

        const controls = new OrbitControls(camera, gl.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.minDistance = radius * 0.4;
        controls.maxDistance = radius * 12;
        controls.target.copy(sphere.center);
        controls.autoRotate = Boolean(scene.spec.autoRotate);
        controls.autoRotateSpeed = Math.max(0.4, (scene.spec.autoRotate ?? 0) / 6);
        controlsRef.current = controls;
        setSpinning(controls.autoRotate);
        controls.update();

        let previous = performance.now();
        const tick = () => {
          const now = performance.now();
          const delta = Math.min(0.05, (now - previous) / 1000);
          previous = now;
          for (const target of spinTargets.current) {
            target.object.rotation.y += target.rate * delta;
          }
          controls.update();
          gl.render(three, camera);
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);

        observer = new ResizeObserver(() => {
          const w = container.clientWidth;
          const h = container.clientHeight;
          if (!w || !h) return;
          gl.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        });
        observer.observe(container);

        disposer.current = () => {
          cancelAnimationFrame(frame);
          observer?.disconnect();
          controls.dispose();
          three.traverse((node) => {
            const mesh = node as unknown as { geometry?: { dispose: () => void }; material?: { dispose: () => void } | Array<{ dispose: () => void }> };
            mesh.geometry?.dispose();
            if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
            else mesh.material?.dispose();
          });
          gl.dispose();
          gl.forceContextLoss?.();
          gl.domElement.remove();
          renderer.current = null;
        };

        setStatus('ready');
      } catch (error) {
        if (cancelled) return;
        setStatus('error');
        setMessage(error instanceof Error ? error.message : 'WebGL is unavailable in this webview.');
      }
    })();

    return () => {
      cancelled = true;
      disposer.current?.();
      disposer.current = null;
      sceneRef.current = null;
      controlsRef.current = null;
      spinTargets.current = [];
      gridHelper.current = null;
    };
    // Rebuild only when the spec body changes, not on every keystroke of a re-render.
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = useCallback(() => {
    const controls = controlsRef.current;
    const camera = controls?.object;
    if (!controls || !camera) return;
    const target = controls.target.clone();
    camera.position.set(target.x * 1.2 + 4, target.y + 3.2, target.z + 5.2);
    controls.update();
  }, []);

  const toggleSpin = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.autoRotate = !controls.autoRotate;
    setSpinning(controls.autoRotate);
  }, []);

  const exportGltf = useCallback(async () => {
    const loaded = kitRef.current;
    const target = sceneRef.current;
    if (!loaded || !target) return;
    const grid = gridHelper.current;
    const wasVisible = grid?.visible ?? false;
    if (grid) grid.visible = false;
    try {
      const exporter = new loaded.GLTFExporter();
      const result = (await exporter.parseAsync(target, { binary: true })) as ArrayBuffer;
      downloadBlob(new Blob([result], { type: 'model/gltf-binary' }), safeFilename(spec?.title, 'scene', 'glb'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'GLB export failed.');
    } finally {
      if (grid) grid.visible = wasVisible;
    }
  }, [spec?.title]);

  const exportObj = useCallback(() => {
    const loaded = kitRef.current;
    const target = sceneRef.current;
    if (!loaded || !target) return;
    const grid = gridHelper.current;
    const wasVisible = grid?.visible ?? false;
    if (grid) grid.visible = false;
    try {
      const text = new loaded.OBJExporter().parse(target);
      downloadText(text, safeFilename(spec?.title, 'scene', 'obj'), 'text/plain;charset=utf-8');
    } finally {
      if (grid) grid.visible = wasVisible;
    }
  }, [spec?.title]);

  if (parsed.error || normalized?.error || !scene) {
    return (
      <VisualError
        message={parsed.error ?? normalized?.error ?? 'The scene spec could not be read.'}
        hint='Emit a fenced block tagged `scene`: { "title": "…", "objects": [ { "type": "box", "size": [1,2,1], "color": "#efc07a" } ], "autoRotate": 12 }.'
        code={code}
      />
    );
  }

  const height = Math.min(560, Math.max(240, spec?.height ?? 360));

  return (
    <div>
      <div className="relative bg-ink-1000" style={{ height }}>
        <div ref={host} className="absolute inset-0" />
        {status !== 'ready' ? (
          <div className="absolute inset-0 grid place-items-center px-6 text-center">
            {status === 'loading' ? (
              <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-wider text-faint">
                <Loader2 size={13} className="animate-spin text-accent" />
                building scene
              </div>
            ) : (
              <div className="max-w-md">
                <p className="text-[12px] text-danger">{message || 'This webview cannot start WebGL.'}</p>
                <p className="mt-1 text-[11px] text-muted">
                  The spec is still valid — download it and open it in a GPU-capable browser, or ask for a chart instead.
                </p>
                {spec ? (
                  <button
                    onClick={() => downloadJson({ type: 'scene', ...spec }, safeFilename(spec.title, 'scene', 'json'))}
                    className="mt-2 rounded-md border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-2 hover:bg-white/5"
                  >
                    download spec
                  </button>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
        {status === 'ready' ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5">
            <span className="pointer-events-none rounded-md border border-line-soft bg-ink-1000/70 px-2 py-1 font-mono text-[9.5px] uppercase tracking-wider text-faint backdrop-blur">
              drag to orbit · wheel to zoom
            </span>
            <div className="pointer-events-auto flex items-center gap-1 rounded-md border border-line-soft bg-ink-1000/70 p-0.5 backdrop-blur">
              <button
                onClick={toggleSpin}
                title={spinning ? 'Stop auto-rotation' : 'Auto-rotate'}
                className={`rounded px-1.5 py-1 transition-colors ${spinning ? 'bg-white/[0.07] text-accent' : 'text-faint hover:text-fg-2'}`}
              >
                <Orbit size={12} />
              </button>
              <button onClick={reset} title="Reset view" className="rounded px-1.5 py-1 text-faint transition-colors hover:text-fg-2">
                <RotateCcw size={12} />
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <VisualFooter note={`${scene.objects.length} object${scene.objects.length === 1 ? '' : 's'}`}>
        <FooterButton icon={<Box size={11} />} label="glb" title="Export for Blender, Unity, three.js" onClick={() => void exportGltf()} />
        <FooterButton icon={<Download size={11} />} label="obj" title="Export as Wavefront OBJ" onClick={exportObj} />
        <FooterButton
          icon={<FileJson size={11} />}
          label="spec"
          title="Export the JSON that produced this"
          onClick={() => downloadJson({ type: 'scene', ...spec }, safeFilename(spec?.title, 'scene', 'json'))}
        />
      </VisualFooter>
    </div>
  );
}

function sceneColor(value: string | undefined) {
  return value && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : '#14141c';
}

function buildObject(THREE: ThreeKit['THREE'], object: SceneObject): Object3D {
  const size = object.size ?? [];
  const radius = object.radius ?? size[0] ?? 0.6;
  let geometry: import('three').BufferGeometry;
  switch (object.type) {
    case 'sphere':
      geometry = new THREE.SphereGeometry(radius, 48, 32);
      break;
    case 'cylinder':
      geometry = new THREE.CylinderGeometry(radius, radius, size[1] ?? 1.2, 48);
      break;
    case 'cone':
      geometry = new THREE.ConeGeometry(radius, size[1] ?? 1.2, 48);
      break;
    case 'torus':
      geometry = new THREE.TorusGeometry(radius, Math.max(0.05, radius * 0.32), 32, 96);
      break;
    case 'plane':
      geometry = new THREE.PlaneGeometry(size[0] ?? 3, size[1] ?? 3);
      break;
    case 'ring':
      geometry = new THREE.RingGeometry(Math.max(0.05, radius * 0.55), radius, 64);
      break;
    case 'box':
    default:
      geometry = new THREE.BoxGeometry(size[0] ?? 1, size[1] ?? 1, size[2] ?? 1);
      break;
  }

  const opacity = typeof object.opacity === 'number' ? Math.max(0.05, Math.min(1, object.opacity)) : 1;
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(object.color ?? '#efc07a'),
    roughness: 0.4,
    metalness: 0.18,
    flatShading: false,
    transparent: opacity < 1,
    opacity,
    wireframe: Boolean(object.wireframe),
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  if (object.position) mesh.position.set(...object.position);
  if (object.rotation) mesh.rotation.set(...object.rotation);
  else if (object.type === 'plane' || object.type === 'ring') mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

