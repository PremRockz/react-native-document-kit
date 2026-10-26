/**
 * Called when a server answers 401 or 403 to a DocumentKit request (download,
 * document preview or video stream). Return fresh headers (e.g. a renewed
 * session cookie) to retry once, or null to give up: the result is then
 * `unauthorized`, so the app can ask the user to sign in again.
 */
export type UnauthorizedHandler = (request: {
  url: string;
  httpStatus: number;
}) => Promise<Record<string, string> | null | undefined>;

let defaultHandler: UnauthorizedHandler | null = null;
// One refresh per server at a time: several requests failing together share it.
const refreshesByOrigin = new Map<string, Promise<Record<string, string> | null>>();

/** Set by DocumentKitProvider's onUnauthorized; used when a call passes none of its own. */
export const setDefaultUnauthorizedHandler = (handler: UnauthorizedHandler | null): void => {
  defaultHandler = handler;
};

export const isUnauthorizedStatus = (status: number | undefined): status is 401 | 403 =>
  status === 401 || status === 403;

const originOf = (url: string): string => /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+/i.exec(url)?.[0] ?? url;

/**
 * Fresh headers from `handler` (or the provider's), or null when there is no
 * handler or it gave up. Never rejects: a throwing handler counts as giving up
 * (the provider reports it to onError).
 */
export const refreshHeaders = (
  url: string,
  httpStatus: number,
  handler: UnauthorizedHandler | undefined = defaultHandler ?? undefined,
): Promise<Record<string, string> | null> => {
  if (!handler) {
    return Promise.resolve(null);
  }
  const origin = originOf(url);
  const inFlight = refreshesByOrigin.get(origin);
  if (inFlight) {
    return inFlight;
  }
  const refresh = handler({url, httpStatus})
    .then(headers => (headers && Object.keys(headers).length > 0 ? headers : null))
    .catch(() => null)
    .finally(() => refreshesByOrigin.delete(origin));
  refreshesByOrigin.set(origin, refresh);
  return refresh;
};

/** `fresh` replaces same-named headers in `base`, whatever their case ("cookie" vs "Cookie"). */
export const mergeHeaders = (
  base: Record<string, string>,
  fresh: Record<string, string>,
): Record<string, string> => {
  const freshNames = new Set(Object.keys(fresh).map(name => name.toLowerCase()));
  const kept = Object.entries(base).filter(([name]) => !freshNames.has(name.toLowerCase()));
  return {...Object.fromEntries(kept), ...fresh};
};
