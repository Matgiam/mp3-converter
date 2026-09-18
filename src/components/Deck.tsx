"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import {
  BITRATES,
  DEFAULT_BITRATE,
  estimateBytes,
  formatBytes,
  formatDuration,
  parseVideoId,
  type Bitrate,
  type JobStatus,
  type VideoInfo,
} from "@/lib/youtube";
import { Display, type DisplayProps } from "./Display";
import styles from "./Deck.module.css";

type Phase = "empty" | "loading" | "loaded" | "converting" | "done" | "error";

const POLL_MS = 500;
const MAX_POLL_FAILURES = 5;
// Fetching the audio is usually quick next to encoding it, so it gets the smaller share of the meter.
const DOWNLOAD_SHARE = 0.25;
const BAD_LINK = "That doesn't look like a YouTube video link. Paste a link like youtube.com/watch?v=… or youtu.be/…";
const OFFLINE = "Couldn't reach the converter. Check that the server is running, then try again.";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(OFFLINE);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `The converter responded with an error (${res.status}).`);
  return data as T;
}

const percent = (fraction: number) => `${Math.floor(fraction * 100)}%`;

export function Deck() {
  const [link, setLink] = useState("");
  const [bitrate, setBitrate] = useState<Bitrate>(DEFAULT_BITRATE);
  const [phase, setPhase] = useState<Phase>("empty");
  const [info, setInfo] = useState<VideoInfo | null>(null);
  /** The link `info` was loaded from; conversions use this, not whatever is in the field now. */
  const [source, setSource] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);
  const downloadLink = useRef<HTMLAnchorElement>(null);

  const converting = phase === "converting";

  function fail(message: string) {
    setPhase("error");
    setError(message);
  }

  async function load(input: string) {
    const ticket = ++latestRequest.current;
    setInfo(null);
    setSource(null);
    setJob(null);
    if (!parseVideoId(input)) return fail(BAD_LINK);

    setPhase("loading");
    setError(null);
    try {
      const loaded = await postJson<VideoInfo>("/api/info", { url: input });
      if (ticket !== latestRequest.current) return;
      setInfo(loaded);
      setSource(input);
      setPhase("loaded");
    } catch (err) {
      if (ticket === latestRequest.current) fail((err as Error).message);
    }
  }

  async function convert() {
    if (!source) return;
    const ticket = ++latestRequest.current;
    setPhase("converting");
    setError(null);
    setJob(null);
    try {
      const started = await postJson<JobStatus>("/api/jobs", { url: source, bitrate });
      if (ticket === latestRequest.current) setJob(started);
    } catch (err) {
      if (ticket === latestRequest.current) fail((err as Error).message);
    }
  }

  function chooseBitrate(next: Bitrate) {
    setBitrate(next);
    // A finished MP3 was made at the old bitrate; offer to convert again.
    if (phase === "done") {
      setPhase("loaded");
      setJob(null);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void load(link.trim());
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text").trim();
    if (!parseVideoId(pasted)) return;
    // A whole link was pasted: replace the field and load it straight away.
    event.preventDefault();
    setLink(pasted);
    void load(pasted);
  }

  const jobId = job?.id;
  useEffect(() => {
    if (!jobId || phase !== "converting") return;
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        const status = await res.json();
        if (cancelled) return;
        if (!res.ok) return fail(status.error ?? "Lost track of this conversion. Convert the video again.");
        failures = 0;
        setJob(status);
        if (status.stage === "done") return setPhase("done");
        if (status.stage === "error") return fail(status.error);
      } catch {
        if (cancelled) return;
        if (++failures >= MAX_POLL_FAILURES) return fail(OFFLINE);
      }
      timer = setTimeout(poll, POLL_MS);
    }

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, phase]);

  useEffect(() => {
    if (phase === "done") downloadLink.current?.focus();
  }, [phase]);

  const display = describe(phase, info, job, bitrate);

  return (
    <main className={styles.room}>
      <section className={styles.unit} aria-labelledby="deck-name">
        <header className={styles.header}>
          <h1 id="deck-name" className={styles.wordmark}>
            Dubdeck
          </h1>
          <p className={styles.engraved}>YouTube → MP3</p>
        </header>

        <Display {...display} />
        <p className="sr-only" aria-live="polite">
          {announce(phase, info, job)}
        </p>
        {converting && (
          <progress className="sr-only" value={display.level} max={1} aria-label="Conversion progress" />
        )}

        <div className={styles.controls}>
          <form className={styles.linkForm} onSubmit={onSubmit}>
            <label htmlFor="link" className={`${styles.engraved} ${styles.linkLabel}`}>
              Link
            </label>
            <input
              id="link"
              className={styles.slot}
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="youtube.com/watch?v=…"
              value={link}
              onChange={(event) => setLink(event.target.value)}
              onPaste={onPaste}
              disabled={converting}
            />
            <button type="submit" className={`${styles.key} ${styles.loadKey}`} disabled={converting || !link.trim()}>
              Load video
            </button>
          </form>

          <span id="quality-label" className={`${styles.engraved} ${styles.qualityLabel}`}>
            Quality
          </span>
          <div className={styles.qualityKeys} role="radiogroup" aria-labelledby="quality-label">
            {BITRATES.map((rate) => (
              <label key={rate} className={styles.qualityKey}>
                <input
                  type="radio"
                  name="bitrate"
                  value={rate}
                  checked={bitrate === rate}
                  onChange={() => chooseBitrate(rate)}
                  disabled={converting}
                  className="sr-only"
                />
                <span className={styles.led} aria-hidden="true" />
                <span className={styles.rate}>
                  {rate}
                  <small> kbps</small>
                </span>
                <span className={styles.size}>
                  {info ? `≈ ${formatBytes(estimateBytes(info.duration, rate))}` : " "}
                </span>
              </label>
            ))}
          </div>

          {phase === "done" && job ? (
            <a
              ref={downloadLink}
              className={`${styles.key} ${styles.primary} ${styles.action}`}
              href={`/api/jobs/${job.id}/file`}
              download={job.fileName ?? true}
            >
              <span className={styles.readyLed} aria-hidden="true" />
              Download MP3
            </a>
          ) : (
            <button
              type="button"
              className={`${styles.key} ${styles.primary} ${styles.action}`}
              onClick={convert}
              disabled={!source || converting || phase === "loading"}
            >
              <span className={styles.recLed} data-on={converting || undefined} aria-hidden="true" />
              {converting ? "Converting…" : "Convert to MP3"}
            </button>
          )}

          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
        </div>
      </section>

      <p className={styles.footnote}>
        Only convert videos you own or have permission to download. Converted files are deleted from the server after
        30&nbsp;minutes.
      </p>
    </main>
  );
}

