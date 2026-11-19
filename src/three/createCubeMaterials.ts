import * as THREE from 'three';

export interface CubeFaceSpec {
  id: string;
  hex: string;
  edgeHex: string;
  roughness: number;
  monogram?: string;
  pattern?: 'concrete' | 'roof';
}

/**
 * Middle segment ("Etap 2: Konstrukcja nośna") 6-face specification:
 * +X: Czerwony, -X: Turkusowy, +Y: Stalowy niebieski,
 * -Y: Granatowy, +Z: Niebieski z monogramem "AW", -Z: Żółty
 */
export const CORE_FACE_SPECS: readonly CubeFaceSpec[] = [
  {
    id: 'right',
    hex: '#ef4444',
    edgeHex: '#b91c1c',
    roughness: 0.34,
  },
  {
    id: 'left',
    hex: '#14b8a6',
    edgeHex: '#0f766e',
    roughness: 0.3,
  },
  {
    id: 'top',
    hex: '#2563eb',
    edgeHex: '#1e40af',
    roughness: 0.35,
  },
  {
    id: 'bottom',
    hex: '#172554',
    edgeHex: '#0f172a',
    roughness: 0.4,
  },
  {
    id: 'front',
    hex: '#3b82f6',
    edgeHex: '#1d4ed8',
    roughness: 0.3,
    monogram: 'AW',
  },
  {
    id: 'back',
    hex: '#facc15',
    edgeHex: '#ca8a04',
    roughness: 0.34,
  },
];

function createSurfaceTexture(
  spec: CubeFaceSpec,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.fillStyle = spec.hex;
    ctx.fillRect(0, 0, size, size);

    // Subtle radial satin sheen
    const grad = ctx.createRadialGradient(
      size * 0.38,
      size * 0.34,
      size * 0.08,
      size * 0.5,
      size * 0.5,
      size * 0.78
    );
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.14)');
    grad.addColorStop(0.6, 'rgba(255, 255, 255, 0.0)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.16)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Architectural concrete formwork or roof seam lines
    if (spec.pattern === 'concrete') {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 3;
      for (let y = 128; y < size; y += 128) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(15, 23, 42, 0.25)';
      for (let x = 64; x < size; x += 128) {
        for (let y = 64; y < size; y += 128) {
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (spec.pattern === 'roof') {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = 4;
      for (let x = 64; x < size; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, 20);
        ctx.lineTo(x, size - 20);
        ctx.stroke();
      }
    }

    // Edge bevel frame
    ctx.strokeStyle = spec.edgeHex;
    ctx.lineWidth = 18;
    ctx.strokeRect(9, 9, size - 18, size - 18);

    // Inner hairline
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 3;
    ctx.strokeRect(32, 32, size - 64, size - 64);

    // Large centered "AW" monogram on the front wall
    if (spec.monogram) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font =
        '800 200px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

      ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
      ctx.fillText(spec.monogram, size / 2 + 4, size / 2 + 10);

      ctx.fillStyle = '#ffffff';
      ctx.fillText(spec.monogram, size / 2, size / 2 + 4);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.fillRect(size / 2 - 74, size / 2 + 96, 148, 6);
      ctx.restore();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.max(1, maxAnisotropy);
  texture.needsUpdate = true;
  return texture;
}

export interface BimMaterialBundle {
  foundationMaterial: THREE.MeshStandardMaterial;
  coreMaterials: THREE.MeshStandardMaterial[];
  roofMaterial: THREE.MeshStandardMaterial;
  allShellMaterials: THREE.MeshStandardMaterial[];
  setXrayMode: (enabled: boolean) => void;
  setCollisionPulse: (intensity: number) => void;
  dispose: () => void;
}

export function createBimShellMaterials(maxAnisotropy: number): BimMaterialBundle {
  const textures: THREE.CanvasTexture[] = [];

  const foundationTex = createSurfaceTexture(
    {
      id: 'foundation',
      hex: '#1e3a5f',
      edgeHex: '#0f172a',
      roughness: 0.72,
      pattern: 'concrete',
    },
    maxAnisotropy
  );
  textures.push(foundationTex);

  const foundationMaterial = new THREE.MeshStandardMaterial({
    map: foundationTex,
    roughness: 0.72,
    metalness: 0.08,
    envMapIntensity: 0.75,
  });

  const coreMaterials = CORE_FACE_SPECS.map((spec) => {
    const tex = createSurfaceTexture(spec, maxAnisotropy);
    textures.push(tex);
    return new THREE.MeshStandardMaterial({
      map: tex,
      roughness: spec.roughness,
      metalness: 0.1,
      envMapIntensity: 0.9,
    });
  });

  const roofTex = createSurfaceTexture(
    {
      id: 'roof',
      hex: '#ea580c',
      edgeHex: '#9a3412',
      roughness: 0.42,
      pattern: 'roof',
    },
    maxAnisotropy
  );
  textures.push(roofTex);

  const roofMaterial = new THREE.MeshStandardMaterial({
    map: roofTex,
    roughness: 0.42,
    metalness: 0.12,
    envMapIntensity: 0.85,
  });

  const allShellMaterials = [
    foundationMaterial,
    ...coreMaterials,
    roofMaterial,
  ];

  const setXrayMode = (enabled: boolean) => {
    allShellMaterials.forEach((mat) => {
      mat.transparent = enabled;
      mat.opacity = enabled ? 0.25 : 1.0;
      mat.depthWrite = !enabled;
      mat.needsUpdate = true;
    });
  };

  const setCollisionPulse = (intensity: number) => {
    const k = THREE.MathUtils.clamp(intensity, 0, 1);
    allShellMaterials.forEach((mat) => {
      if (k > 0.001) {
        mat.emissive.setHex(0xdc2626);
        mat.emissiveIntensity = k * 0.75;
      } else {
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
      }
    });
  };

  return {
    foundationMaterial,
    coreMaterials,
    roofMaterial,
    allShellMaterials,
    setXrayMode,
    setCollisionPulse,
    dispose: () => {
      allShellMaterials.forEach((mat) => mat.dispose());
      textures.forEach((tex) => tex.dispose());
    },
  };
}
