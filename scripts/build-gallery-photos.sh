#!/usr/bin/env bash
#
# Generate web-ready gallery assets for the public Photos page.
#
# The photographer's originals are ~4-6 MB SONY JPEGs (4000x6000 / 6000x4000)
# carrying full EXIF (camera, timestamps, and potentially GPS). This script turns
# each curated original into a small, metadata-stripped responsive ladder that
# Vite fingerprints and the gallery references via srcset:
#
#   mr-<n>-480.avif   q50  grid thumbnail (mobile / dense columns)
#   mr-<n>-960.avif   q54  grid thumbnail (retina / wide columns)
#   mr-<n>-lg.avif    q58  full-screen lightbox view (long edge capped at 2048)
#   mr-<n>-1024.jpg   q80  fallback for browsers without AVIF (<5%)
#
# The large tier caps the LONG edge at 2048 rather than the width: a portrait
# lightbox is height-constrained, so a 2048-wide (=3072-tall) portrait is wasted
# pixels the browser only downscales. Capping the long edge yields 1365x2048 for
# portraits (half the bytes) while landscapes stay 2048x1365.
#
# AVIF + a JPEG fallback covers every browser (AVIF: Chrome 85+, Firefox 93+,
# Safari 16.4+; the JPEG catches the rest), so we skip WebP to keep the committed
# weight to ~17 MB across all 34 photos. `-auto-orient` bakes any EXIF rotation
# into the pixels and `-strip` removes all remaining metadata.
#
# Usage:
#   scripts/build-gallery-photos.sh <source-dir>
#
# where <source-dir> holds the originals named "M&R-<n>.jpg". The curated set and
# its display order live in CURATED below; keep it in sync with the order in
# app/components/pages/photos-content.ts.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <source-dir>" >&2
  exit 1
fi

SRC_DIR="$1"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${REPO_ROOT}/app/assets/gallery"

# Curated photos, in display order. Edit this list (and photos-content.ts) to
# change which photos appear or in what order.
CURATED=(
  8 9 10 11 19 25 34 40 41 43 47 49 50 53 57 59 60 62 90 91 92 94 95 96
  100 101 103 105 107 108 109 113 114 115
)

mkdir -p "$OUT_DIR"

# Clear prior outputs so a re-run is reproducible: no orphaned assets linger from
# a since-removed slug, and the final file-count check reflects only this run.
# `-f` ignores the no-match case (the glob stays literal when the dir is empty).
rm -f "${OUT_DIR}"/mr-*.avif "${OUT_DIR}"/mr-*.jpg

# Encode one original into the full ladder. Backgrounded per photo below.
process_one() {
  local n="$1"
  local src="${SRC_DIR}/M&R-${n}.jpg"
  local slug="mr-${n}"

  if [[ ! -f "$src" ]]; then
    echo "  WARN: missing $src, skipping" >&2
    return
  fi

  magick "$src" -auto-orient -strip -resize 480x       -quality 50 "${OUT_DIR}/${slug}-480.avif"
  magick "$src" -auto-orient -strip -resize 960x       -quality 54 "${OUT_DIR}/${slug}-960.avif"
  magick "$src" -auto-orient -strip -resize '2048x2048>' -quality 58 "${OUT_DIR}/${slug}-lg.avif"
  magick "$src" -auto-orient -strip -resize 1024x      -quality 80 -interlace JPEG "${OUT_DIR}/${slug}-1024.jpg"
  echo "  done mr-${n}"
}

echo "Encoding ${#CURATED[@]} photos from ${SRC_DIR} into ${OUT_DIR} ..."

# Process in fixed-size batches so the run finishes quickly without spawning all
# 34 magick pipelines (x4 each) at once. Plain `wait` (not `wait -n`) keeps this
# portable to the bash 3.2 that ships with macOS.
max_jobs=6
i=0
for n in "${CURATED[@]}"; do
  process_one "$n" &
  i=$((i + 1))
  if (( i % max_jobs == 0 )); then wait; fi
done
wait

# Plain `wait` does not propagate the backgrounded jobs' exit codes, so verify
# the run produced every expected file (4 per photo) rather than trusting that
# none of the magick pipelines failed silently.
expected=$(( ${#CURATED[@]} * 4 ))
# `find` (not a glob) so the count ignores stray files like .DS_Store and does
# not trip pipefail when a pattern matches nothing.
actual=$(find "${OUT_DIR}" -maxdepth 1 \( -name 'mr-*.avif' -o -name 'mr-*.jpg' \) | wc -l | tr -d ' ')
echo "Wrote ${actual} of ${expected} expected files to ${OUT_DIR}."
if [[ "$actual" -ne "$expected" ]]; then
  echo "ERROR: expected ${expected} files (4 per photo); something failed." >&2
  exit 1
fi
echo "Done."
