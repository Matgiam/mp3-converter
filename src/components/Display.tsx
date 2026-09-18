"use client";

import Image from "next/image";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import styles from "./Display.module.css";

const SEGMENTS = 40;

export interface DisplayProps {
  status: string;
  format: string;
  title: string;
  subtitle: string;
  counter: string;
  /** 0–1 overall progress, drawn on the segment meter. */
  level: number;
  thumbnail: string | null;
  busy: boolean;
}

export function Display({ status, format, title, subtitle, counter, level, thumbnail, busy }: DisplayProps) {
  const lit = Math.round(Math.min(1, Math.max(0, level)) * SEGMENTS);

  return (
    <div className={styles.glass} aria-hidden="true">
      <div className={styles.thumb} data-empty={!thumbnail || undefined}>
        {thumbnail ? <Image src={thumbnail} alt="" fill sizes="(max-width: 640px) 96px, 176px" /> : <span>NO<br />SIGNAL</span>}
      </div>

      <div className={styles.readout}>
        <div className={styles.topline}>
          <span className={styles.status} data-busy={busy || undefined}>
            {status}
          </span>
          <span className={styles.format}>{format}</span>
        </div>
        <Marquee text={title} className={styles.title} />
        <div className={styles.subtitle}>{subtitle || " "}</div>
      </div>

      <div className={styles.meter}>
        <div className={styles.segments}>
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <i key={i} data-lit={i < lit || undefined} style={{ "--i": i } as CSSProperties} />
          ))}
        </div>
        <span className={styles.counter}>{counter}</span>
      </div>
    </div>
  );
}

/** Long titles scroll back and forth, the way a deck's display handles them. */
function Marquee({ text, className }: { text: string; className: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useLayoutEffect(() => {
    const measure = () => {
      if (outer.current && inner.current) {
        setOverflow(Math.max(0, inner.current.scrollWidth - outer.current.clientWidth));
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer.current!);
    observer.observe(inner.current!);
    return () => observer.disconnect();
  }, [text]);

  const style = { "--shift": `${-overflow}px`, "--duration": `${Math.max(6, overflow / 25 + 4)}s` } as CSSProperties;
  return (
    <div ref={outer} className={`${styles.marquee} ${className}`} data-scroll={overflow > 0 || undefined} style={style}>
      <span ref={inner}>{text}</span>
    </div>
  );
}
