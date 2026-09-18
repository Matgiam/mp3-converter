# Dubdeck: YouTube to MP3

A Next.js app that turns a YouTube link into a tagged MP3. Paste a link, pick a bitrate (128–320 kbps), and download an MP3 with the title, artist and a square cover art image built in.

Only convert videos you own or have permission to download. Downloading from YouTube may break YouTube's Terms of Service, so this app is meant for personal use.

## Run it

```bash
npm install     # also downloads the yt-dlp binary into ./bin
npm run dev     # http://localhost:3000
```

You need Node.js 20 or newer. yt-dlp uses Node as its JavaScript runtime, so nothing else has to be installed. ffmpeg ships with the `ffmpeg-static` package.

When YouTube changes something and conversions start failing, update the downloader:

```bash
npm run update:yt-dlp
```

## How it works

1. **`POST /api/info`**: yt-dlp reads the video's metadata. The result is cached for 20 minutes, so the conversion step doesn't have to read it again.
2. **`POST /api/jobs`**: starts a conversion job. At most 2 run at a time and the rest wait in a queue. The job:
   - downloads the best audio-only stream with yt-dlp
   - encodes it to constant-bitrate MP3 with ffmpeg, adding ID3 tags and the thumbnail (cropped square) as cover art
3. **`GET /api/jobs/:id`**: the page polls this for progress: download percentage, then how many seconds of audio have been encoded.
4. **`GET /api/jobs/:id/file`**: streams the finished MP3.

Files are stored in the OS temp folder and deleted 30 minutes after the conversion finishes.

| Path | Purpose |
| --- | --- |
| `src/components/Deck.tsx` | The page UI and client-side flow |
| `src/components/Display.tsx` | The dot-matrix display |
| `src/lib/youtube.ts` | Link parsing and shared types (used by browser and server) |
| `src/lib/server/jobs.ts` | Job queue, info cache, cleanup |
| `src/lib/server/ytdlp.ts` | yt-dlp calls and error messages |
| `src/lib/server/ffmpeg.ts` | MP3 encoding and cover art |
| `scripts/setup-binaries.mjs` | Downloads yt-dlp for the current platform |

## Configuration

All of these are optional environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `YTDLP_PATH` | `./bin/yt-dlp` | Use a yt-dlp you installed yourself |
| `FFMPEG_PATH` | from `ffmpeg-static` | Use your own ffmpeg |
| `MAX_DURATION_MINUTES` | `180` | Longest video accepted |
| `MAX_CONCURRENT_JOBS` | `2` | Conversions running at the same time |
| `YTDLP_COOKIES` | none | Path to a YouTube `cookies.txt`, used when YouTube asks the server to sign in (see below) |

## Deploying

The app needs a long-running Node server that can run child processes and write to disk, so serverless hosts such as Vercel won't work. Use `npm run build && npm start` on a VPS, or put it in a container.

### "YouTube is blocking downloads from this server"

YouTube treats most cloud and datacenter IP addresses as bots and answers with *"Sign in to confirm you're not a bot"*. Nothing in the code can fix that on its own. You have two options:

**1. Run it from a home connection.** Host the app on a machine at home and expose it with something like Cloudflare Tunnel or Tailscale Funnel. Home IP addresses are rarely challenged.

**2. Sign the server in with cookies.**

1. Use a **secondary Google account**. Google can restrict accounts used for automated downloads.
2. Open a private/incognito window, sign in to YouTube, then open `https://www.youtube.com/robots.txt` in that same tab.
3. Export the `youtube.com` cookies in Netscape format with a cookies.txt browser extension, then close the private window. Closing it stops YouTube from rotating the session you just exported.
4. Upload the file to the server outside the repo, then set `YTDLP_COOKIES=/path/to/cookies.txt` and restart.

The cookie file is a login to that account, so treat it like a password. Never commit it (`cookies*.txt` is git-ignored), and keep in mind that everyone using your deployed site converts through that account. When the cookies expire, the server log says so; export fresh ones and restart.
