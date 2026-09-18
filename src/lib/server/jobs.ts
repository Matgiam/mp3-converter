import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Bitrate, JobStage, JobStatus, VideoInfo } from "@/lib/youtube";
import { downloadCover, encodeMp3 } from "./ffmpeg";
import { UserFacingError } from "./process";
import { downloadAudio, extractInfo } from "./ytdlp";

const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_JOBS ?? 2);
const MAX_QUEUED = 20;
/** Finished MP3s stay downloadable for this long. */
const JOB_TTL_MS = 30 * 60_000;
/** yt-dlp's stream URLs last for hours, but metadata can go stale; refetch after this. */
const INFO_TTL_MS = 20 * 60_000;
const ORPHAN_AGE_MS = 3 * 60 * 60_000;

interface Job {
  id: string;
  videoId: string;
  bitrate: Bitrate;
  info: VideoInfo;
  stage: JobStage;
  progress: number;
  encodedSeconds: number;
  error: string | null;
  filePath: string | null;
  fileName: string | null;
  fileSize: number | null;
  finishedAt: number | null;
}

interface CachedInfo {
  info: VideoInfo;
  jsonPath: string;
  fetchedAt: number;
}

interface Store {
  workDir: string;
  jobs: Map<string, Job>;
  queue: Job[];
  active: number;
  info: Map<string, Promise<CachedInfo>>;
}

const globalStore = globalThis as typeof globalThis & { __mp3Converter?: Store };

/**
 * Created on first use rather than at import: Next.js imports route modules in
 * short-lived worker processes (e.g. to collect static paths), and those must not
 * start timers or touch the shared temp folder. Kept on globalThis so dev-mode
 * hot reloads don't orphan running jobs.
 */
function getStore(): Store {
  if (!globalStore.__mp3Converter) {
    const workDir = path.join(os.tmpdir(), "mp3-converter");
    mkdirSync(workDir, { recursive: true });
    globalStore.__mp3Converter = { workDir, jobs: new Map(), queue: [], active: 0, info: new Map() };
    setInterval(sweep, 60_000).unref();
    void sweep();
  }
  return globalStore.__mp3Converter;
}

async function sweep() {
  const store = globalStore.__mp3Converter!;
  const now = Date.now();
  for (const job of store.jobs.values()) {
    if (job.finishedAt && now - job.finishedAt > JOB_TTL_MS) {
      store.jobs.delete(job.id);
      if (job.filePath) await rm(job.filePath, { force: true });
    }
  }
  for (const [videoId, pending] of store.info) {
    const cached = await pending.catch(() => null);
    if (cached && now - cached.fetchedAt > INFO_TTL_MS && store.info.get(videoId) === pending) {
      store.info.delete(videoId);
      await rm(cached.jsonPath, { force: true });
    }
  }
  // Safety net for files orphaned by a crash or restart: nothing live is this old.
  for (const name of await readdir(store.workDir).catch(() => [])) {
    const file = path.join(store.workDir, name);
    const info = await stat(file).catch(() => null);
    if (info && now - info.mtimeMs > ORPHAN_AGE_MS) await rm(file, { force: true });
  }
}

/** Metadata for a video, cached so the preview and the conversion share one lookup. */
export function getInfo(videoId: string, { fresh = false } = {}): Promise<CachedInfo> {
  const store = getStore();
  const cached = store.info.get(videoId);
  if (cached && !fresh) return cached;

  const pending = (async () => {
    const jsonPath = path.join(store.workDir, `info-${videoId}-${randomUUID()}.json`);
    const info = await extractInfo(videoId, jsonPath);
    return { info, jsonPath, fetchedAt: Date.now() };
  })();
  store.info.set(videoId, pending);
  // Don't cache failures: the next request should try again.
  pending.catch(() => {
    if (store.info.get(videoId) === pending) store.info.delete(videoId);
  });
  return pending;
}

