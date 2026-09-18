import { getInfo } from "@/lib/server/jobs";
import { errorResponse, handleError, readJson } from "@/lib/server/respond";
import { parseVideoId } from "@/lib/youtube";

export async function POST(request: Request) {
  const { url } = await readJson(request);
  const videoId = typeof url === "string" ? parseVideoId(url) : null;
  if (!videoId) return errorResponse("That doesn't look like a YouTube video link.", 400);

  try {
    const { info } = await getInfo(videoId);
    return Response.json(info);
  } catch (err) {
    return handleError(err);
  }
}
