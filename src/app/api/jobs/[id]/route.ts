import { getJob, toStatus } from "@/lib/server/jobs";
import { errorResponse } from "@/lib/server/respond";

export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) return errorResponse("This conversion has expired. Convert the video again.", 404);
  return Response.json(toStatus(job), { headers: { "Cache-Control": "no-store" } });
}
