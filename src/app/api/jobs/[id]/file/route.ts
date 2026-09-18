import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { getJob } from "@/lib/server/jobs";
import { errorResponse } from "@/lib/server/respond";

/** RFC 6266 header with an ASCII fallback for old clients and the real (UTF-8) name for everyone else. */
function contentDisposition(fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]/file">) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) return errorResponse("This file has expired. Convert the video again.", 404);
  if (job.stage !== "done" || !job.filePath || !job.fileName) {
    return errorResponse("This MP3 isn't ready yet.", 409);
  }

  const stream = Readable.toWeb(createReadStream(job.filePath)) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(job.fileSize),
      "Content-Disposition": contentDisposition(job.fileName),
      "Cache-Control": "no-store",
    },
  });
}
