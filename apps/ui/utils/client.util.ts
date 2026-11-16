import { PackSummary } from "@/common/schemas/pack.schema";

// the api runs next to the ui; on the server we talk to it directly
const Base =
  typeof window === "undefined"
    ? process.env.LODECKS_API || "http://127.0.0.1:8090"
    : "";

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${Base}/api/v1${path}`, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return response.json();
};

export const api = {
  packs: {
    // the server only lists packs and serves them to download
    list: () => request<{ items: PackSummary[] }>("/packs")
  },
  images: {
    /** Downloads an image from a url through the api, which can reach any host */
    fetch: async (url: string) => {
      const response = await fetch(`${Base}/api/v1/fetch?url=${encodeURIComponent(url)}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${response.status})`);
      }
      const name = decodeURIComponent(response.headers.get("x-image-name") || "gif");
      return { blob: await response.blob(), name };
    }
  }
};
