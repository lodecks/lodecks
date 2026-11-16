import { useEngine } from "@/hooks/engine.hook";
import { useCatalog } from "@/hooks/import.hook";
import { api } from "@/utils/client.util";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";

export const getPacks = createServerFn().handler(async () => {
  // the ui still renders when the api is down
  return api.packs.list().catch(() => ({ items: [] }));
});

// shared with the route loader, so packs are in the server render
export const PacksQueryOptions = () =>
  queryOptions({
    queryKey: ["packs"],
    queryFn: () => getPacks()
  });

/**
 * Every pack: the server's (rendered on the server too), plus the ones kept
 * in this browser and fresh imports once the engine is up.
 */
export const usePacks = () => {
  const { data, isLoading, refetch } = useQuery(PacksQueryOptions());
  const engine = useEngine();
  const catalog = useCatalog();
  const local = catalog.packs.filter((pack) => pack.source !== "remote");
  const ids = new Set(local.map((pack) => pack.id));
  const packs = [...local, ...(data?.items || []).filter((pack) => !ids.has(pack.id))].sort((a, b) => a.title.localeCompare(b.title));

  return {
    packs,
    isLoading,
    refetch: () => {
      engine?.catalog.refresh();
      return refetch();
    }
  };
};
