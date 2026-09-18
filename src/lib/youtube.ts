// Shared between the browser and the server, so keep this free of Node APIs.

export const BITRATES = [128, 192, 256, 320] as const;
export type Bitrate = (typeof BITRATES)[number];
export const DEFAULT_BITRATE: Bitrate = 192;

export function isBitrate(value: unknown): value is Bitrate {
  return BITRATES.includes(value as Bitrate);
}

const ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

/**
 * Pulls the 11-character video ID out of anything a person is likely to paste:
 * watch links, youtu.be short links, Shorts, live, embed, YouTube Music, or a bare ID.
 * Returns null for anything else, including playlist-only links.
 */
export function parseVideoId(input: string): string | null {
  const text = input.trim();
  if (ID_PATTERN.test(text)) return text;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  let candidate: string | null | undefined;

  if (host === "youtu.be" || host === "www.youtu.be") {
    candidate = url.pathname.split("/")[1];
  } else if (YOUTUBE_HOSTS.has(host)) {
    const [first, second] = url.pathname.split("/").filter(Boolean);
    if (first === "watch") candidate = url.searchParams.get("v");
    else if (["shorts", "live", "embed", "v", "e"].includes(first)) candidate = second;
  }

  return candidate && ID_PATTERN.test(candidate) ? candidate : null;
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** Constant-bitrate MP3 size is predictable: seconds × kbps ÷ 8. */
export function estimateBytes(durationSeconds: number, bitrate: number): number {
  return (durationSeconds * bitrate * 1000) / 8;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${String(m).padStart(2, "0")}:${sec}`;
}

// Response shapes for the API, shared with the client.

export interface VideoInfo {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  duration: number;
  thumbnail: string | null;
}

export type JobStage = "queued" | "downloading" | "encoding" | "done" | "error";

export interface JobStatus {
  id: string;
  stage: JobStage;
  /** 0–1 within the current stage. */
  progress: number;
  /** Seconds of audio encoded so far (encoding stage). */
  encodedSeconds: number;
  duration: number;
  bitrate: Bitrate;
  fileName: string | null;
  fileSize: number | null;
  error: string | null;
}
