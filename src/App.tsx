import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  ArrowDownToLine,
  Camera,
  CameraOff,
  ChevronDown,
  ChevronUp,
  Lock,
  RotateCcw,
  Unlock,
  X,
} from 'lucide-react';
import ArViewport from './components/ArViewport';

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const hasTriggeredInitialDropRef = useRef(false);
  const dropTimeoutRef = useRef<number | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // 100% = cube stands fully on the virtual floor surface; 0% = completely hidden below
  const [emergence, setEmergence] = useState(100);
  const [isLocked, setIsLocked] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [dropSignal, setDropSignal] = useState(0);
  const [userSliderSignal, setUserSliderSignal] = useState(0);
  const [dockCollapsed, setDockCollapsed] = useState(false);

  const triggerDropAnimation = useCallback(() => {
    setDropSignal((prev) => prev + 1);
  }, []);

  const handleDropImpact = useCallback(() => {
    // Haptic feedback at the exact millisecond the cube strikes the HIRO marker plane
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([140, 40, 70]);
    }
    // Automatically set emergence slider to 0% as the cube sinks beneath the floor mask
    setEmergence(0);
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
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
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraActive(true);

      // Automatically trigger the drop-in animation on first AR marker/camera activation
      if (!hasTriggeredInitialDropRef.current) {
        hasTriggeredInitialDropRef.current = true;
        if (dropTimeoutRef.current !== null) {
          window.clearTimeout(dropTimeoutRef.current);
        }
        dropTimeoutRef.current = window.setTimeout(() => {
          triggerDropAnimation();
        }, 220);
      }
    } catch (err) {
      let message =
        'Nie udało się uruchomić tylnej kamery. Nadal możesz obracać obiekt 3D i testować animację zrzutu w trybie podglądu.';
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
          message =
            'Nie wykryto kamery w tym urządzeniu. Obiekt 3D pozostaje w pełni interaktywny.';
        }
      }
      setCameraError(message);
      setCameraActive(false);
    } finally {
      setCameraLoading(false);
    }
  }, [triggerDropAnimation]);

  useEffect(() => {
    return () => {
      if (dropTimeoutRef.current !== null) {
        window.clearTimeout(dropTimeoutRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const handleResetPosition = () => {
    setIsLocked(false);
    setResetSignal((prev) => prev + 1);
  };

  const handleSliderChange = (value: number) => {
    setUserSliderSignal((prev) => prev + 1);
    setEmergence(value);
  };

  return (
    <main className="relative h-[100dvh] w-screen overflow-hidden bg-[#0b101b] select-none">
      {/* Studio fallback backdrop when camera is off */}
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

      {/* Fullscreen rear camera preview */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        aria-label="Podgląd z tylnej kamery AR"
        className={`pointer-events-none fixed inset-0 z-0 h-full w-full object-cover transition-opacity duration-300 ${
          cameraActive ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Transparent WebGL 3D scene layered directly over the camera feed */}
      <div className="fixed inset-0 z-10">
        <ArViewport
          emergence={emergence}
          isLocked={isLocked}
          resetSignal={resetSignal}
          dropSignal={dropSignal}
          userSliderSignal={userSliderSignal}
          onDropImpact={handleDropImpact}
        />
      </div>

      {/* Top HUD bar: Author signature (left) & camera stop button (right) */}
      <header className="pointer-events-none fixed top-0 right-0 left-0 z-20 flex items-start justify-between gap-3 p-3 sm:p-4">
        <div className="pointer-events-auto rounded-xl border border-white/15 bg-[#0b101b]/82 px-3.5 py-2 shadow-lg">
          <h1 className="text-xs font-semibold tracking-tight whitespace-nowrap text-white sm:text-sm">
            WebAR 3D | Artur Wierzbicki
          </h1>
        </div>

        {cameraActive && (
          <button
            type="button"
            onClick={stopCamera}
            className="pointer-events-auto flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl border border-white/15 bg-[#0b101b]/82 px-3.5 py-2 text-xs font-medium whitespace-nowrap text-slate-100 shadow-lg transition-colors hover:bg-[#162033] active:scale-[0.98]"
            aria-label="Wyłącz kamerę AR"
          >
            <CameraOff className="h-4 w-4 text-rose-400" aria-hidden="true" />
            <span>Wyłącz kamerę</span>
          </button>
        )}
      </header>

      {/* Bottom Thumb-Zone Control Dock */}
      <section
        aria-label="Sterowanie sceną WebAR"
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

        {/* Primary CTA to launch rear Android camera when inactive */}
        {!cameraActive && (
          <div className="pointer-events-auto mb-2.5 w-full max-w-md">
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
        )}

        {/* Collapse / Expand toggle for Zen AR view */}
        <button
          type="button"
          onClick={() => setDockCollapsed((prev) => !prev)}
          className="pointer-events-auto mb-1 flex min-h-[36px] items-center gap-1.5 rounded-t-xl border border-b-0 border-white/15 bg-[#0b101b]/88 px-3.5 py-1 text-xs font-medium whitespace-nowrap text-slate-300 transition-colors hover:text-white"
          aria-expanded={!dockCollapsed}
          aria-controls="webar-control-dock"
        >
          {dockCollapsed ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Pokaż sterowanie</span>
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Ukryj sterowanie</span>
            </>
          )}
        </button>

        {/* Main Bottom Control Panel */}
        {!dockCollapsed && (
          <div
            id="webar-control-dock"
            className="pointer-events-auto w-full max-w-md rounded-2xl border border-white/15 bg-[#0b101b]/88 px-4 py-3 shadow-2xl"
          >
            {/* Emergence Slider (0% - 100%) */}
            <div className="mb-2">
              <div className="mb-0.5 flex items-center justify-between gap-2 text-xs font-medium text-slate-200 sm:text-sm">
                <label htmlFor="emergence-slider">Wysunięcie obiektu:</label>
                <span className="font-mono font-semibold text-teal-400 tabular-nums">
                  {emergence}%
                </span>
              </div>

              <input
                id="emergence-slider"
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

            {/* Lock / Reset Position Controls */}
            <div className="mb-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsLocked((prev) => !prev)}
                aria-pressed={isLocked}
                className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold whitespace-nowrap transition-colors active:scale-[0.98] sm:text-sm ${
                  isLocked
                    ? 'border-amber-400/50 bg-amber-400/15 text-amber-200 hover:bg-amber-400/25'
                    : 'border-white/15 bg-white/8 text-slate-100 hover:bg-white/14'
                }`}
              >
                {isLocked ? (
                  <>
                    <Unlock className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Odblokuj pozycję</span>
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Zablokuj pozycję</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleResetPosition}
                className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/8 px-3 py-2 text-xs font-semibold whitespace-nowrap text-slate-100 transition-colors hover:bg-white/14 active:scale-[0.98] sm:text-sm"
              >
                <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Resetuj pozycję</span>
              </button>
            </div>

            {/* Replay Drop Animation CTA */}
            <button
              type="button"
              onClick={triggerDropAnimation}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-teal-400/35 bg-teal-500/18 px-3 py-2 text-xs font-semibold whitespace-nowrap text-teal-200 transition-colors hover:bg-teal-500/28 active:scale-[0.98] sm:text-sm"
            >
              <ArrowDownToLine className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Powtórz animację zrzutu</span>
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
