/**
 * On Cloudflare Workers the api runs in the same Worker as the app, so the
 * server render calls it directly instead of over the network. server.ts
 * sets it on every request; elsewhere (the Bun api in dev) it stays unset.
 */
type LocalApi = (request: Request) => Promise<Response> | Response;

let local: LocalApi | undefined;

export const setLocalApi = (api: LocalApi) => {
  local = api;
};

export const localApi = () => local;
