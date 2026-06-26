import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

// Guards the hand-maintained asset references in index.html and manifest.json
// against the files actually committed under public/. These are plain string
// URLs, so a rename or typo would not fail typechecking. Worse, in production
// the Go static server falls back to the index.html shell with a 200 (not a
// 404) for any missing root path, so a broken og:image or PWA icon would ship
// green: scrapers and launchers would silently receive HTML instead of the
// asset. This test is the safety net, mirroring the Photos manifest-drift guard.

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const CANONICAL_HOST = "https://www.robinandmadeline.com";

/** Resolves a referenced URL to its path under public/, or null if it is not a
 * local public/ asset (e.g. the /app entry bundle or an external font). */
function publicAsset(url: string): string | null {
  const local = url.startsWith(CANONICAL_HOST)
    ? url.slice(CANONICAL_HOST.length)
    : url;
  if (!local.startsWith("/") || local.startsWith("/app/")) return null;
  return path.join(repoRoot, "public", local);
}

describe("meta assets", () => {
  it("manifest icons reference committed public/ files", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, "public/manifest.json"), "utf8"),
    );
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(
        existsSync(path.join(repoRoot, "public", icon.src)),
        icon.src,
      ).toBe(true);
    }
  });

  it("index.html asset references resolve to committed public/ files", () => {
    const html = readFileSync(path.join(repoRoot, "index.html"), "utf8");
    const refs = [
      ...html.matchAll(
        /(?:href|content)="([^"]+\.(?:png|jpe?g|ico|svg|webmanifest|json))"/g,
      ),
    ]
      .map((m) => publicAsset(m[1]))
      .filter((p): p is string => p !== null);

    expect(refs.length).toBeGreaterThan(0);
    for (const ref of new Set(refs)) {
      expect(existsSync(ref), ref).toBe(true);
    }
  });
});
