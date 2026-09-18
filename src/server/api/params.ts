/** Path segment `back` positions from the end of the URL path, e.g. /api/v1/admin/users/{id}/reset → back=2 gives {id}. */
export function idFromUrl(req: Request, back = 1): string {
  return decodeURIComponent(new URL(req.url).pathname.split("/").filter(Boolean).at(-back) ?? "");
}
