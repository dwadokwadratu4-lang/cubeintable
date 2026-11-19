import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  Camera,
  CameraOff,
  ChevronDown,
  ChevronUp,
  Eye,
  RotateCcw,
  ScanLine,
  X,
} from 'lucide-react';
import ArBimViewport from './components/ArBimViewport';
import { HOTSPOTS, type HotspotInfo } from './three/createBimStage';

function getStageLabel(emergence: number): string {
  if (emergence <= 33) {
    return 'Etap 1: Fundamenty';
  }
  if (emergence <= 75) {
    return 'Etap 2: Konstrukcja nośna';
  }
  return 'Etap 3: Dach i zwieńczenie';
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const prevSliderRef = useRef(5);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [markerVisible, setMarkerVisible] = useState(false);

  // Starts at 5% after foundation drops onto detected HIRO marker
  const [emergence, setEmergence] = useState(5);
  const [xrayMode, setXrayMode] = useState(false);
  const [collisionActive, setCollisionActive] = useState(false);
  const [selectedHotspotId, setSelectedHotspotId] = useState<
    HotspotInfo['id'] | null
  >(null);

  const [replayDropSignal, setReplayDropSignal] = useState(0);
  const [resetRotationSignal, setResetRotationSignal] = useState(0);
  const [dockCollapsed, setDockCollapsed] = useState(false);

  const handleFoundationImpact = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(120);
    }
    prevSliderRef.current = 5;
    setEmergence(5);
  }, []);

  const handleSliderChange = (nextValue: number) => {
    const prev = prevSliderRef.current;

    if (prev <= 33 && nextValue > 33) {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(150);
      }
    } else if (prev <= 75 && nextValue > 75) {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(200);
      }
    }

    prevSliderRef.current = nextValue;
    setEmergence(nextValue);

    if (nextValue <= 33 && selectedHotspotId !== null) {
      setSelectedHotspotId(null);
    }
  };

  const handleToggleCollision = () => {
    setCollisionActive((prev) => {
      const next = !prev;
      if (next && typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }
      return next;
    });
  };

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setMarkerVisible(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setCameraError(
        'Brak dostępu do interfejsu kamery. Upewnij się, że strona działa przez HTTPS.'
      );
      return;
    }

    setCameraLoading(true);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraActive(true);
    } catch (err) {
      let message =
        'Nie udało się uruchomić tylnej kamery. Sprawdź uprawnienia aparatu w przeglądarce.';
      if (err instanceof DOMException) {
        if (
          err.name === 'NotAllowedError' ||
          err.name === 'PermissionDeniedError'
        ) {
          message =
            'Odmówiono dostępu do kamery. Zezwól na użycie aparatu w ustawieniach przeglądarki i spróbuj ponownie.';
        } else if (
          err.name === 'NotFoundError' ||
          err.name === 'DevicesNotFoundError'
        ) {
          message = 'Nie wykryto kamery w tym urządzeniu.';
        }
      }
      setCameraError(message);
      setCameraActive(false);
    } finally {
      setCameraLoading(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const selectedHotspot = selectedHotspotId
    ? HOTSPOTS[selectedHotspotId]
    : null;
  const stageLabel = getStageLabel(emergence);

  return (
    <main className="relative h-[100dvh] w-screen overflow-hidden bg-[#0b101b] select-none">
      {/* Clean backdrop before camera starts */}
      {!cameraActive && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-0"
          style={{
            background:
              'radial-gradient(circle at 50% 42%, #1b273d 0%, #0e1525 55%, #070b13 100%)',
          }}
        />
      )}

      {/* Fullscreen rear camera video (sized symmetrically with AR canvas) */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        aria-label="Podgląd z tylnej kamery AR"
        className={`pointer-events-none fixed z-0 max-w-none transition-opacity duration-300 ${
          cameraActive ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Transparent ARToolKit + Three.js 4D BIM canvas */}
      <div className="fixed inset-0 z-10 overflow-hidden">
        <ArBimViewport
          videoRef={videoRef}
          cameraActive={cameraActive}
          emergence={emergence}
          xrayMode={xrayMode}
          collisionActive={collisionActive}
          replayDropSignal={replayDropSignal}
          resetRotationSignal={resetRotationSignal}
          onMarkerVisibilityChange={setMarkerVisible}
          onFoundationImpact={handleFoundationImpact}
          onHotspotSelect={setSelectedHotspotId}
        />
      </div>

      {/* Top HUD Bar */}
      <header className="pointer-events-none fixed top-0 right-0 left-0 z-20 flex flex-col gap-2 p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="pointer-events-auto rounded-xl border border-white/15 bg-[#0b101b]/86 px-3.5 py-2 shadow-lg">
            <h1 className="text-xs font-semibold tracking-tight whitespace-nowrap text-white sm:text-sm">
              WebAR 4D BIM | Artur Wierzbicki
            </h1>
          </div>

          {cameraActive && (
            <button
              type="button"
              onClick={stopCamera}
              className="pointer-events-auto flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl border border-white/15 bg-[#0b101b]/86 px-3.5 py-2 text-xs font-medium whitespace-nowrap text-slate-100 shadow-lg transition-colors hover:bg-[#162033] active:scale-[0.98]"
              aria-label="Wyłącz kamerę AR"
            >
              <CameraOff className="h-4 w-4 text-rose-400" aria-hidden="true" />
              <span>Wyłącz kamerę</span>
            </button>
          )}
        </div>

        {/* HIRO Marker Tracking Status Bar */}
        {cameraActive && (
          <div className="flex justify-center">
            <div
              role="status"
              className={`pointer-events-auto flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-medium shadow-lg ${
                markerVisible
                  ? 'border-teal-400/40 bg-[#0b101b]/86 text-teal-200'
                  : 'border-amber-400/45 bg-[#0b101b]/90 text-amber-200'
              }`}
            >
              <ScanLine className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {markerVisible
                  ? 'Znacznik HIRO aktywny · Przesuń palcem w bok, aby obrócić'
                  : 'Skieruj kamerę na znacznik HIRO'}
              </span>
            </div>
          </div>
        )}

        {/* Engineering Collision Alarm Banner */}
        {collisionActive && (
          <div className="flex justify-center">
            <div
              role="alert"
              className="pointer-events-auto flex items-center gap-2.5 rounded-xl border border-rose-500/70 bg-rose-950/92 px-4 py-2.5 text-xs font-bold tracking-wide text-rose-100 shadow-xl sm:text-sm"
            >
              <AlertTriangle
                className="h-4 w-4 shrink-0 text-rose-400"
                aria-hidden="true"
              />
              <span>KOLIZJA INSTALACJI: Oś B-2 / Rurociąg pary</span>
            </div>
          </div>
        )}
      </header>

      {/* Center prompt when camera is not yet running */}
      {!cameraActive && (
        <div className="pointer-events-none fixed inset-0 z-15 flex items-center justify-center px-6">
          <div className="pointer-events-auto max-w-sm rounded-2xl border border-white/15 bg-[#0b101b]/88 p-5 text-center shadow-2xl">
            <p className="mb-2 text-sm font-semibold text-white">
              Śledzenie znacznika HIRO (WebAR 4D BIM)
            </p>
            <p className="mb-4 text-xs leading-relaxed text-slate-300">
              Model 3D pozostaje ukryty do momentu wykrycia czarnego
              kwadratowego znacznika HIRO w kadrze tylnej kamery.
            </p>
            <button
              type="button"
              onClick={startCamera}
              disabled={cameraLoading}
              className="flex min-h-[48px] w-full items-center justify-center gap-2.5 rounded-xl bg-teal-500 px-5 py-3 text-sm font-bold tracking-wide whitespace-nowrap text-slate-950 shadow-lg transition-transform hover:bg-teal-400 active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
            >
              <Camera className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span>
                {cameraLoading ? 'URUCHAMIANIE KAMERY...' : 'URUCHOM KAMERĘ AR'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Bottom Thumb-Zone Control Dock */}
      <section
        aria-label="Sterowanie harmonogramem 4D BIM"
        className="pointer-events-none fixed right-0 bottom-0 left-0 z-20 flex flex-col items-center px-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:pb-5"
      >
        {/* Camera permission / availability notice */}
        {cameraError && (
          <div
            role="alert"
            className="pointer-events-auto mb-2.5 flex w-full max-w-md items-start justify-between gap-3 rounded-xl border border-amber-400/30 bg-[#0b101b]/92 px-3.5 py-2.5 text-xs leading-relaxed text-amber-100 shadow-xl"
          >
            <span>{cameraError}</span>
            <button
              type="button"
              onClick={() => setCameraError(null)}
              className="-m-1 flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded-lg text-amber-200/80 hover:bg-white/10 hover:text-white"
              aria-label="Zamknij komunikat"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Hotspot Technical Spec Drawer */}
        {selectedHotspot && (
          <article
            aria-label="Karta techniczna elementu BIM"
            className="pointer-events-auto mb-2.5 w-full max-w-md rounded-2xl border border-sky-400/40 bg-[#0b101b]/94 p-4 shadow-2xl"
          >
            <div className="mb-1.5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  {selectedHotspot.zone}
                </h2>
                <p className="mt-0.5 text-xs text-sky-300">
                  Status: {selectedHotspot.status} | {selectedHotspot.drawing}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedHotspotId(null)}
                className="-mt-1 -mr-1 flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl text-slate-300 hover:bg-white/10 hover:text-white"
                aria-label="Zamknij kartę techniczną"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <p className="text-xs leading-relaxed text-slate-300">
              {selectedHotspot.details}
            </p>
          </article>
        )}

        {/* Collapse / Expand toggle */}
        <button
          type="button"
          onClick={() => setDockCollapsed((prev) => !prev)}
          className="pointer-events-auto mb-1 flex min-h-[36px] items-center gap-1.5 rounded-t-xl border border-b-0 border-white/15 bg-[#0b101b]/88 px-3.5 py-1 text-xs font-medium whitespace-nowrap text-slate-300 transition-colors hover:text-white"
          aria-expanded={!dockCollapsed}
          aria-controls="webar-bim-dock"
        >
          {dockCollapsed ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Pokaż panel 4D BIM</span>
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Ukryj panel</span>
            </>
          )}
        </button>

        {/* Main Bottom Control Dock */}
        {!dockCollapsed && (
          <div
            id="webar-bim-dock"
            className="pointer-events-auto w-full max-w-md rounded-2xl border border-white/15 bg-[#0b101b]/90 px-4 py-3 shadow-2xl"
          >
            {/* Dynamic 4D Construction Schedule Slider (0-100%, starts at 5%) */}
            <div className="mb-2">
              <div className="mb-0.5 flex items-center justify-between gap-2 text-xs font-semibold text-slate-100 sm:text-sm">
                <label htmlFor="bim-schedule-slider" className="truncate">
                  {stageLabel} ({emergence}%)
                </label>
                <span className="font-mono text-xs text-teal-400 tabular-nums">
                  4D BIM
                </span>
              </div>

              <input
                id="bim-schedule-slider"
                type="range"
                min={0}
                max={100}
                step={1}
                value={emergence}
                onChange={(e) => handleSliderChange(Number(e.target.value))}
                style={
                  {
                    '--slider-progress': `${emergence}%`,
                  } as CSSProperties
                }
                className="webar-slider"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={emergence}
              />
            </div>

            {/* BIM Inspection Controls: Tryb RTG + Symuluj kolizję */}
            <div className="mb-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setXrayMode((prev) => !prev)}
                aria-pressed={xrayMode}
                className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold whitespace-nowrap transition-colors active:scale-[0.98] sm:text-sm ${
                  xrayMode
                    ? 'border-sky-400/60 bg-sky-500/25 text-sky-200 hover:bg-sky-500/35'
                    : 'border-white/15 bg-white/8 text-slate-100 hover:bg-white/14'
                }`}
              >
                <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Tryb RTG</span>
              </button>

              <button
                type="button"
                onClick={handleToggleCollision}
                aria-pressed={collisionActive}
                className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold whitespace-nowrap transition-colors active:scale-[0.98] sm:text-sm ${
                  collisionActive
                    ? 'border-rose-500/70 bg-rose-500/25 text-rose-200 hover:bg-rose-500/35'
                    : 'border-white/15 bg-white/8 text-slate-100 hover:bg-white/14'
                }`}
              >
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  {collisionActive ? 'Wyłącz alarm' : 'Symuluj kolizję'}
                </span>
              </button>
            </div>

            {/* Replay Drop & Reset Rotation */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setReplayDropSignal((prev) => prev + 1)}
                disabled={!markerVisible}
                className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-teal-400/35 bg-teal-500/18 px-3 py-2 text-xs font-semibold whitespace-nowrap text-teal-200 transition-colors hover:bg-teal-500/28 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 sm:text-sm"
              >
                <ArrowDownToLine
                  className="h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                <span>Powtórz zrzut</span>
              </button>

              <button
                type="button"
                onClick={() => setResetRotationSignal((prev) => prev + 1)}
                disabled={!markerVisible}
                className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/8 px-3 py-2 text-xs font-semibold whitespace-nowrap text-slate-100 transition-colors hover:bg-white/14 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 sm:text-sm"
              >
                <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Resetuj obrót</span>
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
