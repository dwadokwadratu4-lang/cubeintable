import { useEffect, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { THREEx } from '@ar-js-org/ar.js-threejs';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  createBimStage,
  type BimStage,
  type HotspotInfo,
} from '../three/createBimStage';

interface ArBimViewportProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  cameraActive: boolean;
  emergence: number;
  xrayMode: boolean;
  collisionActive: boolean;
  replayDropSignal: number;
  resetRotationSignal: number;
  poseLocked: boolean;
  onMarkerVisibilityChange: (visible: boolean) => void;
  onFoundationImpact: () => void;
  onHotspotSelect: (hotspotId: HotspotInfo['id']) => void;
}

interface DropPhysics {
  active: boolean;
  offsetY: number;
  velocityY: number;
}

const GRAVITY = 22.0;
const SMOOTH_FACTOR = 0.18;
const MARKER_HIDE_GRACE_MS = 300;

// Pre-allocated math helpers outside render loop (zero GC)
const _raycaster = new THREE.Raycaster();
const _pointerNDC = new THREE.Vector2();
const _rawPos = new THREE.Vector3();
const _rawQuat = new THREE.Quaternion();
const _rawScale = new THREE.Vector3();

function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export default function ArBimViewport({
  videoRef,
  cameraActive,
  emergence,
  xrayMode,
  collisionActive,
  replayDropSignal,
  resetRotationSignal,
  poseLocked,
  onMarkerVisibilityChange,
  onFoundationImpact,
  onHotspotSelect,
}: ArBimViewportProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [contextLost, setContextLost] = useState(false);

  const cameraActiveRef = useRef(cameraActive);
  const emergenceRef = useRef(emergence);
  const prevEmergenceRef = useRef(emergence);
  const xrayModeRef = useRef(xrayMode);
  const collisionActiveRef = useRef(collisionActive);
  const poseLockedRef = useRef(poseLocked);

  const onMarkerVisRef = useRef(onMarkerVisibilityChange);
  const onFoundationImpactRef = useRef(onFoundationImpact);
  const onHotspotSelectRef = useRef(onHotspotSelect);

  const hasDroppedOnceRef = useRef(false);
  const seg1DropRef = useRef<DropPhysics>({ active: false, offsetY: 0, velocityY: 0 });
  const seg2DropRef = useRef<DropPhysics>({ active: false, offsetY: 0, velocityY: 0 });
  const seg3DropRef = useRef<DropPhysics>({ active: false, offsetY: 0, velocityY: 0 });
  const impactFlashRef = useRef(0);
  const targetTurnYRef = useRef<number | null>(null);

  const stageRef = useRef<BimStage | null>(null);
  const markerGroupRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    onMarkerVisRef.current = onMarkerVisibilityChange;
  }, [onMarkerVisibilityChange]);

  useEffect(() => {
    onFoundationImpactRef.current = onFoundationImpact;
  }, [onFoundationImpact]);

  useEffect(() => {
    onHotspotSelectRef.current = onHotspotSelect;
  }, [onHotspotSelect]);

  useEffect(() => {
    cameraActiveRef.current = cameraActive;
  }, [cameraActive]);

  useEffect(() => {
    const prev = prevEmergenceRef.current;
    prevEmergenceRef.current = emergence;
    emergenceRef.current = emergence;

    // Trigger gravity drop when crossing into Stage 2 (>33%) or Stage 3 (>75%)
    if (prev <= 33 && emergence > 33) {
      seg2DropRef.current = { active: true, offsetY: 2.3, velocityY: -1.6 };
    }
    if (prev <= 75 && emergence > 75) {
      seg3DropRef.current = { active: true, offsetY: 2.0, velocityY: -1.6 };
    }
  }, [emergence]);

  useEffect(() => {
    xrayModeRef.current = xrayMode;
    stageRef.current?.setXrayMode(xrayMode);
  }, [xrayMode]);

  useEffect(() => {
    collisionActiveRef.current = collisionActive;
  }, [collisionActive]);

  useEffect(() => {
    if (replayDropSignal > 0 && markerGroupRef.current?.visible) {
      seg1DropRef.current = { active: true, offsetY: 3.4, velocityY: -1.8 };
    }
  }, [replayDropSignal]);

  useEffect(() => {
    if (resetRotationSignal > 0) {
      targetTurnYRef.current = 0;
    }
  }, [resetRotationSignal]);

  useEffect(() => {
    poseLockedRef.current = poseLocked;
  }, [poseLocked]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    THREEx.ArToolkitContext.baseURL = '/';

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(
      isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    );
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(window.innerWidth, window.innerHeight);

    renderer.domElement.style.position = 'fixed';
    renderer.domElement.style.top = '0px';
    renderer.domElement.style.left = '0px';
    renderer.domElement.style.maxWidth = 'none';
    renderer.domElement.style.touchAction = 'none';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    // ARToolKit-driven camera (projectionMatrix copied from camera_para.dat)
    const arCamera = new THREE.PerspectiveCamera();
    scene.add(arCamera);

    // Studio environment map via RoomEnvironment
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 0.9);
    scene.add(hemiLight);

    // Raw marker group updated directly by ARToolKit
    const rawMarkerGroup = new THREE.Group();
    scene.add(rawMarkerGroup);

    // Smoothed marker group — MUST stay hidden (visible = false) until HIRO marker is physically detected
    const markerGroup = new THREE.Group();
    markerGroup.visible = false;
    markerGroupRef.current = markerGroup;
    scene.add(markerGroup);

    // Attach directional shadow-casting light inside markerGroup so shadows follow the card
    const keyLight = new THREE.DirectionalLight(0xfff7ed, 1.9);
    keyLight.position.set(2.2, 4.4, 2.4);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 10;
    keyLight.shadow.camera.left = -1.0;
    keyLight.shadow.camera.right = 1.0;
    keyLight.shadow.camera.top = 1.0;
    keyLight.shadow.camera.bottom = -1.0;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    markerGroup.add(keyLight);
    markerGroup.add(keyLight.target);
    keyLight.target.position.set(0, 0.25, 0);

    const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.7);
    rimLight.position.set(-2.4, 2.0, -2.2);
    markerGroup.add(rimLight);

    // Build 4D BIM stage inside markerGroup
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const stage = createBimStage(maxAniso);
    stageRef.current = stage;
    stage.setXrayMode(xrayModeRef.current);
    markerGroup.add(stage.root);

    // ARToolKit tracking instances (initialized when camera video dimensions are known)
    let arToolkitContext: InstanceType<typeof THREEx.ArToolkitContext> | null =
      null;
    let arMarkerControls: InstanceType<typeof THREEx.ArMarkerControls> | null =
      null;
    let arInitializedForSize = '';
    let arInitializing = false;
    let disposed = false;

    const syncCoverLayout = () => {
      const video = videoRef.current;
      const screenW = window.innerWidth;
      const screenH = window.innerHeight;

      if (
        !cameraActiveRef.current ||
        !video ||
        video.videoWidth === 0 ||
        video.videoHeight === 0
      ) {
        renderer.setSize(screenW, screenH, false);
        renderer.domElement.style.width = `${screenW}px`;
        renderer.domElement.style.height = `${screenH}px`;
        renderer.domElement.style.left = '0px';
        renderer.domElement.style.top = '0px';
        return;
      }

      const sourceAspect = video.videoWidth / video.videoHeight;
      const screenAspect = screenW / screenH;

      let displayW: number;
      let displayH: number;
      let offsetLeft = 0;
      let offsetTop = 0;

      if (screenAspect < sourceAspect) {
        displayH = screenH;
        displayW = sourceAspect * screenH;
        offsetLeft = -(displayW - screenW) / 2;
      } else {
        displayW = screenW;
        displayH = screenW / sourceAspect;
        offsetTop = -(displayH - screenH) / 2;
      }

      const wPx = `${Math.round(displayW)}px`;
      const hPx = `${Math.round(displayH)}px`;
      const leftPx = `${Math.round(offsetLeft)}px`;
      const topPx = `${Math.round(offsetTop)}px`;

      video.style.width = wPx;
      video.style.height = hPx;
      video.style.left = leftPx;
      video.style.top = topPx;

      // Match ARToolKit's 4:3 (640x480) projection matrix framing:
      // In portrait mode ARToolKit draws the 3:4 video centered inside a 4:3 canvas,
      // so the WebGL overlay canvas must have 4:3 aspect (displayH * 4/3) centered over the video.
      const isPortraitVideo = video.videoWidth < video.videoHeight;
      const canvasH = displayH;
      const canvasW = isPortraitVideo ? displayH * (4 / 3) : displayW;
      const canvasLeft = isPortraitVideo
        ? (screenW - canvasW) / 2
        : offsetLeft;
      const canvasTop = offsetTop;

      renderer.setSize(Math.round(canvasW), Math.round(canvasH), false);
      renderer.domElement.style.width = `${Math.round(canvasW)}px`;
      renderer.domElement.style.height = `${Math.round(canvasH)}px`;
      renderer.domElement.style.left = `${Math.round(canvasLeft)}px`;
      renderer.domElement.style.top = `${Math.round(canvasTop)}px`;

      if (arToolkitContext && arToolkitContext.arController) {
        arCamera.projectionMatrix.copy(arToolkitContext.getProjectionMatrix());
        arCamera.projectionMatrixInverse.copy(arCamera.projectionMatrix).invert();
      }
    };

    const disposeArTracking = () => {
      if (arMarkerControls) {
        try {
          arMarkerControls.dispose();
        } catch {
          // ignore disposal errors on unmounted controller
        }
        arMarkerControls = null;
      }
      if (arToolkitContext && arToolkitContext.arController) {
        try {
          arToolkitContext.arController.dispose();
        } catch {
          // ignore
        }
      }
      arToolkitContext = null;
      arInitializedForSize = '';
      arInitializing = false;
      rawMarkerGroup.visible = false;
      markerGroup.visible = false;
    };

    const initArTrackingIfReady = () => {
      const video = videoRef.current;
      if (
        !cameraActiveRef.current ||
        !video ||
        video.readyState < 2 ||
        video.videoWidth === 0 ||
        video.videoHeight === 0
      ) {
        return;
      }

      const sizeKey = `${video.videoWidth}x${video.videoHeight}`;
      if (arInitializedForSize === sizeKey || arInitializing) {
        return;
      }

      disposeArTracking();
      arInitializing = true;

      const vw = video.videoWidth;
      const vh = video.videoHeight;

      // ARToolKit camera_para.dat is calibrated for 4:3 (640x480); keeping 640x480
      // ensures portrait crop (_copyImageToHeap) preserves exact 1:1 cube proportions.
      const ctx = new THREEx.ArToolkitContext({
        cameraParametersUrl: '/ar/camera_para.dat',
        detectionMode: 'mono',
        canvasWidth: 640,
        canvasHeight: 480,
        maxDetectionRate: 30,
        patternRatio: 0.5,
      });

      ctx.init(() => {
        if (disposed) {
          ctx.arController?.dispose?.();
          return;
        }
        arToolkitContext = ctx;
        arInitializing = false;
        arInitializedForSize = sizeKey;

        const orientation = vw >= vh ? 'landscape' : 'portrait';
        if (ctx.arController) {
          ctx.arController.orientation = orientation;
          if (ctx.arController.options) {
            ctx.arController.options.orientation = orientation;
          }
        }

        arCamera.projectionMatrix.copy(ctx.getProjectionMatrix());
        arCamera.projectionMatrixInverse
          .copy(arCamera.projectionMatrix)
          .invert();

        arMarkerControls = new THREEx.ArMarkerControls(ctx, rawMarkerGroup, {
          type: 'pattern',
          patternUrl: '/ar/patt.hiro',
          changeMatrixMode: 'modelViewMatrix',
          minConfidence: 0.55,
        });

        syncCoverLayout();
      });
    };

    // Touch / pointer horizontal rotation + hotspot tap Raycaster
    let activePointerId: number | null = null;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let pointerTravel = 0;

    const handlePointerDown = (e: PointerEvent) => {
      if (!markerGroup.visible) return;
      activePointerId = e.pointerId;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      pointerTravel = 0;
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (activePointerId !== e.pointerId || !markerGroup.visible) return;
      const dx = e.clientX - lastPointerX;
      const dy = e.clientY - lastPointerY;
      pointerTravel += Math.hypot(dx, dy);
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;

      targetTurnYRef.current = null;
      stage.bimTurnGroup.rotation.y += dx * 0.012;
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (activePointerId !== e.pointerId) return;
      activePointerId = null;

      // Short tap -> Raycast against interactive 3D hotspots
      if (
        pointerTravel < 12 &&
        markerGroup.visible &&
        stage.hotspotsGroup.visible
      ) {
        const rect = renderer.domElement.getBoundingClientRect();
        _pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        _pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        _raycaster.setFromCamera(_pointerNDC, arCamera);
        const hits = _raycaster.intersectObjects(stage.hotspotHitboxes, false);
        if (hits.length > 0) {
          const hotspotId = hits[0].object.userData.hotspotId as
            | HotspotInfo['id']
            | undefined;
          if (hotspotId) {
            onHotspotSelectRef.current(hotspotId);
          }
        }
      }
    };

    const handlePointerCancel = (e: PointerEvent) => {
      if (activePointerId === e.pointerId) {
        activePointerId = null;
      }
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);
    renderer.domElement.addEventListener('pointercancel', handlePointerCancel);

    window.addEventListener('resize', syncCoverLayout);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const handleContextRestored = () => {
      setContextLost(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener(
      'webglcontextrestored',
      handleContextRestored
    );

    let frameId = 0;
    let timeoutId = 0;
    let lastMarkerVisible = false;
    let lastSeenMarkerAt = 0;
    let wasPoseLocked = poseLockedRef.current;
    let lastTime = performance.now();
    const startClock = performance.now();

    const stepPhysics = (
      drop: DropPhysics,
      dt: number,
      onLand?: () => void
    ) => {
      if (!drop.active) return;
      drop.velocityY -= GRAVITY * dt;
      drop.offsetY += drop.velocityY * dt;
      if (drop.offsetY <= 0) {
        drop.offsetY = 0;
        drop.velocityY = 0;
        drop.active = false;
        impactFlashRef.current = 1.0;
        onLand?.();
      }
    };

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        timeoutId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync
          ? gl.getSyncParameter(sync, gl.SYNC_STATUS)
          : gl.SIGNALED;
        if (state === gl.UNSIGNALED) {
          timeoutId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          timeoutId = window.setTimeout(cb, 80);
        }
      };
      timeoutId = window.setTimeout(poll, 5);
    }

    const tick = () => {
      if (disposed) return;

      const now = performance.now();
      const dt = Math.min(Math.max((now - lastTime) / 1000, 0.001), 0.05);
      const elapsed = (now - startClock) / 1000;
      lastTime = now;

      const video = videoRef.current;

      // Refresh grace timer on unlock so brief hand occlusion doesn't blink immediately
      if (wasPoseLocked && !poseLockedRef.current) {
        lastSeenMarkerAt = now;
      }
      wasPoseLocked = poseLockedRef.current;

      if (cameraActiveRef.current && video) {
        initArTrackingIfReady();

        if (poseLockedRef.current && markerGroup.visible) {
          // Meeting mode ("Zablokuj na stole"): freeze pose relative to camera
          lastSeenMarkerAt = now;
        } else if (
          arToolkitContext &&
          arMarkerControls &&
          video.readyState >= video.HAVE_ENOUGH_DATA
        ) {
          arToolkitContext.update(video);

          if (rawMarkerGroup.visible) {
            lastSeenMarkerAt = now;
            rawMarkerGroup.matrix.decompose(_rawPos, _rawQuat, _rawScale);

            if (!markerGroup.visible) {
              // First acquisition or re-entry after >300ms loss: snap cleanly into place
              markerGroup.visible = true;
              markerGroup.position.copy(_rawPos);
              markerGroup.quaternion.copy(_rawQuat);
              markerGroup.scale.copy(_rawScale);
            } else {
              // Anti-jitter exponential lerp & slerp (~0.18 at 60fps)
              const alpha = 1 - Math.pow(1 - SMOOTH_FACTOR, dt * 60);
              markerGroup.position.lerp(_rawPos, alpha);
              markerGroup.quaternion.slerp(_rawQuat, alpha);
              markerGroup.scale.lerp(_rawScale, alpha);
            }
          } else if (
            markerGroup.visible &&
            now - lastSeenMarkerAt >= MARKER_HIDE_GRACE_MS
          ) {
            markerGroup.visible = false;
          }
        }
      } else {
        rawMarkerGroup.visible = false;
        markerGroup.visible = false;
        lastSeenMarkerAt = 0;
        if (arToolkitContext) {
          disposeArTracking();
        }
      }

      // Detect marker visibility transitions
      const isVisible = markerGroup.visible;
      if (isVisible !== lastMarkerVisible) {
        lastMarkerVisible = isVisible;
        onMarkerVisRef.current(isVisible);

        // First physical detection of HIRO marker triggers foundation drop!
        if (isVisible && !hasDroppedOnceRef.current) {
          hasDroppedOnceRef.current = true;
          seg1DropRef.current = {
            active: true,
            offsetY: 3.4,
            velocityY: -1.8,
          };
        }
      }

      if (markerGroup.visible) {
        stepPhysics(seg1DropRef.current, dt, () => {
          onFoundationImpactRef.current();
        });
        stepPhysics(seg2DropRef.current, dt);
        stepPhysics(seg3DropRef.current, dt);

        if (impactFlashRef.current > 0) {
          impactFlashRef.current = Math.max(0, impactFlashRef.current - dt * 2.5);
          stage.setImpactFlash(impactFlashRef.current);
        }

        if (targetTurnYRef.current !== null) {
          stage.bimTurnGroup.rotation.y = THREE.MathUtils.damp(
            stage.bimTurnGroup.rotation.y,
            targetTurnYRef.current,
            10,
            dt
          );
          if (Math.abs(stage.bimTurnGroup.rotation.y - targetTurnYRef.current) < 0.005) {
            stage.bimTurnGroup.rotation.y = targetTurnYRef.current;
            targetTurnYRef.current = null;
          }
        }

        stage.updateVisuals({
          emergence: emergenceRef.current,
          seg1DropOffset: seg1DropRef.current.offsetY,
          seg2DropOffset: seg2DropRef.current.offsetY,
          seg3DropOffset: seg3DropRef.current.offsetY,
          elapsed,
          xrayMode: xrayModeRef.current,
          collisionActive: collisionActiveRef.current,
        });
      }

      renderer.render(scene, arCamera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    syncCoverLayout();
    if (isSoftwareGl) {
      afterDraw(tick);
    } else {
      frameId = requestAnimationFrame(tick);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(timeoutId);

      window.removeEventListener('resize', syncCoverLayout);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener(
        'pointercancel',
        handlePointerCancel
      );
      renderer.domElement.removeEventListener(
        'webglcontextlost',
        handleContextLost
      );
      renderer.domElement.removeEventListener(
        'webglcontextrestored',
        handleContextRestored
      );

      disposeArTracking();
      stage.dispose();
      envTarget.dispose();
      renderer.dispose();

      stageRef.current = null;
      markerGroupRef.current = null;

      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [videoRef]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={mountRef}
        className="h-full w-full touch-none"
        aria-label="Scena WebAR 4D BIM śledząca znacznik HIRO"
      />
      {contextLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0b101b]/90 p-6 text-center">
          <p className="max-w-xs text-sm text-slate-200">
            Utracono kontekst graficzny WebGL. Odśwież stronę, aby przywrócić
            widok AR.
          </p>
        </div>
      )}
    </div>
  );
}
