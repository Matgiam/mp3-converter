import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { formatDuration, watchUrl, type VideoInfo } from "@/lib/youtube";
import { ProcessError, UserFacingError, run, ytDlpPath } from "./process";

const MAX_DURATION_SECONDS = Number(process.env.MAX_DURATION_MINUTES ?? 180) * 60;

/**
 * yt-dlp rewrites the cookie file it's given after every run, so it gets a private
 * copy: the original can live on a read-only mount, and it's never modified.
 */
function cookieArgs(): string[] {
  const source = process.env.YTDLP_COOKIES;
  if (!source) return [];
  if (!existsSync(source)) {
    console.error(`[yt-dlp] YTDLP_COOKIES points to ${source}, but there's no file there.`);
    throw new UserFacingError("The converter isn't set up correctly. Check the server logs.", 500);
  }
  const copy = path.join(os.tmpdir(), "mp3-converter", "cookies.txt");
  if (!existsSync(copy)) {
    mkdirSync(path.dirname(copy), { recursive: true });
    copyFileSync(source, copy);
  }
  return ["--cookies", copy];
}

function baseArgs() {
  return [
    "--ignore-config",
    "--no-playlist",
    "--no-warnings",
    // YouTube now needs a JavaScript runtime to unlock formats; reuse the Node running this app.
    "--js-runtimes",
    `node:${process.execPath}`,
    ...cookieArgs(),
  ];
}

const BOT_CHECK = /not a bot|sign in to confirm/i;

// Ordered: the first pattern that matches yt-dlp's error wins.
const KNOWN_ERRORS: [RegExp, string, number?][] = [
  [/private video/i, "This video is private."],
  [/confirm your age|age.restricted|inappropriate for some users/i, "This video is age-restricted, and age-restricted videos can't be converted without signing in."],
  [BOT_CHECK, "YouTube is blocking downloads from this server right now. Try again later.", 503],
  [/members.only|join this channel/i, "This video is for channel members only."],
  [/not available in your country|geo.?restrict/i, "This video isn't available in the server's region."],
  [/premieres? in|will begin in|upcoming/i, "This video hasn't premiered yet."],
  [/copyright/i, "This video was taken down over a copyright claim."],
  [/http error 429|too many requests/i, "YouTube is rate-limiting this server. Wait a few minutes, then try again.", 503],
  [/video (is )?(unavailable|not available)|has been removed|does not exist/i,"This video is unavailable. Check the link, then try again."],
];

export function explainYtDlpFailure(err: unknown): Error {
  if (!(err instanceof ProcessError)) return err as Error;
  const lines = err.stderr.split(/\r?\n/);
  const errorLine = lines.reverse().find((line) => line.startsWith("ERROR:")) ?? err.stderr;
  console.error(`[yt-dlp] ${errorLine}`);
  if (BOT_CHECK.test(errorLine)) {
    // Visitors get a plain message; whoever runs the server gets the fix.
    console.error(
      process.env.YTDLP_COOKIES
        ? "[yt-dlp] YouTube rejected the cookies in YTDLP_COOKIES. They've probably expired: export fresh ones (see README)."
        : "[yt-dlp] YouTube wants this server to sign in, which is common on cloud hosting. Set YTDLP_COOKIES (see README).",
    );
  }
  for (const [pattern, message, status] of KNOWN_ERRORS) {
    if (pattern.test(errorLine)) return new UserFacingError(message, status);
  }
  return new UserFacingError(
    "YouTube didn't hand over this video. Updating the downloader usually fixes this: run `npm run update:yt-dlp`, then restart the app.",
    502,
  );
}

interface RawInfo {
  id: string;
  title?: string;
  track?: string;
  artists?: string[];
  artist?: string;
  creator?: string;
  channel?: string;
  uploader?: string;
  album?: string;
  duration?: number;
  thumbnail?: string;
  is_live?: boolean;
  live_status?: string;
}

function toVideoInfo(raw: RawInfo): VideoInfo {
  const artist = raw.artists?.[0] ?? raw.artist ?? raw.creator ?? raw.channel ?? raw.uploader ?? "Unknown artist";
  return {
    id: raw.id,
    title: raw.track ?? raw.title ?? raw.id,
    // Auto-generated music channels are named "Artist - Topic".
    artist: artist.replace(/\s+-\s+Topic$/, ""),
    album: raw.album ?? null,
    duration: Math.round(raw.duration ?? 0),
    thumbnail: raw.thumbnail ?? `https://i.ytimg.com/vi/${raw.id}/hqdefault.jpg`,
  };
}

function assertConvertible(raw: RawInfo) {
  if (raw.is_live || raw.live_status === "is_live") {
    throw new UserFacingError("This is a live stream. Convert it once the stream has ended.");
  }
  if (raw.live_status === "is_upcoming") throw new UserFacingError("This video hasn't premiered yet.");
  if (raw.live_status === "post_live") {
    throw new UserFacingError("YouTube is still processing this stream. Try again in a little while.");
  }
  if ((raw.duration ?? 0) > MAX_DURATION_SECONDS) {
    throw new UserFacingError(
      `This video runs ${formatDuration(raw.duration!)}, over the ${formatDuration(MAX_DURATION_SECONDS)} limit.`,
    );
  }
}

/**
 * Fetches metadata and saves yt-dlp's full info JSON to `jsonPath`,
 * so the download step can skip a second round of extraction.
 */
export async function extractInfo(videoId: string, jsonPath: string): Promise<VideoInfo> {
  let stdout: string;
  try {
    ({ stdout } = await run(ytDlpPath(), [...baseArgs(), "--dump-single-json", "--", watchUrl(videoId)]));
  } catch (err) {
    throw explainYtDlpFailure(err);
  }
  const raw = JSON.parse(stdout) as RawInfo;
  assertConvertible(raw);
  await writeFile(jsonPath, stdout);
  return toVideoInfo(raw);
}

/** Downloads the best audio-only stream and resolves with the saved file's path. */
export async function downloadAudio(
  infoJsonPath: string,
  outputBase: string,
  onProgress: (fraction: number) => void,
): Promise<string> {
  let savedPath = "";
  try {
    await run(
      ytDlpPath(),
      [
        ...baseArgs(),
        "--load-info-json",
        infoJsonPath,
        // Skip the "drc" (dynamic range compressed) variants YouTube offers alongside the originals.
        "--format",
        "bestaudio[format_id!*=drc]/bestaudio/best",
        "--no-part",
        "--no-mtime",
        "--newline",
        "--progress",
        "--progress-template",
        "download:DL %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s",
        "--output",
        `${path.basename(outputBase)}.%(ext)s`,
        "--paths",
        path.dirname(outputBase),
        "--print",
        "after_move:filepath",
        "--no-simulate",
      ],
      {
        onLine(line) {
          if (!line.startsWith("DL ")) {
            savedPath = line.trim();
            return;
          }
          const [done, total, estimate] = line.slice(3).split(" ").map(Number);
          const size = total || estimate;
          if (done && size) onProgress(Math.min(1, done / size));
        },
      },
    );
  } catch (err) {
    throw explainYtDlpFailure(err);
  }
  if (!savedPath) throw new Error("yt-dlp finished without reporting a file path");
  return savedPath;
}
