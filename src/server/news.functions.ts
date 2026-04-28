import { createServerFn } from "@tanstack/react-start";
import { cached } from "./cache";
import { fetchNews } from "./news";

export const getNews = createServerFn({ method: "GET" })
  .inputValidator((i: { refresh?: boolean } | undefined) => i ?? {})
  .handler(async ({ data }) => {
    return cached(`news:nrl`, 10 * 60_000, () => fetchNews(), { bypass: data.refresh });
  });
