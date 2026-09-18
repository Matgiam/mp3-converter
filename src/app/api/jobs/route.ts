import { createJob, toStatus } from "@/lib/server/jobs";
import { errorResponse, handleError, readJson } from "@/lib/server/respond";
import { isBitrate, parseVideoId } from "@/lib/youtube";

export async function POST(request: Request) {
  const { url, bitrate } = await readJson(request);
  const videoId = typeof url === "string" ? parseVideoId(url) : null;
  if (!videoId) return errorResponse("That doesn't look like a YouTube video link.", 400);
  if (!isBitrate(bitrate)) return errorResponse("Pick a quality of 128, 192, 256 or 320 kbps.", 400);

  try {
    const job = await createJob(videoId, bitrate);
    return Response.json(toStatus(job), { status: 202 });
  } catch (err) {
    return handleError(err);
  }
}
