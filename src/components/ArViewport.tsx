import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createArStage, type ArStage } from '../three/createArStage';

interface ArViewportProps {
  /** 0 to 100 */
  emergence: number;
  /** Locks touch/pointer rotation & zoom */
  isLocked: boolean;
  /** Increment to trigger smooth camera reset */
  resetSignal: number;
  /** Increment to trigger gravity drop & floor penetration animation */
  dropSignal: number;
  /** Increment when user manually adjusts the emergence slider */
  userSliderSignal: number;
  /** Fired at the exact frame the falling cube impacts the marker plane */
  onDropImpact?: () => void;
}

type DropPhase = 'idle' | 'falling' | 'sinking';

interface DropState {
  phase: DropPhase;
  velocityY: number;
  sinkElapsed: number;
}

const DEFAULT_CAMERA_POS = new THREE.Vector3(2.15, 1.85, 2.75);
const DEFAULT_TARGET = new THREE.Vector3(0, 0.25, 0);

const DROP_START_Y = 6.8;
const GRAVITY = 30.0;
const INITIAL_FALL_VELOCITY = -2.4;
const SINK_DURATION = 0.36;
const SHAKE_DURATION = 0.22;

// Pre-allocated math helpers outside render loop (zero GC)
const _tmpVec = new THREE.Vector3();

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

