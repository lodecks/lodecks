import { PacksQueryOptions } from "@/hooks/packs.hook";
import { RouterContext } from "@/router";

// every route gets the pack list from the server render
export const defineRoute = () => {
  return {
    loader: ({ context }: { context: any }) => {
      return (context as RouterContext).queryClient.ensureQueryData(
        PacksQueryOptions()
      );
    }
  };
};

export const getTitle = (title?: string) =>
  title ? `${title} · lodecks` : "lodecks";

export const defineHead = ({ title }: { title?: string }) => {
  return {
    head: () => ({ meta: [{ title: getTitle(title) }] })
  } as any;
};
