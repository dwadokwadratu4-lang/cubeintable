import * as THREE from 'three';
import { createBimShellMaterials } from './createCubeMaterials';

export const H1 = 0.25; // Etap 1: Fundamenty (0.25 wysokości)
export const H2 = 0.5; // Etap 2: Konstrukcja nośna (0.50 wysokości)
export const H3 = 0.25; // Etap 3: Dach i zwieńczenie (0.25 wysokości)
export const TOTAL_HEIGHT = H1 + H2 + H3; // 1.00 (idealny sześcian 1:1:1)
export const BIM_WORLD_SCALE = 0.9; // Skala 90% dla wygodnego kadrowania na telefonie
export const HIDDEN_CLEARANCE = 0.008;

export interface HotspotInfo {
  id: 'hotspot-boiler' | 'hotspot-pipe';
  zone: string;
  status: string;
  drawing: string;
  details: string;
}

export const HOTSPOTS: Record<HotspotInfo['id'], HotspotInfo> = {
  'hotspot-boiler': {
    id: 'hotspot-boiler',
    zone: 'Strefa A: Kocioł / Konstrukcja',
    status: 'Zatwierdzono',
    drawing: 'Rys. 04-B',
    details:
      'Główny korpus konstrukcyjny z kotłem parowym wysokosprawnym posadowionym na płycie żelbetowej.',
  },
  'hotspot-pipe': {
    id: 'hotspot-pipe',
    zone: 'Strefa B: Rurociąg pary / Oś B-2',
    status: 'W trakcie odbioru',
    drawing: 'Rys. 07-M',
    details:
      'Magistrala pary DN150 z kompensacją termiczną i armaturą odcinającą przy osi konstrukcyjnej B-2.',
  },
};

function createHotspotBadgeTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, size, size);

    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 54, 0, Math.PI * 2);
    ctx.fillStyle = '#0ea5e9';
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 68px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('i', size / 2, size / 2 + 3);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createAxisArrowsGroup(): THREE.Group {
  const group = new THREE.Group();
  const origin = new THREE.Vector3(0, 0.002, 0);
  const length = 0.42;
  const headLen = 0.075;
  const headWidth = 0.036;

  const arrowX = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0),
    origin,
    length,
    0xef4444,
    headLen,
    headWidth
  );
  const arrowY = new THREE.ArrowHelper(
    new THREE.Vector3(0, 1, 0),
    origin,
    length,
    0x22c55e,
    headLen,
    headWidth
  );
  const arrowZ = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1),
    origin,
    length,
    0x3b82f6,
    headLen,
    headWidth
  );

  group.add(arrowX, arrowY, arrowZ);
  return group;
}

export interface BimStage {
  root: THREE.Group;
  bimTurnGroup: THREE.Group;
  seg1Group: THREE.Group;
  seg2Group: THREE.Group;
  seg3Group: THREE.Group;
  mepGroup: THREE.Group;
  hotspotsGroup: THREE.Group;
  hotspotHitboxes: THREE.Mesh[];
  setXrayMode: (enabled: boolean) => void;
  setImpactFlash: (intensity: number) => void;
  updateVisuals: (params: {
    emergence: number;
    seg1DropOffset: number;
    seg2DropOffset: number;
    seg3DropOffset: number;
    elapsed: number;
    xrayMode: boolean;
    collisionActive: boolean;
  }) => void;
  dispose: () => void;
}

