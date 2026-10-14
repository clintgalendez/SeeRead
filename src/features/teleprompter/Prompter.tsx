/**
 * Teleprompter text renderer shared by the overlay and the editor preview.
 *
 * The text is rendered once per script/appearance change; playback updates (scroll
 * offset, highlighted word) go through the imperative handle and touch only the DOM
 * nodes that change, so reading stays smooth on long scripts.
 */
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { ScrollLayout } from "../../core/autoscroll";
import type { Settings } from "../../core/settings";
import type { ScriptModel } from "./model";

export interface PrompterHandle {
  /** Scroll offset (px) that puts the reading guide at the top of the viewport content. */
  getScroll(): number;
  setScroll(offset: number): void;
  layout(): ScrollLayout;
  /** Scroll offset that brings token `i` onto the reading guide. */
  offsetForToken(i: number): number | null;
  /** First token at or below the reading guide. */
  tokenAtGuide(): number;
  /** Marks tokens before `position` as read and highlights the current/upcoming words. */
  highlight(position: number | null): void;
}

interface Props {
  model: ScriptModel;
  settings: Settings;
  /** Scales the font, e.g. for the small editor preview. */
  scale?: number;
  showGuide?: boolean;
  onWordClick?(tokenIndex: number): void;
  onWheel?(deltaY: number): void;
  children?: React.ReactNode;
}

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

export const Prompter = forwardRef<PrompterHandle, Props>(function Prompter(
  { model, settings, scale = 1, showGuide = true, onWordClick, onWheel, children },
  ref,
) {
  const a = settings.appearance;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const spans = useRef<HTMLElement[]>([]);
  const tokenToSpan = useRef<Int32Array>(new Int32Array(0));
  const highlighted = useRef<number | null>(null);
  const [viewport, setViewport] = useState(0);

  const guideY = Math.round((viewport * a.guidePercent) / 100);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewport(el.clientHeight));
    observer.observe(el);
    setViewport(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  // Index word spans after each render of the text.
  useLayoutEffect(() => {
    const list = Array.from(textRef.current?.querySelectorAll<HTMLElement>(".w") ?? []);
    const map = new Int32Array(model.tokens.length).fill(-1);
    list.forEach((span, s) => {
      const first = Number(span.dataset.first);
      const last = Number(span.dataset.last);
      for (let t = first; t <= last; t++) map[t] = s;
    });
    spans.current = list;
    tokenToSpan.current = map;
    highlighted.current = null;
  }, [model]);

  const applyClasses = useCallback(
    (position: number | null, fromSpan: number, toSpan: number) => {
      const upcoming = a.upcomingWords;
      for (let s = Math.max(0, fromSpan); s <= Math.min(spans.current.length - 1, toSpan); s++) {
        const span = spans.current[s]!;
        const first = Number(span.dataset.first);
        const last = Number(span.dataset.last);
        const p = position ?? -1;
        span.classList.toggle("read", position !== null && last < p - 1);
        span.classList.toggle("current", position !== null && first <= p - 1 && p - 1 <= last);
        span.classList.toggle("upcoming", position !== null && last >= p && first < p + upcoming);
      }
    },
    [a.upcomingWords],
  );

  const spanFor = (token: number) => {
    const map = tokenToSpan.current;
    if (map.length === 0) return -1;
    return map[Math.max(0, Math.min(map.length - 1, token))]!;
  };

  useImperativeHandle(
    ref,
    () => ({
      getScroll: () => scrollerRef.current?.scrollTop ?? 0,
      setScroll(offset) {
        if (scrollerRef.current) scrollerRef.current.scrollTop = offset;
      },
      layout() {
        const el = scrollerRef.current;
        if (!el) return { maxOffset: 0, breaks: [] };
        const paragraphs = Array.from(textRef.current?.querySelectorAll("p") ?? []);
        return {
          maxOffset: Math.max(0, el.scrollHeight - el.clientHeight),
          breaks: paragraphs.slice(1).map((p) => p.offsetTop - guideY),
        };
      },
      offsetForToken(i) {
        const span = spans.current[spanFor(i)];
        return span ? Math.max(0, span.offsetTop - guideY) : null;
      },
      tokenAtGuide() {
        const line = (scrollerRef.current?.scrollTop ?? 0) + guideY;
        const list = spans.current;
        let lo = 0;
        let hi = list.length - 1;
        if (hi < 0) return 0;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          const s = list[mid]!;
          if (s.offsetTop + s.offsetHeight <= line) lo = mid + 1;
          else hi = mid;
        }
        return Number(list[lo]!.dataset.first);
      },
      highlight(position) {
        const prev = highlighted.current;
        highlighted.current = position;
        const span = a.upcomingWords + 2;
        if (prev === null && position === null) return;
        if (prev === null || position === null) {
          applyClasses(position, 0, spans.current.length - 1);
          return;
        }
        const lo = spanFor(Math.min(prev, position) - span);
        const hi = spanFor(Math.max(prev, position) + span);
        applyClasses(position, lo, hi);
      },
    }),
    [guideY, applyClasses, a.upcomingWords],
  );

  const ann = settings.annotations;
  const style = {
    "--tp-font": a.fontFamily,
    "--tp-size": `${a.fontSize * scale}px`,
    "--tp-weight": a.fontWeight,
    "--tp-line": a.lineHeight,
    "--tp-align": a.align,
    "--tp-color": a.textColor,
    "--tp-bg-rgb": hexToRgb(a.backgroundColor),
    "--tp-bg-alpha": a.backgroundOpacity,
    "--tp-margin": `${a.marginPercent}%`,
    "--tp-guide-y": `${guideY}px`,
    "--tp-pad-bottom": `${Math.max(0, viewport - guideY)}px`,
    "--tp-hl": a.highlightColor,
    "--tp-read-opacity": a.dimReadText ? 0.45 : 1,
    "--tp-ann-color": ann.color,
    "--tp-ann-style": ann.italic ? "italic" : "normal",
  } as CSSProperties;

  const classes = [
    "prompter",
    `hl-${a.highlightStyle}`,
    a.showBorder && "bordered",
    a.textShadow && "shadow",
    a.mirrorHorizontal && "mirror-x",
    a.mirrorVertical && "mirror-y",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} style={style}>
      <div
        ref={scrollerRef}
        className="prompter-scroll"
        onWheel={onWheel ? (e) => onWheel(e.deltaY) : undefined}
      >
        <div
          ref={textRef}
          className="prompter-text"
          onClick={
            onWordClick
              ? (e) => {
                  // A click that ends a text selection is for copying, not for moving the reader.
                  if (getSelection()?.isCollapsed === false) return;
                  const w = (e.target as HTMLElement).closest<HTMLElement>(".w");
                  if (w) onWordClick(Number(w.dataset.first));
                }
              : undefined
          }
        >
          {model.paragraphs.map((p) => (
            <p key={p.start}>
              {p.runs.map((r, i) =>
                r.kind === "word" ? (
                  <span
                    key={i}
                    className={r.inAnnotation ? "w ann" : "w"}
                    data-first={r.first}
                    data-last={r.last}
                  >
                    {r.text}
                  </span>
                ) : r.kind === "annotation" ? (
                  <span key={i} className="ann">
                    {r.text}
                  </span>
                ) : (
                  <span key={i}>{r.text}</span>
                ),
              )}
            </p>
          ))}
        </div>
      </div>
      {showGuide && a.showGuide && <div className="prompter-guide" aria-hidden="true" />}
      {children}
    </div>
  );
});
