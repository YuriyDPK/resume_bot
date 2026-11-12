export function foreignRequest(request: Request) {
  const origin = request.headers.get("origin");
  const expected = process.env.APP_PUBLIC_ORIGIN || new URL(request.url).origin;
  return request.headers.get("sec-fetch-site") === "cross-site" || Boolean(origin && origin !== expected);
}
