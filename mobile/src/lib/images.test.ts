import { imageCachePolicy, imageTransitionMs, imageUrl } from "@/lib/images";

/**
 * Image sizing by role.
 *
 * The rule this enforces is the one that produced the 88 MB image cache: every
 * poster requested `w500` regardless of how large it was drawn, so a 60pt Home
 * cell pulled down roughly seven times the bytes it could display. These tests
 * pin the role-to-bucket mapping so a future call site cannot silently ask for
 * hero-sized artwork in a list.
 */

describe("imageUrl", () => {
  it("builds a TMDB url at the bucket for the role", () => {
    expect(imageUrl("/abc.jpg", "posterCell")).toBe(
      "https://image.tmdb.org/t/p/w185/abc.jpg",
    );
    expect(imageUrl("/abc.jpg", "posterCard")).toBe(
      "https://image.tmdb.org/t/p/w342/abc.jpg",
    );
    expect(imageUrl("/abc.jpg", "still")).toBe(
      "https://image.tmdb.org/t/p/w300/abc.jpg",
    );
    expect(imageUrl("/abc.jpg", "backdrop")).toBe(
      "https://image.tmdb.org/t/p/w780/abc.jpg",
    );
  });

  it("returns an empty string for a missing path", () => {
    // Callers keep their existing `url ? <Image/> : <placeholder/>` checks, so
    // this must be falsy rather than a broken url.
    expect(imageUrl(null, "posterCell")).toBe("");
    expect(imageUrl(undefined, "posterCell")).toBe("");
    expect(imageUrl("", "posterCell")).toBe("");
  });

  it("never serves the old oversized w500 bucket", () => {
    // w500 is the specific regression: it was the default for every poster in
    // the app, including 60pt list cells.
    for (const role of [
      "posterCell",
      "posterCard",
      "still",
      "backdrop",
      "profile",
      "logo",
    ] as const) {
      expect(imageUrl("/x.jpg", role)).not.toContain("/w500/");
    }
  });

  it("gives list cells fewer bytes than grid cards", () => {
    // Cheap proxy for the size ordering that the byte reduction depends on.
    const cell = Number(imageUrl("/x.jpg", "posterCell").match(/w(\d+)/)![1]);
    const card = Number(imageUrl("/x.jpg", "posterCard").match(/w(\d+)/)![1]);
    const backdrop = Number(imageUrl("/x.jpg", "backdrop").match(/w(\d+)/)![1]);

    expect(cell).toBeLessThan(card);
    expect(card).toBeLessThan(backdrop);
  });
});

describe("imageCachePolicy", () => {
  it("keeps large one-shot artwork out of the disk cache", () => {
    // A full-bleed backdrop is the biggest file the app downloads and is
    // typically seen once per visit; writing it to disk is the main reason the
    // disk cache grew into the tens of megabytes.
    expect(imageCachePolicy("backdrop")).toBe("memory");
    expect(imageCachePolicy("logo")).toBe("memory");
  });

  it("persists small, frequently revisited thumbnails", () => {
    expect(imageCachePolicy("posterCell")).toBe("memory-disk");
    expect(imageCachePolicy("posterCard")).toBe("memory-disk");
    expect(imageCachePolicy("still")).toBe("memory-disk");
    expect(imageCachePolicy("profile")).toBe("memory-disk");
  });
});

describe("imageTransitionMs", () => {
  it("fades list cells in faster than hero artwork", () => {
    expect(imageTransitionMs("posterCell")).toBeLessThan(
      imageTransitionMs("backdrop"),
    );
  });
});