export default function ArViewport({
  emergence,
  isLocked,
  resetSignal,
  dropSignal,
  userSliderSignal,
  onDropImpact,
}: ArViewportProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [contextLost, setContextLost] = useState(false);

  const emergenceRef = useRef(emergence / 100);
  const isLockedRef = useRef(isLocked);
  const resetPendingRef = useRef(false);
  const onDropImpactRef = useRef(onDropImpact);

  const dropStateRef = useRef<DropState>({
    phase: 'idle',
    velocityY: 0,
    sinkElapsed: 0,
  });
  const impactFlashRef = useRef(0);
  const shakeTimerRef = useRef(0);

  const requestRenderFnRef = useRef<(() => void) | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const stageRef = useRef<ArStage | null>(null);

  useEffect(() => {
    onDropImpactRef.current = onDropImpact;
  }, [onDropImpact]);

  // Sync slider emergence prop
  useEffect(() => {
    emergenceRef.current = THREE.MathUtils.clamp(emergence / 100, 0, 1);
    requestRenderFnRef.current?.();
  }, [emergence]);

  // Cancel active drop animation if user grabs the slider manually
  useEffect(() => {
    if (userSliderSignal > 0 && dropStateRef.current.phase !== 'idle') {
      dropStateRef.current.phase = 'idle';
      requestRenderFnRef.current?.();
    }
  }, [userSliderSignal]);

  // Sync touch lock state
  useEffect(() => {
    isLockedRef.current = isLocked;
    if (controlsRef.current) {
      controlsRef.current.enabled = !isLocked;
    }
  }, [isLocked]);

  // Trigger camera reset
  useEffect(() => {
    if (resetSignal > 0) {
      resetPendingRef.current = true;
      requestRenderFnRef.current?.();
    }
  }, [resetSignal]);

  // Trigger gravity drop animation from high above the frame
  useEffect(() => {
    if (dropSignal > 0 && stageRef.current) {
      dropStateRef.current = {
        phase: 'falling',
        velocityY: INITIAL_FALL_VELOCITY,
        sinkElapsed: 0,
      };
      impactFlashRef.current = 0;
      shakeTimerRef.current = 0;
      stageRef.current.setImpactEffect(0);
      stageRef.current.root.position.set(0, 0, 0);
      stageRef.current.cubeGroup.position.y = DROP_START_Y;
      requestRenderFnRef.current?.();
    }
  }, [dropSignal]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    renderer.setSize(width, height);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'none';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 100);
    camera.position.copy(DEFAULT_CAMERA_POS);

    // Studio environment map via RoomEnvironment
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    // 3-point balanced studio lighting rig
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 1.85);
    keyLight.position.set(3.2, 5.8, 3.8);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 16;
    keyLight.shadow.camera.left = -2.4;
    keyLight.shadow.camera.right = 2.4;
    keyLight.shadow.camera.top = 2.4;
    keyLight.shadow.camera.bottom = -2.4;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.65);
    rimLight.position.set(-3.4, 2.4, -3.2);
    scene.add(rimLight);

    // Build AR stage (colorWrite: false floor mask + HIRO marker frame + 6-color cube)
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const stage = createArStage(maxAniso);
    stageRef.current = stage;
    stage.setEmergence(emergenceRef.current);
    scene.add(stage.root);

    // Touch / pointer orbit controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;
    controls.target.copy(DEFAULT_TARGET);
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.enableRotate = true;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 0.9;
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.minDistance = 2.0;
    controls.maxDistance = 6.5;
    controls.minPolarAngle = 0.08;
    controls.maxPolarAngle = Math.PI * 0.84;
    controls.enabled = !isLockedRef.current;
    controls.update();

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Coalesced on-demand render loop with software-WebGL pacing
    let frameId = 0;
    let timeoutId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let disposed = false;
    let lastTime = performance.now();

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

    function requestRender() {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame((now) => {
        if (disposed) return;
        renderDirty = false;

        const dt = Math.min(Math.max((now - lastTime) / 1000, 0.001), 0.05);
        lastTime = now;

        let needsMoreFrames = false;
        const dropState = dropStateRef.current;

        if (dropState.phase === 'falling') {
          dropState.velocityY -= GRAVITY * dt;
          stage.cubeGroup.position.y += dropState.velocityY * dt;

          const impactY = stage.getMaxY(); // Bottom face touches y = 0
          if (stage.cubeGroup.position.y <= impactY) {
            stage.cubeGroup.position.y = impactY;
            dropState.phase = 'sinking';
            dropState.sinkElapsed = 0;

            impactFlashRef.current = 1.0;
            shakeTimerRef.current = prefersReducedMotion ? 0 : SHAKE_DURATION;
            onDropImpactRef.current?.();
          }
          needsMoreFrames = true;
        } else if (dropState.phase === 'sinking') {
          dropState.sinkElapsed += dt;
          const progress = Math.min(dropState.sinkElapsed / SINK_DURATION, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          stage.cubeGroup.position.y = THREE.MathUtils.lerp(
            stage.getMaxY(),
            stage.getMinY(),
            eased
          );

          if (progress >= 1) {
            stage.cubeGroup.position.y = stage.getMinY();
            dropState.phase = 'idle';
          } else {
            needsMoreFrames = true;
          }
        } else {
          // Normal slider-driven emergence damping
          const targetY = stage.getCubeTargetY(emergenceRef.current);
          const currentY = stage.cubeGroup.position.y;
          if (Math.abs(targetY - currentY) > 0.0005) {
            stage.cubeGroup.position.y = isSoftwareGl
              ? targetY
              : THREE.MathUtils.damp(currentY, targetY, 16, dt);
            if (Math.abs(targetY - stage.cubeGroup.position.y) > 0.0005) {
              needsMoreFrames = true;
            } else {
              stage.cubeGroup.position.y = targetY;
            }
          }
        }

        // Update marker outline flash & shockwave on impact
        if (impactFlashRef.current > 0) {
          impactFlashRef.current = Math.max(0, impactFlashRef.current - dt * 2.6);
          stage.setImpactEffect(impactFlashRef.current);
          if (impactFlashRef.current > 0) {
            needsMoreFrames = true;
          }
        }

        // Brief impact micro-shake on the AR plane
        if (shakeTimerRef.current > 0) {
          shakeTimerRef.current = Math.max(0, shakeTimerRef.current - dt);
          const norm = shakeTimerRef.current / SHAKE_DURATION;
          const amplitude = norm * norm;
          stage.root.position.set(
            Math.cos(shakeTimerRef.current * 95) * amplitude * 0.025,
            Math.sin(shakeTimerRef.current * 115) * amplitude * 0.055,
            0
          );
          if (shakeTimerRef.current > 0) {
            needsMoreFrames = true;
          } else {
            stage.root.position.set(0, 0, 0);
          }
        }

        // Smoothly animate camera reset if requested
        if (resetPendingRef.current) {
          if (isSoftwareGl) {
            camera.position.copy(DEFAULT_CAMERA_POS);
            controls.target.copy(DEFAULT_TARGET);
            resetPendingRef.current = false;
          } else {
            const alpha = 1 - Math.exp(-12 * dt);
            camera.position.lerp(DEFAULT_CAMERA_POS, alpha);
            controls.target.lerp(DEFAULT_TARGET, alpha);
            const posDist = _tmpVec
              .copy(camera.position)
              .distanceTo(DEFAULT_CAMERA_POS);
            const targetDist = controls.target.distanceTo(DEFAULT_TARGET);
            if (posDist < 0.005 && targetDist < 0.005) {
              camera.position.copy(DEFAULT_CAMERA_POS);
              controls.target.copy(DEFAULT_TARGET);
              resetPendingRef.current = false;
            } else {
              needsMoreFrames = true;
            }
          }
        }

        const controlsMoved = controls.update(dt);
        if (controlsMoved) {
          needsMoreFrames = true;
        }

        renderer.render(scene, camera);

        const done = () => {
          renderBusy = false;
          if (renderDirty || needsMoreFrames) {
            requestRender();
          }
        };

        if (isSoftwareGl) {
          afterDraw(done);
        } else {
          done();
        }
      });
    }

    requestRenderFnRef.current = requestRender;

    const handleControlsStart = () => {
      resetPendingRef.current = false;
    };
    const handleControlsChange = () => {
      requestRender();
    };
    controls.addEventListener('start', handleControlsStart);
    controls.addEventListener('change', handleControlsChange);

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      renderer.setPixelRatio(
        isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
      );
      requestRender();
    };
    window.addEventListener('resize', handleResize);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const handleContextRestored = () => {
      setContextLost(false);
      requestRender();
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener(
      'webglcontextrestored',
      handleContextRestored
    );

    // Initial render
    requestRender();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(timeoutId);
      requestRenderFnRef.current = null;
      controlsRef.current = null;
      stageRef.current = null;

      window.removeEventListener('resize', handleResize);
      controls.removeEventListener('start', handleControlsStart);
      controls.removeEventListener('change', handleControlsChange);
      renderer.domElement.removeEventListener(
        'webglcontextlost',
        handleContextLost
      );
      renderer.domElement.removeEventListener(
        'webglcontextrestored',
        handleContextRestored
      );

      controls.dispose();
      stage.dispose();
      envTarget.dispose();
      renderer.dispose();

      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <div
        ref={mountRef}
        className="h-full w-full touch-none"
        aria-label="Interaktywna scena WebAR 3D — przeciągnij palcem, aby obrócić"
      />
      {contextLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0b101b]/90 p-6 text-center">
          <p className="max-w-xs text-sm text-slate-200">
            Utracono kontekst graficzny WebGL. Odśwież stronę, aby przywrócić
            widok 3D.
          </p>
        </div>
      )}
    </div>
  );
}