/** What the display shows for each moment in the flow. */
function describe(phase: Phase, info: VideoInfo | null, job: JobStatus | null, bitrate: Bitrate): DisplayProps {
  const total = info ? formatDuration(info.duration) : null;
  const base: DisplayProps = {
    status: "No video loaded",
    format: `MP3 ${bitrate}K`,
    title: info?.title ?? "Paste a link below",
    subtitle: info ? [info.artist, info.album].filter(Boolean).join(" — ") : "",
    counter: total ? `00:00 / ${total}` : "--:--",
    level: 0,
    thumbnail: info?.thumbnail ?? null,
    busy: false,
  };

  switch (phase) {
    case "loading":
      return { ...base, status: "Reading link", title: "· · ·", busy: true };
    case "loaded":
      return { ...base, status: "Loaded" };
    case "converting": {
      const progress = job?.progress ?? 0;
      const counter = `${formatDuration(job?.encodedSeconds ?? 0)} / ${total}`;
      if (job?.stage === "downloading") {
        return { ...base, status: `Fetching audio ${percent(progress)}`, level: progress * DOWNLOAD_SHARE, counter, busy: true };
      }
      if (job?.stage === "encoding") {
        const level = DOWNLOAD_SHARE + progress * (1 - DOWNLOAD_SHARE);
        return { ...base, status: `Encoding ${percent(progress)}`, level, counter, busy: true };
      }
      return { ...base, status: "Waiting in line", busy: true };
    }
    case "done":
      return {
        ...base,
        status: `Ready · ${formatBytes(job?.fileSize ?? 0)}`,
        format: `MP3 ${job?.bitrate ?? bitrate}K`,
        level: 1,
        counter: `${total} / ${total}`,
      };
    case "error":
      return { ...base, status: "Error", title: info?.title ?? "Nothing loaded" };
    default:
      return base;
  }
}

/** Screen-reader summary. Changes only between phases, so it isn't read out on every progress tick. */
function announce(phase: Phase, info: VideoInfo | null, job: JobStatus | null): string {
  switch (phase) {
    case "loading":
      return "Reading link…";
    case "loaded":
      return info ? `Loaded ${info.title} by ${info.artist}, ${formatDuration(info.duration)} long.` : "";
    case "converting":
      return "Converting to MP3…";
    case "done":
      return `Converted. The ${formatBytes(job?.fileSize ?? 0)} MP3 is ready to download.`;
    default:
      return "";
  }
}
