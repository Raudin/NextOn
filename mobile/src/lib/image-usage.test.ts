import fs from "fs";
import path from "path";

/**
 * Structural invariants for artwork.
 *
 * The 88 MB image cache came from a convention, not a bug in one place: every
 * poster in the app asked TMDB for `w500` regardless of how large it was drawn.
 * Nothing in the type system stops someone adding another one, so these checks
 * fail the build if a new call site drops the role argument or renders an image
 * without an explicit cache policy.
 *
 * A source-scanning test is unusual. It is the right tool here because the
 * invariant is about *every* call site, including ones that do not exist yet,
 * and there is no component-level test that would cover an image added next
 * month.
 */

const SRC_ROOT = path.resolve(__dirname, "..");

const listSourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
};

const relative = (file: string) => path.relative(SRC_ROOT, file);

describe("image invariants", () => {
  const files = listSourceFiles(SRC_ROOT);

  it("finds source files to check", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("always passes an explicit role to imageUrl", () => {
    // `lib/images.ts` is where the role is applied, so it is the one place the
    // call legitimately omits it.
    const offenders: string[] = [];

    for (const file of files) {
      if (file.endsWith(path.join("lib", "images.ts"))) continue;

      const text = fs.readFileSync(file, "utf8");
      const pattern = /imageUrl\(([^)]*)\)/g;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(text)) !== null) {
        const args = match[1];
        if (!args.includes(",")) {
          const line = text.slice(0, match.index).split("\n").length;
          offenders.push(`${relative(file)}:${line}: imageUrl(${args})`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("always sets an explicit cachePolicy on remotely-sourced images", () => {
    // Omitting it falls back to memory-disk, which is what let a full-bleed
    // backdrop — the largest file the app downloads — sit on disk forever.
    //
    // Only images with a `uri:` source are checked: a local `require(...)` is
    // bundled with the app, so it is never downloaded and a cache policy means
    // nothing for it.
    const offenders: string[] = [];

    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      // `(?=[\s/>])` keeps generic type parameters and prose like `<ImageRole>`
      // from matching.
      const pattern = /<Image(?=[\s/>])/g;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(text)) !== null) {
        const end = text.indexOf("/>", match.index);
        const tag = end === -1 ? text.slice(match.index) : text.slice(match.index, end);

        if (tag.includes("uri:") && !tag.includes("cachePolicy")) {
          const line = text.slice(0, match.index).split("\n").length;
          offenders.push(`${relative(file)}:${line}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("always gives list images a recyclingKey", () => {
    // Without one, a recycled cell can briefly show the previous item's
    // artwork — the standard recycled-list artifact.
    const offenders: string[] = [];
    const listComponents = [
      path.join("components", "Discover", "MediaCard.tsx"),
      path.join("components", "Watchlist", "WatchlistPosterCard.tsx"),
      path.join("components", "Watchlist", "WatchlistRow.tsx"),
      path.join("components", "Watchlist", "NextEpisodeCard.tsx"),
      path.join("components", "Home", "ScheduleSections.tsx"),
    ];

    for (const relativePath of listComponents) {
      const full = path.join(SRC_ROOT, relativePath);
      if (!fs.existsSync(full)) continue;

      const text = fs.readFileSync(full, "utf8");
      if (!text.includes("<Image")) continue;
      if (!text.includes("recyclingKey")) {
        offenders.push(relativePath);
      }
    }

    expect(offenders).toEqual([]);
  });
});
