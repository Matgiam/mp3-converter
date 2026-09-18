// Downloads the standalone yt-dlp executable for this platform into ./bin.
// Runs on `npm install` (postinstall). Pass --force to replace an existing copy,
// which is how `npm run update:yt-dlp` picks up YouTube fixes.
import { chmod, mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RELEASES = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binDir = path.join(root, "bin");
const force = process.argv.includes("--force");

function assetName() {
  const { platform, arch } = process;
  if (platform === "win32") {
    if (arch === "arm64") return "yt-dlp_arm64.exe";
    if (arch === "ia32") return "yt-dlp_x86.exe";
    return "yt-dlp.exe";
  }
  if (platform === "darwin") return "yt-dlp_macos";
  if (platform === "linux") {
    if (arch === "arm64") return "yt-dlp_linux_aarch64";
    if (arch === "arm") return "yt-dlp_linux_armv7l";
    return "yt-dlp_linux";
  }
  return null;
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (process.env.YTDLP_PATH) {
    console.log(`[setup] YTDLP_PATH is set (${process.env.YTDLP_PATH}); skipping download.`);
    return;
  }

  const asset = assetName();
  if (!asset) {
    console.warn(`[setup] No yt-dlp build for ${process.platform}/${process.arch}. Install yt-dlp and set YTDLP_PATH.`);
    return;
  }

  const target = path.join(binDir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  if (!force && (await exists(target))) {
    console.log("[setup] yt-dlp already present. Run `npm run update:yt-dlp` to refresh it.");
    return;
  }

  console.log(`[setup] Downloading ${asset} from the official yt-dlp releases...`);
  const res = await fetch(`${RELEASES}/${asset}`);
  if (!res.ok) throw new Error(`GitHub responded ${res.status} ${res.statusText}`);
  const bytes = Buffer.from(await res.arrayBuffer());

  await mkdir(binDir, { recursive: true });
  const tmp = `${target}.download`;
  await writeFile(tmp, bytes);
  await chmod(tmp, 0o755);
  await rename(tmp, target);
  console.log(`[setup] Saved yt-dlp to ${path.relative(root, target)} (${(bytes.length / 1e6).toFixed(1)} MB).`);
}

main().catch((err) => {
  // Never fail `npm install` over this; the app reports a clear error at runtime instead.
  console.warn(`[setup] Could not download yt-dlp: ${err.message}`);
  console.warn("[setup] Retry with `npm run update:yt-dlp`, or install yt-dlp yourself and set YTDLP_PATH.");
});
