import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

/** An error whose message is safe and useful to show to the person using the app. */
export class UserFacingError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
    this.name = "UserFacingError";
  }
}

const exe = process.platform === "win32" ? ".exe" : "";

export function ytDlpPath(): string {
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
  const bundled = path.join(process.cwd(), "bin", `yt-dlp${exe}`);
  return existsSync(bundled) ? bundled : "yt-dlp";
}

export function ffmpegPath(): string {
  return process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";
}

export class ProcessError extends Error {
  constructor(
    readonly command: string,
    readonly code: number | null,
    readonly stderr: string,
  ) {
    super(`${command} exited with code ${code}: ${stderr.trim().split(/\r?\n/).pop() ?? ""}`);
  }
}

interface RunOptions {
  /** Called for every complete line on stdout, as it arrives. */
  onLine?: (line: string) => void;
}

const STDERR_LIMIT = 16_000;

export function run(command: string, args: string[], { onLine }: RunOptions = {}) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const name = path.basename(command).replace(/\.exe$/i, "");
    let stdout = "";
    let stderr = "";
    let pending = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!onLine) return;
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) if (line) onLine(line);
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_LIMIT);
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        const fix = name === "yt-dlp" ? "Run `npm run update:yt-dlp`" : "Reinstall dependencies with `npm install`";
        reject(new UserFacingError(`${name} isn't installed on the server. ${fix}, then restart the app.`, 500));
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      if (onLine && pending) onLine(pending);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new ProcessError(name, code, stderr));
    });
  });
}
