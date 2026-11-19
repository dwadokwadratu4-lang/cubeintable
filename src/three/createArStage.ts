import * as THREE from 'three';
import { createCubeMaterials } from './createCubeMaterials';

export const CUBE_SIZE = 1.1;
export const HIDDEN_CLEARANCE = 0.006;

const BASE_COLOR_OUTER = new THREE.Color(0xffffff);
const BASE_COLOR_INNER = new THREE.Color(0x2dd4bf);
const FLASH_COLOR = new THREE.Color(0x67e8f9);

export interface ArStage {
  root: THREE.Group;
  cubeGroup: THREE.Group;
  setEmergence: (normalized: number) => void;
  getCubeTargetY: (normalized: number) => number;
  getMinY: () => number;
  getMaxY: () => number;
  setImpactEffect: (intensity: number) => void;
  dispose: () => void;
}

function createSquareOutlineGeometry(halfSize: number, thickness: number): THREE.BufferGeometry {
  const outer = halfSize + thickness / 2;
  const inner = halfSize - thickness / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-outer, -outer);
  shape.lineTo(outer, -outer);
  shape.lineTo(outer, outer);
  shape.lineTo(-outer, outer);
  shape.closePath();

  const hole = new THREE.Path();
  hole.moveTo(-inner, -inner);
  hole.lineTo(-inner, inner);
  hole.lineTo(inner, inner);
  hole.lineTo(inner, -inner);
  hole.closePath();
  shape.holes.push(hole);

  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

