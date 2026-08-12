// Talk-with-Document orb — pure presentational. Visual state derives from the
// `state` prop; no business logic here.
//
// Note: the persona "Maara" was retired in favour of the feature name "Talk
// with Document", but the component and CSS class names keep the historical
// "maara-" prefix for code-split cache stability. The animated visual hasn't
// changed — only user-facing copy in chat/system prompts/etc. was updated.
//
// Layers, outermost to innermost:
//   1. Outer dashed cyan ring (rotates CW).
//   2. Mid lime ring with conic-gradient tick marks (rotates CCW).
//   3. Sweeping scan line (reuses the existing `telux-scan` keyframes).
//   4. Glowing radial core (lime → sand) that pulses slowly when idle,
//      faster when active.
//   5. Five equalizer bars inside the core. They animate only while
//      listening or speaking; the equalizer is frozen on idle/thinking/error
//      via a `[data-eq="off"]` selector in `styles.css`.
//
// All colors come from design tokens. No hex literals.

import { cn } from "@/lib/utils";

import type { MaaraState } from "@/hooks/useMaaraSession";

type MaaraOrbProps = {
  state: MaaraState;
  size?: number;
  className?: string;
};

const DEFAULT_SIZE = 280;
const BAR_HEIGHTS = [40, 70, 100, 55, 85] as const;
const BAR_DELAYS = [0, 80, 160, 240, 320] as const;

export function MaaraOrb({ state, size = DEFAULT_SIZE, className }: MaaraOrbProps) {
  const eqOn = state === "listening" || state === "speaking";
  const active = state !== "idle" && state !== "error";

  return (
    <div
      data-state={state}
      data-eq={eqOn ? "on" : "off"}
      role="img"
      aria-label={`Talk with Document status: ${state}`}
      className={cn("relative grid place-items-center select-none", className)}
      style={{ width: size, height: size }}
    >
      {/* Outer dashed cyan ring (rotates CW) */}
      <div
        aria-hidden
        className="maara-orb-ring-cw motion-reduce:animate-none absolute inset-0 rounded-full"
        style={{
          color: "var(--chart-3)",
          border: "1.5px dashed currentColor",
          // Thin halo so it reads as a glowing ring, not a circle outline.
          WebkitMask:
            "radial-gradient(circle, transparent 55%, black 56.5%, black 62%, transparent 63.5%)",
          mask: "radial-gradient(circle, transparent 55%, black 56.5%, black 62%, transparent 63.5%)",
        }}
      />

      {/* Tick marks via conic gradient — rotates with the outer ring */}
      <div
        aria-hidden
        className="maara-orb-ring-cw motion-reduce:animate-none absolute rounded-full"
        style={{
          inset: 16,
          background:
            "conic-gradient(from 0deg, color-mix(in oklab, var(--chart-3) 60%, transparent) 0deg 4deg, transparent 4deg 30deg, color-mix(in oklab, var(--chart-3) 50%, transparent) 30deg 34deg, transparent 34deg 60deg, color-mix(in oklab, var(--chart-3) 60%, transparent) 60deg 64deg, transparent 64deg 90deg, color-mix(in oklab, var(--chart-3) 50%, transparent) 90deg 94deg, transparent 94deg 120deg, color-mix(in oklab, var(--chart-3) 60%, transparent) 120deg 124deg, transparent 124deg 150deg, color-mix(in oklab, var(--chart-3) 50%, transparent) 150deg 154deg, transparent 154deg 180deg, color-mix(in oklab, var(--chart-3) 60%, transparent) 180deg 184deg, transparent 184deg 210deg, color-mix(in oklab, var(--chart-3) 50%, transparent) 210deg 214deg, transparent 214deg 240deg, color-mix(in oklab, var(--chart-3) 60%, transparent) 240deg 244deg, transparent 244deg 270deg, color-mix(in oklab, var(--chart-3) 50%, transparent) 270deg 274deg, transparent 274deg 300deg, color-mix(in oklab, var(--chart-3) 60%, transparent) 300deg 304deg, transparent 304deg 330deg, color-mix(in oklab, var(--chart-3) 50%, transparent) 330deg 334deg, transparent 334deg 360deg)",
          // Same halo trick: only the rim is visible.
          WebkitMask:
            "radial-gradient(circle, transparent 49%, black 50%, black 56%, transparent 57%)",
          mask: "radial-gradient(circle, transparent 49%, black 50%, black 56%, transparent 57%)",
          opacity: 0.85,
        }}
      />

      {/* Mid solid lime ring (rotates CCW) */}
      <div
        aria-hidden
        className="maara-orb-ring-ccw motion-reduce:animate-none absolute rounded-full"
        style={{
          inset: 40,
          border: "1px solid color-mix(in oklab, var(--signal) 70%, transparent)",
          WebkitMask:
            "radial-gradient(circle, transparent 55%, black 56.5%, black 63%, transparent 64.5%)",
          mask: "radial-gradient(circle, transparent 55%, black 56.5%, black 63%, transparent 64.5%)",
        }}
      />

      {/* Scan line — reuses existing keyframes */}
      <div
        aria-hidden
        className="scan-line motion-reduce:animate-none pointer-events-none absolute left-1/2 -translate-x-1/2 h-px"
        style={{
          top: 24,
          width: size * 0.55,
          background:
            "linear-gradient(90deg, transparent, color-mix(in oklab, var(--signal) 90%, transparent), transparent)",
        }}
      />

      {/* Glowing core — radial gradient from lime to sand */}
      <div
        aria-hidden
        className={cn(
          "motion-reduce:animate-none relative grid place-items-center rounded-full",
          active ? "maara-orb-core-active" : "maara-orb-core-idle",
        )}
        style={{
          width: size * 0.55,
          height: size * 0.55,
          background:
            "radial-gradient(circle at 50% 40%, color-mix(in oklab, var(--signal) 90%, white 12%) 0%, var(--signal) 38%, var(--sand) 100%)",
          boxShadow: "var(--shadow-signal)",
        }}
      >
        {/* Equalizer bars */}
        <div className="flex items-end gap-1" style={{ height: size * 0.16 }}>
          {BAR_HEIGHTS.map((h, i) => (
            <span
              key={i}
              className="maara-orb-eq rounded-full"
              style={{
                width: 6,
                height: `${h}%`,
                background: "color-mix(in oklab, var(--signal-foreground) 80%, transparent)",
                animationDelay: `${BAR_DELAYS[i]}ms`,
                transformOrigin: "50% 100%",
              }}
            />
          ))}
        </div>
      </div>

      {/* Outer halo bloom — static, just gives a subtle glow on dark BG */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--signal) 18%, transparent) 0%, transparent 65%)",
          filter: "blur(8px)",
        }}
      />
    </div>
  );
}
