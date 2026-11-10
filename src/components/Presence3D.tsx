import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { VoiceCharacter } from '@shared/types';
import { cn } from './ui';

export type PresenceState = 'idle' | 'listening' | 'thinking' | 'speaking';

/**
 * Four deliberate characters, not one blob with a colour slider:
 *   Aura     — a warm core inside a halo, the default generalist.
 *   Prism    — faceted crystal with orbiting shards; sharper, more analytical.
 *   Sentinel — a gyroscope; watchful, mechanical, good for security work.
 *   Wisp     — a particle cloud; quiet and atmospheric.
 *
 * The canvas is presentational only. It reacts to the conversation state, and
 * it fails closed to a CSS orb when WebGL is unavailable.
 */
export function Presence3D({
  character,
  state,
  accent = '#f0b429',
  className,
}: {
  character: VoiceCharacter;
  state: PresenceState;
  accent?: string;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      setFailed(true);
      return;
    }
    setFailed(false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0, 6.4);
    const root = new THREE.Group();
    scene.add(root);

    const color = new THREE.Color(accent);
    const reduced = document.documentElement.dataset.motion === 'reduced';
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.PointLight(color, 55, 24, 2);
    key.position.set(2.5, 2.5, 3.5);
    scene.add(key);
    const rim = new THREE.PointLight(new THREE.Color('#82aaff'), 28, 22, 2);
    rim.position.set(-3.2, -2.2, -2.5);
    scene.add(rim);

    const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
    const track = <T extends THREE.BufferGeometry | THREE.Material>(value: T): T => {
      disposables.push(value);
      return value;
    };

    const glow = (value: string | THREE.Color, opacity = 1) =>
      track(new THREE.MeshBasicMaterial({ color: value, transparent: opacity < 1, opacity, depthWrite: false }));

    const points = (count: number, inner: number, outer: number, size: number, opacity = 0.7) => {
      const positions = new Float32Array(count * 3);
      const random = mulberry(0x5eed + count);
      for (let i = 0; i < count; i++) {
        const radius = inner + random() * (outer - inner);
        const theta = random() * Math.PI * 2;
        const phi = Math.acos(2 * random() - 1);
        positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = radius * Math.cos(phi);
      }
      const geometry = track(new THREE.BufferGeometry());
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      return new THREE.Points(
        geometry,
        track(
          new THREE.PointsMaterial({
            color,
            size,
            transparent: true,
            opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true,
          }),
        ),
      );
    };

    const initial = buildCharacter(character, color, track, glow, points);
    root.add(initial.group);

    let raf = 0;
    const started = performance.now();
    const clock = new THREE.Clock();

    const resize = () => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const render = () => {
      const t = (performance.now() - started) / 1000;
      const current = stateRef.current;
      initial.update(t, current, clock.getDelta());
      renderer.render(scene, camera);
      raf = requestAnimationFrame(render);
    };

    if (reduced) {
      initial.update(0.6, stateRef.current, 0.016);
      renderer.render(scene, camera);
    } else {
      raf = requestAnimationFrame(render);
    }

    const contextLost = (event: Event) => {
      event.preventDefault();
      setFailed(true);
    };
    renderer.domElement.addEventListener('webglcontextlost', contextLost);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      for (const item of disposables) item.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [character, accent]);

  return (
    <div ref={hostRef} className={cn('relative h-full w-full', className)} aria-hidden>
      {failed && (
        <div className="absolute inset-0 grid place-items-center">
          <div
            className="h-40 w-40 rounded-full blur-[2px]"
            style={{
              background: `radial-gradient(circle at 35% 30%, ${accent}, transparent 62%)`,
              boxShadow: `0 0 90px ${accent}55, inset 0 0 40px #ffffff22`,
            }}
          />
        </div>
      )}
    </div>
  );
}

interface CharacterBuild {
  group: THREE.Group;
  update: (t: number, state: PresenceState, dt: number) => void;
}

