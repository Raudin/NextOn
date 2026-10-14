// The React Native ThinkingOrb.
//
// Geometry comes from `thinking-orbs/engine` — the SAME compiled code the
// web component runs, not a re-implementation — so parity is structural
// rather than something to be maintained by hand. All this file does is
// turn a frame's dot list into Skia draw calls.
//
// Threading: the frame is built and recorded into an SkPicture on the JS
// thread, then handed to the UI thread as a shared value, where Skia
// rasterises it. Measured cost of the heaviest mode (`composing`, 566
// dots) is 0.12 ms per frame on desktop V8 — under 1% of a 60 fps budget,
// and a few times that under Hermes on a mid-range phone. That headroom is
// why the geometry is NOT workletized: doing so would require 'worklet'
// directives throughout the shared engine (verified: without them the
// Babel plugin produces zero worklets, so a UI-thread call would throw),
// which would couple the web library to Reanimated's toolchain and risk a
// bundler silently stripping the directives. Rasterisation — the part that
// actually must not jank — is on the UI thread either way.

import { useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { Canvas, PaintStyle, Picture, Skia, createPicture } from '@shopify/react-native-skia';
import type { SkPicture } from '@shopify/react-native-skia';
import { useSharedValue } from 'react-native-reanimated';
import { MODE_FRAMES, resolvePreset } from 'thinking-orbs/engine';
import { nowSeconds, useAppActive, useReducedMotion, useResolvedDark } from './theme';
import type { ThinkingOrbProps } from './types';

const LABELS: Record<string, string> = {
  working: 'Working…',
  searching: 'Searching…',
  solving: 'Solving…',
  listening: 'Listening…',
  connecting: 'Connecting…',
  weaving: 'Weaving…',
  composing: 'Composing…',
  breathing: 'Thinking…',
  shaping: 'Shaping…'
};

/** The static frame reduced-motion users see — same instant as the web. */
const REDUCED_MOTION_T = 0.6;

export function ThinkingOrb({
  state = 'working',
  size = 64,
  theme = 'auto',
  speed = 1,
  paused = false,
  displaySize,
  accessibilityLabel,
  style
}: ThinkingOrbProps) {
  const dark = useResolvedDark(theme);
  const reduced = useReducedMotion();
  const appActive = useAppActive();

  // The per-frame picture is a Reanimated SHARED VALUE, not React state.
  // Skia components accept shared values as props and redraw on write, so a
  // frame costs one picture record and one Skia draw. The first version used
  // useState here — a full React render + Fabric commit per orb per frame,
  // which throttled the whole app into single-digit fps the moment anything
  // else (like the sheet morph's layout work) shared the frame budget.
  const empty = useMemo(() => createPicture(() => {}), []);
  const picture = useSharedValue<SkPicture>(empty);

  // One paint per pass, mutated in place: a fresh SkPaint per dot would
  // allocate ~600 native objects a frame, which is what actually hurts on
  // low-end Android.
  //
  // These are native objects whose lifetime React does not manage, so they are
  // released explicitly below rather than left for a GC pass to notice two
  // long-lived host objects. That is safe *only* on unmount: `record` is their
  // sole user and it runs on the JS thread, so once the frame effect's cleanup
  // has cancelled the rAF there is no way left to touch them.
  const paints = useMemo(() => ({ fill: Skia.Paint(), stroke: Skia.Paint() }), []);
  const rgba = useRef(new Float32Array(4)).current;

  const { mode, speed: baseSpeed, opts } = useMemo(() => resolvePreset(state, size), [state, size]);
  const effSpeed = baseSpeed * speed;
  const box = displaySize ?? size;
  const zoom = box / size;

  // `paints` is stable, so this runs once per orb and releases exactly the two
  // paints that orb allocated. Not part of the frame effect below: that one
  // re-runs on every prop change and would dispose paints it is still using.
  useEffect(
    () => () => {
      paints.fill.dispose();
      paints.stroke.dispose();
    },
    [paints]
  );

  useEffect(() => {
    const { fill, stroke } = paints;
    fill.setAntiAlias(true);
    stroke.setAntiAlias(true);
    stroke.setStyle(PaintStyle.Stroke);

    const build = MODE_FRAMES[mode];

    const setInk = (paint: typeof fill, white: number, alpha: number) => {
      const w = Math.min(1, Math.max(0, white));
      // Quantise to 8-bit exactly as the canvas painter does, so the two
      // platforms land on identical greys rather than merely close ones.
      const g = Math.round((dark ? 1 - w : w) * 255) / 255;
      rgba[0] = g;
      rgba[1] = g;
      rgba[2] = g;
      rgba[3] = alpha;
      paint.setColor(rgba);
    };

    const record = (t: number) => {
      const frame = build(size, t, opts);
      const pic = createPicture((canvas) => {
        // draw the tuned `size` geometry into a `displaySize` canvas
        if (zoom !== 1) canvas.scale(zoom, zoom);
        // lines first, so nodes sit on top of their edges
        for (const l of frame.lines) {
          setInk(stroke, l.white, l.a ?? 1);
          stroke.setStrokeWidth(l.w);
          canvas.drawLine(l.x1, l.y1, l.x2, l.y2, stroke);
        }
        // dots are already z-sorted into draw order by the engine
        for (const d of frame.dots) {
          setInk(fill, d.white, d.a ?? 1);
          canvas.drawCircle(d.x, d.y, d.r, fill);
        }
      }, Skia.XYWHRect(0, 0, box, box));
      // Deliberately NOT disposed before the next write overwrites it.
      //
      // This picture is written on the JS thread and read on the UI thread,
      // where the recorder converts the prop into its own `sk_sp<SkPicture>`
      // (see `PictureCmd` in react-native-skia). `dispose()` does not merely
      // drop this thread's reference — it marks the host object disposed, and
      // the next `getObject()` on it throws "Attempted to access a disposed
      // object" while also racing the UI thread's read of the same field.
      // For one whole frame after a write, the UI thread may still be reading
      // the previous value, so disposing here is a crash, not a saving.
      //
      // Nothing is lost by leaving it: the host object registers its byte size
      // as external memory pressure, so the GC sees the cost and the host
      // object's destructor frees the picture on the thread that made it.
      // Throttling the loop below is what actually bounds the allocation rate.
      picture.value = pic;
    };

    if (reduced) {
      record(REDUCED_MOTION_T);
      return;
    }

    // draw once even when paused or backgrounded, so the orb is never blank
    record(nowSeconds() * effSpeed);
    if (paused || !appActive) return;

    let raf = 0;
    let running = true;
    // ~30fps. Each tick allocates a fresh native SkPicture, so halving the
    // tick rate halves the garbage this decorative indicator produces; the
    // port's motion is slow enough that the difference is not visible, and the
    // first frame is still recorded immediately above.
    const frameIntervalMs = 1000 / 30;
    let lastRecordedAt = Date.now();
    const loop = () => {
      const now = Date.now();
      if (now - lastRecordedAt >= frameIntervalMs) {
        lastRecordedAt = now;
        record(nowSeconds() * effSpeed);
      }
      if (running) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, [mode, opts, size, box, zoom, dark, effSpeed, paused, reduced, appActive, paints, rgba, picture]);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? LABELS[state]}
      style={[{ width: box, height: box }, style]}
    >
      <Canvas style={{ width: box, height: box }}>
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}
