import { readFile } from "node:fs/promises";
import path from "node:path";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { audit } from "@/server/audit/audit";
import { handle, fail } from "@/server/api/respond";
import { idFromUrl } from "@/server/api/params";
import { getConfig } from "@/server/db/config";

/**
 * GET /api/v1/students/{id}/photo (Bio Spec 1.4, A-27).
 *
 * The share is never exposed to the browser: the file is read by the server and streamed through
 * this authenticated route, so a photo cannot be fetched by guessing a UNC path. A missing file is
 * NORMAL — most students have no photo on file — and returns 404 so the card can show a placeholder
 * without logging an error.
 */
export const GET = handle(async (req, { correlationId }) => {
  const principal = requirePermission(await getPrincipal(), "student.view");
  const id = idFromUrl(req, 2);
  // The id is part of a filesystem path, so it is re-validated here even though the route that
  // produced the link already did: digits only, no separators, no traversal.
  if (!/^\d{1,20}$/.test(id)) return fail(400, "invalid_id", "Student IDs are numeric.", correlationId);

  const share = getConfig().STUDENT_PHOTO_SHARE;
  if (!share) return fail(404, "no_photo_share", "No student photo share is configured.", correlationId);

  try {
    const file = path.join(share, `${id}.jpg`);
    const bytes = await readFile(file);
    await audit(principal, "student.photo_view", { correlationId, targetType: "student", targetId: id });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "image/jpeg",
        // A student photo is not something to leave in a shared cache or on disk.
        "cache-control": "private, no-store",
        "x-correlation-id": correlationId,
      },
    });
  } catch {
    return fail(404, "not_found", "No photo on file for this student.", correlationId);
  }
});