function buildCharacter(
  character: VoiceCharacter,
  color: THREE.Color,
  track: <T extends THREE.BufferGeometry | THREE.Material>(value: T) => T,
  glow: (value: string | THREE.Color, opacity?: number) => THREE.MeshBasicMaterial,
  points: (count: number, inner: number, outer: number, size: number, opacity?: number) => THREE.Points,
): CharacterBuild {
  const group = new THREE.Group();
  const speedFor = (state: PresenceState) => (state === 'speaking' ? 2.6 : state === 'listening' ? 2 : state === 'thinking' ? 1.35 : 0.7);

  if (character === 'prism') {
    const core = new THREE.Mesh(
      track(new THREE.OctahedronGeometry(1.25, 0)),
      track(
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.35,
          metalness: 0.65,
          roughness: 0.18,
          flatShading: true,
        }),
      ),
    );
    const inner = new THREE.Mesh(track(new THREE.IcosahedronGeometry(0.55, 1)), glow(color, 0.5));
    const shards: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const shard = new THREE.Mesh(
        track(new THREE.TetrahedronGeometry(0.15 + (i % 3) * 0.05)),
        track(new THREE.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.25, flatShading: true })),
      );
      shard.userData.offset = (i / 6) * Math.PI * 2;
      shard.userData.radius = 1.85 + (i % 2) * 0.28;
      shards.push(shard);
      group.add(shard);
    }
    const dust = points(260, 2.1, 3, 0.025, 0.45);
    group.add(core, inner, dust);
    return {
      group,
      update(t, state, dt) {
        const speed = speedFor(state);
        core.rotation.y += dt * 0.24 * speed;
        core.rotation.x = Math.sin(t * 0.3) * 0.12;
        inner.rotation.y -= dt * 0.5;
        const pulse = state === 'speaking' ? 0.06 * Math.sin(t * 12) : state === 'listening' ? 0.03 * Math.sin(t * 5) : 0;
        core.scale.setScalar(1 + pulse);
        inner.scale.setScalar(1 + pulse * 1.6);
        dust.rotation.y = t * 0.06 * speed;
        for (const shard of shards) {
          const offset = shard.userData.offset as number;
          const radius = shard.userData.radius as number;
          const angle = offset + t * (0.24 + offset * 0.03) * speed;
          shard.position.set(Math.cos(angle) * radius, Math.sin(angle * 1.3) * 0.85, Math.sin(angle) * radius * 0.55);
          shard.rotation.x = angle;
          shard.rotation.y = angle * 1.6;
        }
      },
    };
  }

  if (character === 'sentinel') {
    const core = new THREE.Mesh(
      track(new THREE.SphereGeometry(0.52, 48, 48)),
      track(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, metalness: 0.4, roughness: 0.2 })),
    );
    const cage = new THREE.Mesh(track(new THREE.IcosahedronGeometry(0.84, 1)), glow(color, 0.16));
    cage.material.wireframe = true;
    const rings: THREE.Mesh[] = [];
    const specs = [
      { radius: 1.35, tube: 0.022, color: color.clone().offsetHSL(0, 0, 0.1), axis: 'x' },
      { radius: 1.68, tube: 0.018, color: color.clone().offsetHSL(0.08, 0, 0), axis: 'y' },
      { radius: 2.02, tube: 0.012, color: new THREE.Color('#9aa7c7'), axis: 'z' },
    ] as const;
    for (const spec of specs) {
      const ring = new THREE.Mesh(
        track(new THREE.TorusGeometry(spec.radius, spec.tube, 10, 128)),
        track(new THREE.MeshStandardMaterial({ color: spec.color, metalness: 0.7, roughness: 0.3, emissive: spec.color, emissiveIntensity: 0.3 })),
      );
      ring.rotation.x = spec.axis === 'x' ? 0.4 : spec.axis === 'y' ? 1.2 : 0.1;
      ring.userData.axis = spec.axis;
      rings.push(ring);
      group.add(ring);
    }
    const sparks = points(180, 2.2, 2.9, 0.02, 0.4);
    group.add(core, cage, sparks);
    return {
      group,
      update(t, state, dt) {
        const speed = speedFor(state);
        core.rotation.y += dt * 0.2;
        const pulse = state === 'speaking' ? 1 + 0.09 * Math.sin(t * 13) : 1 + 0.02 * Math.sin(t * 2.2);
        core.scale.setScalar(pulse);
        cage.scale.setScalar(1 + (pulse - 1) * 0.6);
        for (let i = 0; i < rings.length; i++) {
          const ring = rings[i]!;
          const axis = ring.userData.axis as string;
          const rate = (0.22 + i * 0.12) * speed;
          if (axis === 'x') ring.rotation.x += dt * rate;
          else if (axis === 'y') ring.rotation.y += dt * rate;
          else ring.rotation.z += dt * rate;
        }
        sparks.rotation.y = -t * 0.05 * speed;
      },
    };
  }

  if (character === 'wisp') {
    const cloud = points(1100, 0.35, 2.5, 0.032, 0.75);
    const inner = points(260, 0.2, 1.3, 0.045, 0.9);
    const core = new THREE.Mesh(track(new THREE.SphereGeometry(0.18, 24, 24)), glow(color, 0.9));
    group.add(cloud, inner, core);
    return {
      group,
      update(t, state, dt) {
        const speed = speedFor(state);
        cloud.rotation.y += dt * 0.07 * speed;
        cloud.rotation.z = Math.sin(t * 0.08) * 0.2;
        inner.rotation.y -= dt * 0.12 * speed;
        inner.rotation.x = Math.cos(t * 0.1) * 0.24;
        const scale = state === 'speaking' ? 1 + 0.06 * Math.sin(t * 11) : 1 + 0.02 * Math.sin(t * 1.8);
        group.scale.setScalar(scale);
        core.scale.setScalar(1 + 0.08 * Math.sin(t * 3));
      },
    };
  }

  // Aura — warm, simple, legible at a distance.
  const core = new THREE.Mesh(
    track(new THREE.IcosahedronGeometry(1.18, 5)),
    track(
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.72,
        metalness: 0.25,
        roughness: 0.28,
      }),
    ),
  );
  const shell = new THREE.Mesh(track(new THREE.IcosahedronGeometry(1.55, 2)), glow(color, 0.13));
  shell.material.wireframe = true;
  const ringA = new THREE.Mesh(
    track(new THREE.TorusGeometry(2.05, 0.01, 8, 160)),
    glow(color.clone().offsetHSL(0, 0, 0.08), 0.45),
  );
  ringA.rotation.x = 1.1;
  const ringB = new THREE.Mesh(
    track(new THREE.TorusGeometry(2.35, 0.006, 8, 160)),
    track(new THREE.MeshBasicMaterial({ color: new THREE.Color('#8fa8d8'), transparent: true, opacity: 0.2 })),
  );
  ringB.rotation.y = 1.2;
  ringB.rotation.x = 0.3;
  const halo = points(420, 1.9, 2.6, 0.02, 0.4);
  group.add(core, shell, ringA, ringB, halo);
  return {
    group,
    update(t, state, dt) {
      const speed = speedFor(state);
      core.rotation.y += dt * 0.12 * speed;
      core.rotation.x = Math.sin(t * 0.16) * 0.06;
      const pulse = state === 'speaking' ? 1 + 0.055 * Math.sin(t * 12) : state === 'listening' ? 1 + 0.028 * Math.sin(t * 4.4) : 1 + 0.012 * Math.sin(t * 1.4);
      core.scale.setScalar(pulse);
      shell.scale.setScalar(1 + (pulse - 1) * 0.7);
      shell.rotation.y -= dt * 0.05 * speed;
      ringA.rotation.z += dt * 0.16 * speed;
      ringB.rotation.y += dt * 0.1 * speed;
      halo.rotation.y = t * 0.05 * speed;
    },
  };
}

/** Deterministic particles: the presence looks the same after a reload. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
