import Storage from "expo-sqlite/kv-store";
import { cache } from "@/lib/cache";
import { getProfileBannerBackdrop } from "@/lib/profile-banner";
import * as mediaApi from "@/lib/media-api";

const resetStorage = () => (Storage as unknown as { __clear: () => void }).__clear();

beforeEach(async () => {
  jest.useRealTimers();
  await cache.clearAll();
  resetStorage();
  jest.restoreAllMocks();
});

describe("getProfileBannerBackdrop", () => {
  it("returns fallback backdrop when history is empty", async () => {
    const url = await getProfileBannerBackdrop([]);
    expect(url).toContain("unsplash.com");
  });

  it("resolves backdrop from recently watched history and caches it", async () => {
    const spy = jest.spyOn(mediaApi, "fetchMediaDetails").mockResolvedValue({
      id: 101,
      title: "The Americans",
      backdrop_path: "/americans_backdrop.jpg",
      poster_path: "/americans_poster.jpg",
      vote_average: 8.5,
      overview: "Spy drama",
      genres: [],
      cast: [],
    });

    const history: mediaApi.WatchedItem[] = [
      {
        media_id: 101,
        media_type: "tv",
        season_number: 1,
        episode_number: 1,
        watched_at: new Date().toISOString(),
      },
    ];

    const url = await getProfileBannerBackdrop(history);
    expect(url).toContain("americans_backdrop.jpg");
    expect(spy).toHaveBeenCalledTimes(1);

    // Call again immediately: should hit cache and NOT invoke fetchMediaDetails again
    const secondCallUrl = await getProfileBannerBackdrop(history);
    expect(secondCallUrl).toEqual(url);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
