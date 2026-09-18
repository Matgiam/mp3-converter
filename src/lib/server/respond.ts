import { UserFacingError } from "./process";

export function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/** Turns any thrown error into a JSON response without leaking internals. */
export function handleError(err: unknown) {
  if (err instanceof UserFacingError) return errorResponse(err.message, err.status);
  console.error(err);
  return errorResponse("Something went wrong on the server. Try again.", 500);
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}