export function createArStage(maxAnisotropy: number): ArStage {
  const root = new THREE.Group();

  // 1. Invisible floor occlusion mask (colorWrite: false)
  // Rendered first (renderOrder = 0) so any cube geometry below y = 0
  // fails the depth test and is completely masked out over the AR camera feed.
  const occluderGeo = new THREE.PlaneGeometry(24, 24);
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

  // 2. Transparent shadow-catcher plane right above the occluder
  const shadowGeo = new THREE.PlaneGeometry(10, 10);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.ShadowMaterial({
    opacity: 0.38,
    transparent: true,
    depthWrite: false,
  });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.position.y = 0.001;
  shadowMesh.receiveShadow = true;
  shadowMesh.renderOrder = 1;
  root.add(shadowMesh);

  // 3. HIRO-style marker outline & reticle on the virtual plane (y = 0.002)
  const reticleGroup = new THREE.Group();
  reticleGroup.position.y = 0.002;

  const markerOutlineGeo = createSquareOutlineGeometry(0.92, 0.036);
  const markerOutlineMat = new THREE.MeshBasicMaterial({
    color: BASE_COLOR_OUTER.clone(),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const markerOutline = new THREE.Mesh(markerOutlineGeo, markerOutlineMat);
  markerOutline.renderOrder = 2;
  reticleGroup.add(markerOutline);

  const innerRingGeo = new THREE.RingGeometry(0.72, 0.742, 64);
  innerRingGeo.rotateX(-Math.PI / 2);
  const innerRingMat = new THREE.MeshBasicMaterial({
    color: BASE_COLOR_INNER.clone(),
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
  innerRing.renderOrder = 2;
  reticleGroup.add(innerRing);

  // Expanding impact shockwave outline (visible only during impact flash)
  const shockwaveGeo = createSquareOutlineGeometry(0.92, 0.045);
  const shockwaveMat = new THREE.MeshBasicMaterial({
    color: 0x67e8f9,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const shockwaveMesh = new THREE.Mesh(shockwaveGeo, shockwaveMat);
  shockwaveMesh.position.y = 0.001;
  shockwaveMesh.visible = false;
  shockwaveMesh.renderOrder = 2;
  reticleGroup.add(shockwaveMesh);

  // Four cardinal tick marks outside the marker frame
  const tickGeo = new THREE.PlaneGeometry(0.032, 0.14);
  tickGeo.rotateX(-Math.PI / 2);
  const tickMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const tickOffsets: Array<[number, number, number]> = [
    [0, 1.06, 0],
    [0, -1.06, 0],
    [1.06, 0, Math.PI / 2],
    [-1.06, 0, Math.PI / 2],
  ];
  tickOffsets.forEach(([x, z, rotY]) => {
    const tick = new THREE.Mesh(tickGeo, tickMat);
    tick.position.set(x, 0, z);
    tick.rotation.y = rotY;
    tick.renderOrder = 2;
    reticleGroup.add(tick);
  });

  root.add(reticleGroup);

  // 4. 6-Color 3D Cube Assembly
  const cubeGroup = new THREE.Group();
  const cubeGeo = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
  const materialBundle = createCubeMaterials(maxAnisotropy);
  const cubeMesh = new THREE.Mesh(cubeGeo, materialBundle.materials);
  cubeMesh.castShadow = true;
  cubeMesh.receiveShadow = true;
  cubeMesh.renderOrder = 3;
  cubeGroup.add(cubeMesh);

  const edgesGeo = new THREE.EdgesGeometry(cubeGeo);
  const edgesMat = new THREE.LineBasicMaterial({
    color: 0x0f172a,
    transparent: true,
    opacity: 0.35,
  });
  const cubeEdges = new THREE.LineSegments(edgesGeo, edgesMat);
  cubeEdges.renderOrder = 4;
  cubeGroup.add(cubeEdges);

  root.add(cubeGroup);

  const getMinY = (): number => -CUBE_SIZE / 2 - HIDDEN_CLEARANCE;
  const getMaxY = (): number => CUBE_SIZE / 2;

  const getCubeTargetY = (normalized: number): number => {
    const t = THREE.MathUtils.clamp(normalized, 0, 1);
    return THREE.MathUtils.lerp(getMinY(), getMaxY(), t);
  };

  const setEmergence = (normalized: number): void => {
    cubeGroup.position.y = getCubeTargetY(normalized);
  };

  const setImpactEffect = (intensity: number): void => {
    const k = THREE.MathUtils.clamp(intensity, 0, 1);
    if (k <= 0.001) {
      markerOutlineMat.opacity = 0.55;
      markerOutlineMat.color.copy(BASE_COLOR_OUTER);
      innerRingMat.opacity = 0.5;
      innerRingMat.color.copy(BASE_COLOR_INNER);
      tickMat.opacity = 0.55;
      reticleGroup.scale.set(1, 1, 1);
      shockwaveMesh.visible = false;
      shockwaveMat.opacity = 0;
      return;
    }

    // Bright flash & subtle pulse on the marker outline
    markerOutlineMat.opacity = THREE.MathUtils.lerp(0.55, 1.0, k);
    markerOutlineMat.color.copy(BASE_COLOR_OUTER).lerp(FLASH_COLOR, k * 0.85);

    innerRingMat.opacity = THREE.MathUtils.lerp(0.5, 1.0, k);
    innerRingMat.color.copy(BASE_COLOR_INNER).lerp(BASE_COLOR_OUTER, k * 0.75);

    tickMat.opacity = THREE.MathUtils.lerp(0.55, 1.0, k);

    const pulseScale = 1 + k * 0.055;
    reticleGroup.scale.set(pulseScale, 1, pulseScale);

    // Expanding shockwave outline
    const waveProgress = 1 - k;
    const waveScale = 1 + waveProgress * 0.55;
    shockwaveMesh.visible = true;
    shockwaveMesh.scale.set(waveScale, 1, waveScale);
    shockwaveMat.opacity = k * 0.85;
  };

  setEmergence(1);

  const dispose = (): void => {
    occluderGeo.dispose();
    occluderMat.dispose();
    shadowGeo.dispose();
    shadowMat.dispose();
    markerOutlineGeo.dispose();
    markerOutlineMat.dispose();
    innerRingGeo.dispose();
    innerRingMat.dispose();
    shockwaveGeo.dispose();
    shockwaveMat.dispose();
    tickGeo.dispose();
    tickMat.dispose();
    cubeGeo.dispose();
    edgesGeo.dispose();
    edgesMat.dispose();
    materialBundle.dispose();
  };

  return {
    root,
    cubeGroup,
    setEmergence,
    getCubeTargetY,
    getMinY,
    getMaxY,
    setImpactEffect,
    dispose,
  };
}