export function createBimStage(maxAnisotropy: number): BimStage {
  const root = new THREE.Group();
  const geometriesToDispose: THREE.BufferGeometry[] = [];
  const materialsToDispose: THREE.Material[] = [];
  const texturesToDispose: THREE.Texture[] = [];

  // 1. Invisible floor occluder mask (colorWrite: false) at Y = 0
  const occluderGeo = new THREE.PlaneGeometry(8, 8);
  occluderGeo.rotateX(-Math.PI / 2);
  const occluderMat = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: true,
    depthTest: true,
    side: THREE.FrontSide,
  });
  const occluderMesh = new THREE.Mesh(occluderGeo, occluderMat);
  occluderMesh.position.y = 0;
  occluderMesh.renderOrder = 0;
  root.add(occluderMesh);
  geometriesToDispose.push(occluderGeo);
  materialsToDispose.push(occluderMat);

  // 2. Shadow-catcher plane flush on Y = 0
  const shadowGeo = new THREE.PlaneGeometry(2.6, 2.6);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.ShadowMaterial({
    opacity: 0.42,
    transparent: true,
    depthWrite: false,
  });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.position.y = 0.0005;
  shadowMesh.receiveShadow = true;
  shadowMesh.renderOrder = 1;
  root.add(shadowMesh);
  geometriesToDispose.push(shadowGeo);
  materialsToDispose.push(shadowMat);

  // 3. Technical Dimensional Grid (THREE.GridHelper) + X/Y/Z Axis Arrows at Y = 0
  const gridHelper = new THREE.GridHelper(1.2, 12, 0x38bdf8, 0x94a3b8);
  gridHelper.position.y = 0.001;
  const gridMats = Array.isArray(gridHelper.material)
    ? gridHelper.material
    : [gridHelper.material];
  gridMats.forEach((m) => {
    m.transparent = true;
    m.opacity = 0.55;
    m.depthWrite = false;
  });
  gridHelper.renderOrder = 2;
  root.add(gridHelper);

  const axesGroup = createAxisArrowsGroup();
  root.add(axesGroup);

  // 4. Impact shockwave ring on the HIRO marker plane
  const shockwaveGeo = new THREE.RingGeometry(0.32, 0.38, 48);
  shockwaveGeo.rotateX(-Math.PI / 2);
  const shockwaveMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shockwaveMesh = new THREE.Mesh(shockwaveGeo, shockwaveMat);
  shockwaveMesh.position.y = 0.002;
  shockwaveMesh.visible = false;
  shockwaveMesh.renderOrder = 2;
  root.add(shockwaveMesh);
  geometriesToDispose.push(shockwaveGeo);
  materialsToDispose.push(shockwaveMat);

  // 5. Rotatable BIM Building Container scaled to 50% (0.5 x 0.5 x 0.5 cube at 100%)
  const bimTurnGroup = new THREE.Group();
  bimTurnGroup.position.set(0, 0, 0);
  bimTurnGroup.scale.set(BIM_WORLD_SCALE, BIM_WORLD_SCALE, BIM_WORLD_SCALE);
  root.add(bimTurnGroup);

  const shellBundle = createBimShellMaterials(maxAnisotropy);

  // --- Segment 1: Etap 1: Fundamenty (1.0 x 0.25 x 1.0, bottom flush at Y = 0) ---
  const seg1Group = new THREE.Group();
  const seg1Geo = new THREE.BoxGeometry(1.0, H1, 1.0);
  seg1Geo.translate(0, H1 / 2, 0); // bottom at local y = 0, top at local y = H1
  const seg1Mesh = new THREE.Mesh(seg1Geo, shellBundle.foundationMaterial);
  seg1Mesh.castShadow = true;
  seg1Mesh.receiveShadow = true;
  seg1Mesh.renderOrder = 5;

  const seg1EdgesGeo = new THREE.EdgesGeometry(seg1Geo);
  const edgeMat = new THREE.LineBasicMaterial({
    color: 0x0f172a,
    transparent: true,
    opacity: 0.42,
  });
  const seg1Edges = new THREE.LineSegments(seg1EdgesGeo, edgeMat);
  seg1Edges.renderOrder = 5;
  seg1Group.add(seg1Mesh, seg1Edges);
  bimTurnGroup.add(seg1Group);
  geometriesToDispose.push(seg1Geo, seg1EdgesGeo);
  materialsToDispose.push(edgeMat);

  // --- Segment 2: Etap 2: Konstrukcja nośna (1.0 x 0.50 x 1.0, AW on front) ---
  const seg2Group = new THREE.Group();
  seg2Group.position.y = H1;
  const seg2Geo = new THREE.BoxGeometry(1.0, H2, 1.0);
  seg2Geo.translate(0, H2 / 2, 0); // pivot at bottom-center (y = H1)
  const seg2Mesh = new THREE.Mesh(seg2Geo, shellBundle.coreMaterials);
  seg2Mesh.castShadow = true;
  seg2Mesh.receiveShadow = true;
  seg2Mesh.renderOrder = 5;

  const seg2EdgesGeo = new THREE.EdgesGeometry(seg2Geo);
  const seg2Edges = new THREE.LineSegments(seg2EdgesGeo, edgeMat);
  seg2Edges.renderOrder = 5;
  seg2Group.add(seg2Mesh, seg2Edges);
  bimTurnGroup.add(seg2Group);
  geometriesToDispose.push(seg2Geo, seg2EdgesGeo);

  // --- Segment 3: Etap 3: Dach i zwieńczenie (1.0 x 0.25 x 1.0) ---
  const seg3Group = new THREE.Group();
  seg3Group.position.y = H1 + H2;
  const seg3Geo = new THREE.BoxGeometry(1.0, H3, 1.0);
  seg3Geo.translate(0, H3 / 2, 0); // pivot at bottom-center (y = H1 + H2)
  const seg3Mesh = new THREE.Mesh(seg3Geo, shellBundle.roofMaterial);
  seg3Mesh.castShadow = true;
  seg3Mesh.receiveShadow = true;
  seg3Mesh.renderOrder = 5;

  const seg3EdgesGeo = new THREE.EdgesGeometry(seg3Geo);
  const seg3Edges = new THREE.LineSegments(seg3EdgesGeo, edgeMat);
  seg3Edges.renderOrder = 5;
  seg3Group.add(seg3Mesh, seg3Edges);
  bimTurnGroup.add(seg3Group);
  geometriesToDispose.push(seg3Geo, seg3EdgesGeo);

  // --- Internal MEP Installation (Sized strictly inside H2 = 0.50 and XZ [-0.36, 0.36]) ---
  const mepGroup = new THREE.Group();
  mepGroup.position.y = H1;

  const skidGeo = new THREE.BoxGeometry(0.48, 0.03, 0.38);
  const skidMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.7,
    roughness: 0.35,
  });
  const skidMesh = new THREE.Mesh(skidGeo, skidMat);
  skidMesh.position.set(0, 0.015, 0);
  skidMesh.renderOrder = 3;
  mepGroup.add(skidMesh);
  geometriesToDispose.push(skidGeo);
  materialsToDispose.push(skidMat);

  // Orange glowing boiler cylinder (y in [0.03, 0.24])
  const boilerGeo = new THREE.CylinderGeometry(0.115, 0.115, 0.21, 24);
  const boilerMat = new THREE.MeshStandardMaterial({
    color: 0xf97316,
    emissive: 0xea580c,
    emissiveIntensity: 0.55,
    metalness: 0.45,
    roughness: 0.28,
  });
  const boilerMesh = new THREE.Mesh(boilerGeo, boilerMat);
  boilerMesh.position.set(-0.08, 0.135, 0);
  boilerMesh.renderOrder = 3;
  mepGroup.add(boilerMesh);
  geometriesToDispose.push(boilerGeo);
  materialsToDispose.push(boilerMat);

  // Blue glowing upper dome / manifold (y in [0.24, 0.295])
  const domeGeo = new THREE.CylinderGeometry(0.075, 0.115, 0.055, 24);
  const domeMat = new THREE.MeshStandardMaterial({
    color: 0x0ea5e9,
    emissive: 0x0284c7,
    emissiveIntensity: 0.6,
    metalness: 0.5,
    roughness: 0.25,
  });
  const domeMesh = new THREE.Mesh(domeGeo, domeMat);
  domeMesh.position.set(-0.08, 0.2675, 0);
  domeMesh.renderOrder = 3;
  mepGroup.add(domeMesh);
  geometriesToDispose.push(domeGeo);
  materialsToDispose.push(domeMat);

  // Pipe 1: Orange high-temp steam pipe (Oś B-2), strictly below y = 0.38 < H2 (0.50)
  const pipe1Curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.08, 0.295, 0),
    new THREE.Vector3(-0.08, 0.345, 0),
    new THREE.Vector3(0.18, 0.345, 0.06),
    new THREE.Vector3(0.28, 0.2, 0.1),
    new THREE.Vector3(0.28, 0.05, 0.1),
  ]);
  const pipe1Geo = new THREE.TubeGeometry(pipe1Curve, 28, 0.024, 12, false);
  const pipe1Mat = new THREE.MeshStandardMaterial({
    color: 0xfb923c,
    emissive: 0xf97316,
    emissiveIntensity: 0.5,
    metalness: 0.55,
    roughness: 0.25,
  });
  const pipe1Mesh = new THREE.Mesh(pipe1Geo, pipe1Mat);
  pipe1Mesh.renderOrder = 3;
  mepGroup.add(pipe1Mesh);
  geometriesToDispose.push(pipe1Geo);
  materialsToDispose.push(pipe1Mat);

  // Pipe 2: Blue feed/return pipe, strictly inside core
  const pipe2Curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.03, 0.12, -0.03),
    new THREE.Vector3(0.18, 0.12, -0.12),
    new THREE.Vector3(0.18, 0.26, -0.14),
    new THREE.Vector3(-0.24, 0.26, -0.14),
  ]);
  const pipe2Geo = new THREE.TubeGeometry(pipe2Curve, 24, 0.021, 12, false);
  const pipe2Mat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 0.55,
    metalness: 0.55,
    roughness: 0.25,
  });
  const pipe2Mesh = new THREE.Mesh(pipe2Geo, pipe2Mat);
  pipe2Mesh.renderOrder = 3;
  mepGroup.add(pipe2Mesh);
  geometriesToDispose.push(pipe2Geo);
  materialsToDispose.push(pipe2Mat);

  bimTurnGroup.add(mepGroup);

  // --- Interactive 3D Hotspots (on front near "AW" & right wall) ---
  const hotspotsGroup = new THREE.Group();
  const hotspotHitboxes: THREE.Mesh[] = [];
  const hotspotBadgeTex = createHotspotBadgeTexture();
  texturesToDispose.push(hotspotBadgeTex);

  const hotspotSpecs: Array<{
    id: HotspotInfo['id'];
    position: [number, number, number];
  }> = [
    { id: 'hotspot-boiler', position: [0.3, H1 + 0.3, 0.55] },
    { id: 'hotspot-pipe', position: [0.55, H1 + 0.26, 0.12] },
  ];

  const hotspotOrbGeo = new THREE.SphereGeometry(0.056, 20, 20);
  const hitboxGeo = new THREE.SphereGeometry(0.16, 12, 12);
  const hitboxMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  geometriesToDispose.push(hotspotOrbGeo, hitboxGeo);
  materialsToDispose.push(hitboxMat);

  const hotspotOrbs: THREE.Group[] = [];

  hotspotSpecs.forEach((spec) => {
    const holder = new THREE.Group();
    holder.position.set(...spec.position);

    const orbMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.85,
      roughness: 0.2,
      metalness: 0.2,
    });
    const orb = new THREE.Mesh(hotspotOrbGeo, orbMat);
    orb.renderOrder = 6;
    materialsToDispose.push(orbMat);

    const spriteMat = new THREE.SpriteMaterial({
      map: hotspotBadgeTex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(0.17, 0.17, 1);
    sprite.position.set(0, 0.095, 0);
    sprite.renderOrder = 7;
    materialsToDispose.push(spriteMat);

    const hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
    hitbox.userData.hotspotId = spec.id;
    hotspotHitboxes.push(hitbox);

    holder.add(orb, sprite, hitbox);
    hotspotsGroup.add(holder);
    hotspotOrbs.push(holder);
  });

  bimTurnGroup.add(hotspotsGroup);

  const setXrayMode = (enabled: boolean) => {
    shellBundle.setXrayMode(enabled);
  };

  const setImpactFlash = (intensity: number) => {
    const k = THREE.MathUtils.clamp(intensity, 0, 1);
    if (k <= 0.001) {
      shockwaveMesh.visible = false;
      shockwaveMat.opacity = 0;
      return;
    }
    const waveScale = 1 + (1 - k) * 0.75;
    shockwaveMesh.visible = true;
    shockwaveMesh.scale.set(waveScale, 1, waveScale);
    shockwaveMat.opacity = k * 0.9;
  };

  const updateVisuals = ({
    emergence,
    seg1DropOffset,
    seg2DropOffset,
    seg3DropOffset,
    elapsed,
    xrayMode,
    collisionActive,
  }: {
    emergence: number;
    seg1DropOffset: number;
    seg2DropOffset: number;
    seg3DropOffset: number;
    elapsed: number;
    xrayMode: boolean;
    collisionActive: boolean;
  }) => {
    const p = THREE.MathUtils.clamp(emergence, 0, 100);

    // Segment 1 (0% - 33%):
    // 0% -> completely hidden under Y = 0 (-HIDDEN_CLEARANCE)
    // 5% -> protrudes 5% of total target height (0.05) above Y = 0
    // 33%..100% -> full foundation standing flush with bottom face at Y = 0
    let seg1TopY: number;
    if (p <= 5) {
      seg1TopY = THREE.MathUtils.lerp(-HIDDEN_CLEARANCE, 0.05, p / 5);
    } else if (p <= 33) {
      seg1TopY = THREE.MathUtils.lerp(0.05, H1, (p - 5) / (33 - 5));
    } else {
      seg1TopY = H1;
    }
    seg1Group.position.y = seg1TopY - H1 + seg1DropOffset;
    seg1Group.visible = true;

    // Segment 2 (34% - 75%)
    if (p > 33) {
      seg2Group.visible = true;
      const t2 = THREE.MathUtils.clamp((p - 33) / (75 - 33), 0, 1);
      const scaleY2 = THREE.MathUtils.lerp(0.16, 1.0, t2);
      seg2Group.scale.y = scaleY2;
      seg2Group.position.y = H1 + seg2DropOffset;

      // Keep internal MEP boiler & pipes strictly enclosed within current Segment 2 height
      mepGroup.visible = true;
      const mepScaleXZ = THREE.MathUtils.clamp(t2 * 1.35, 0.22, 1.0);
      const mepScaleY = Math.min(mepScaleXZ, scaleY2 * 0.92);
      mepGroup.scale.set(mepScaleXZ, mepScaleY, mepScaleXZ);
      mepGroup.position.y = H1 + seg2DropOffset;

      hotspotsGroup.visible = seg2DropOffset < 0.08;
      hotspotOrbs[0].position.y = H1 + H2 * scaleY2 * 0.6;
      hotspotOrbs[1].position.y = H1 + H2 * scaleY2 * 0.54;
    } else {
      seg2Group.visible = false;
      mepGroup.visible = false;
      hotspotsGroup.visible = false;
    }

    // Segment 3 (76% - 100%)
    if (p > 75) {
      seg3Group.visible = true;
      const t3 = THREE.MathUtils.clamp((p - 75) / (100 - 75), 0, 1);
      seg3Group.scale.y = THREE.MathUtils.lerp(0.25, 1.0, t3);
      seg3Group.position.y = H1 + H2 + seg3DropOffset;
    } else {
      seg3Group.visible = false;
    }

    // Gentle pulse on 3D hotspots
    if (hotspotsGroup.visible) {
      const pulse = 1 + Math.sin(elapsed * 4.2) * 0.14;
      hotspotOrbs.forEach((orb) => {
        orb.scale.setScalar(pulse);
      });
    }

    // Collision red alarm pulsing on shell + internal steam pipe/boiler
    if (collisionActive) {
      const alarmWave = 0.5 + 0.5 * Math.sin(elapsed * 11.0);
      shellBundle.setCollisionPulse(alarmWave * (xrayMode ? 0.5 : 0.85));
      pipe1Mat.emissive.setHex(0xff0000);
      pipe1Mat.emissiveIntensity = 0.6 + alarmWave * 1.6;
      boilerMat.emissive.setHex(0xef4444);
      boilerMat.emissiveIntensity = 0.5 + alarmWave * 1.2;
    } else {
      shellBundle.setCollisionPulse(0);
      pipe1Mat.emissive.setHex(0xf97316);
      pipe1Mat.emissiveIntensity = xrayMode ? 0.9 : 0.5;
      boilerMat.emissive.setHex(0xea580c);
      boilerMat.emissiveIntensity = xrayMode ? 0.95 : 0.55;
    }
    domeMat.emissiveIntensity = xrayMode ? 0.95 : 0.6;
    pipe2Mat.emissiveIntensity = xrayMode ? 0.95 : 0.55;
  };

  const dispose = () => {
    gridHelper.dispose();
    shellBundle.dispose();
    geometriesToDispose.forEach((g) => g.dispose());
    materialsToDispose.forEach((m) => m.dispose());
    texturesToDispose.forEach((t) => t.dispose());
  };

  return {
    root,
    bimTurnGroup,
    seg1Group,
    seg2Group,
    seg3Group,
    mepGroup,
    hotspotsGroup,
    hotspotHitboxes,
    setXrayMode,
    setImpactFlash,
    updateVisuals,
    dispose,
  };
}