export async function createJob(videoId: string, bitrate: Bitrate): Promise<Job> {
  const store = getStore();
  for (const job of store.jobs.values()) {
    if (job.videoId === videoId && job.bitrate === bitrate && job.stage !== "error") return job;
  }
  if (store.queue.length >= MAX_QUEUED) {
    throw new UserFacingError("The converter is busy with other videos. Try again in a minute.", 503);
  }

  const { info } = await getInfo(videoId);
  const job: Job = {
    id: randomUUID(),
    videoId,
    bitrate,
    info,
    stage: "queued",
    progress: 0,
    encodedSeconds: 0,
    error: null,
    filePath: null,
    fileName: null,
    fileSize: null,
    finishedAt: null,
  };
  store.jobs.set(job.id, job);
  store.queue.push(job);
  pump();
  return job;
}

export function getJob(id: string): Job | undefined {
  return getStore().jobs.get(id);
}

export function toStatus(job: Job): JobStatus {
  return {
    id: job.id,
    stage: job.stage,
    progress: job.progress,
    encodedSeconds: job.encodedSeconds,
    duration: job.info.duration,
    bitrate: job.bitrate,
    fileName: job.fileName,
    fileSize: job.fileSize,
    error: job.error,
  };
}

function pump() {
  const store = getStore();
  while (store.active < MAX_CONCURRENT && store.queue.length > 0) {
    const job = store.queue.shift()!;
    store.active++;
    void runJob(job).finally(() => {
      store.active--;
      pump();
    });
  }
}

async function runJob(job: Job) {
  const base = path.join(getStore().workDir, job.id);
  const coverPath = `${base}.cover`;
  const outputPath = `${base}.mp3`;
  let sourcePath: string | null = null;

  try {
    job.stage = "downloading";
    const onDownload = (fraction: number) => (job.progress = fraction);
    try {
      const { jsonPath } = await getInfo(job.videoId);
      sourcePath = await downloadAudio(jsonPath, `${base}.source`, onDownload);
    } catch {
      // Cached stream URLs can expire or get refused; one retry with fresh metadata fixes most of these.
      job.progress = 0;
      const { jsonPath } = await getInfo(job.videoId, { fresh: true });
      sourcePath = await downloadAudio(jsonPath, `${base}.source`, onDownload);
    }

    job.stage = "encoding";
    job.progress = 0;
    const { info } = job;
    const encode = (cover: string | null) =>
      encodeMp3({
        input: sourcePath!,
        output: outputPath,
        cover,
        bitrate: job.bitrate,
        tags: {
          title: info.title,
          artist: info.artist,
          album: info.album,
          comment: `https://youtu.be/${info.id}`,
        },
        onProgress(seconds) {
          job.encodedSeconds = Math.min(seconds, info.duration);
          if (info.duration > 0) job.progress = Math.min(1, seconds / info.duration);
        },
      });

    const hasCover = await downloadCover(info.thumbnail, coverPath);
    try {
      await encode(hasCover ? coverPath : null);
    } catch (err) {
      if (!hasCover) throw err;
      // A thumbnail ffmpeg can't read shouldn't cost the whole conversion.
      await encode(null);
    }

    job.fileSize = (await stat(outputPath)).size;
    job.filePath = outputPath;
    job.fileName = toFileName(info.title);
    job.encodedSeconds = info.duration;
    job.progress = 1;
    job.stage = "done";
  } catch (err) {
    console.error(`[job ${job.id}]`, err);
    job.stage = "error";
    job.error =
      err instanceof UserFacingError ? err.message : "The conversion failed on the server. Try again, or pick another video.";
    await rm(outputPath, { force: true });
  } finally {
    job.finishedAt = Date.now();
    await Promise.all([
      sourcePath ? rm(sourcePath, { force: true }) : null,
      rm(coverPath, { force: true }),
    ]);
  }
}

function toFileName(title: string): string {
  const cleaned = title
    .replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 120);
  return `${cleaned || "audio"}.mp3`;
}
