import { writeFile } from "node:fs/promises";
import type { Bitrate } from "@/lib/youtube";
import { ffmpegPath, run } from "./process";

/**
 * Turns a YouTube thumbnail into square cover art: first trims the black bars
 * YouTube bakes into 4:3 thumbnails, then takes the centre square.
 */
const COVER_FILTER = "crop=iw:'min(ih,iw*9/16)',crop='min(iw,ih)':'min(iw,ih)'";

/** Saves the thumbnail for use as cover art. Returns false if it can't be fetched. */
export async function downloadCover(url: string | null, dest: string): Promise<boolean> {
  if (!url) return false;
  try {
    if (!new URL(url).hostname.endsWith(".ytimg.com")) return false;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return false;
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch {
    return false;
  }
}

interface EncodeOptions {
  input: string;
  output: string;
  cover: string | null;
  bitrate: Bitrate;
  tags: Record<string, string | null>;
  /** Called with the number of seconds of audio written so far. */
  onProgress: (seconds: number) => void;
}

export async function encodeMp3({ input, output, cover, bitrate, tags, onProgress }: EncodeOptions) {
  const args = ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", input];
  if (cover) args.push("-i", cover);

  args.push("-map", "0:a:0");
  if (cover) {
    args.push(
      "-map", "1:v:0",
      "-c:v", "mjpeg",
      "-q:v", "2",
      "-vf", COVER_FILTER,
      "-disposition:v:0", "attached_pic",
      "-metadata:s:v:0", "title=Album cover",
      "-metadata:s:v:0", "comment=Cover (front)",
    );
  }

  args.push("-c:a", "libmp3lame", "-b:a", `${bitrate}k`, "-ar", "44100", "-id3v2_version", "3", "-write_id3v1", "1");
  for (const [key, value] of Object.entries(tags)) {
    if (value) args.push("-metadata", `${key}=${value}`);
  }
  args.push("-progress", "pipe:1", "-nostats", output);

  await run(ffmpegPath(), args, {
    onLine(line) {
      const match = /^out_time_(?:us|ms)=(\d+)/.exec(line);
      if (match) onProgress(Number(match[1]) / 1e6);
    },
  });
}
