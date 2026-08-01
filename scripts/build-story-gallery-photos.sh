#!/usr/bin/env bash
#
# Generate web-ready gallery assets from the couple's personal photos.
#
# Photos are ordered by EXIF DateTimeOriginal and receive an opaque, stable slug
# derived from the source file's SHA-256 digest:
#
#   story-<digest>-480.avif
#   story-<digest>-960.avif
#   story-<digest>-lg.avif
#   story-<digest>-1024.jpg
#
# The digest keeps exact capture times out of public asset URLs while remaining
# stable if an earlier photo is added to the collection later.
#
# The resize ladder and quality settings match build-gallery-photos.sh. Every
# output is auto-oriented and stripped of EXIF, GPS, and other source metadata.
# ImageMagick reads the JPEG and HEIC sources directly. macOS sips renders DNG
# sources to a temporary TIFF because ImageMagick's default installation cannot
# decode camera RAW files.
#
# Usage:
#   scripts/build-story-gallery-photos.sh <source-dir>
#
# The source directory is treated as the curated set. Every supported image in
# it must contain DateTimeOriginal, and capture timestamps must be unique. Keep
# the resulting timestamp order in sync with GALLERY_MANIFEST in
# app/components/pages/photos-content.ts.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <source-dir>" >&2
  exit 1
fi

for command in magick exiftool shasum; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ERROR: required command not found: $command" >&2
    exit 1
  fi
done

SRC_DIR="$1"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${REPO_ROOT}/app/assets/gallery"
TMP_DIR="$(mktemp -d)"
ORDER_FILE="${TMP_DIR}/photos.tsv"
trap 'rm -rf "$TMP_DIR"' EXIT

if [[ ! -d "$SRC_DIR" ]]; then
  echo "ERROR: source directory does not exist: $SRC_DIR" >&2
  exit 1
fi

# Build a sortable capture-time inventory. One exiftool call per source keeps
# filenames with spaces intact without relying on non-portable shell features.
find "$SRC_DIR" -maxdepth 1 -type f \( \
  -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.heic' -o -iname '*.dng' \
\) -print0 | while IFS= read -r -d '' src; do
  captured_at="$(exiftool -d '%Y%m%d-%H%M%S' -DateTimeOriginal -s3 "$src")"
  if [[ -z "$captured_at" ]]; then
    echo "ERROR: missing EXIF DateTimeOriginal: $src" >&2
    exit 1
  fi
  digest="$(shasum -a 256 "$src" | awk '{ print substr($1, 1, 12) }')"
  printf '%s\tstory-%s\t%s\n' "$captured_at" "$digest" "$src"
done | sort > "$ORDER_FILE"

photo_count="$(wc -l < "$ORDER_FILE" | tr -d ' ')"
if [[ "$photo_count" -eq 0 ]]; then
  echo "ERROR: no supported photos found in $SRC_DIR" >&2
  exit 1
fi

# A duplicate timestamp would make capture order ambiguous, while a duplicate
# digest means the same source content was included twice. Reject both.
if cut -f1 "$ORDER_FILE" | uniq -d | grep -q .; then
  echo "ERROR: capture timestamps must be unique:" >&2
  cut -f1 "$ORDER_FILE" | uniq -d >&2
  exit 1
fi
if cut -f2 "$ORDER_FILE" | sort | uniq -d | grep -q .; then
  echo "ERROR: duplicate source content found:" >&2
  cut -f2 "$ORDER_FILE" | sort | uniq -d >&2
  exit 1
fi

if grep -qi '\.dng$' "$ORDER_FILE" && ! command -v sips >/dev/null 2>&1; then
  echo "ERROR: sips is required to render DNG sources" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
rm -f "${OUT_DIR}"/story-*.avif "${OUT_DIR}"/story-*.jpg

process_one() {
  local slug="$1"
  local src="$2"
  local render_src="$src"

  if [[ "${src##*.}" =~ ^([dD][nN][gG])$ ]]; then
    render_src="${TMP_DIR}/${slug}.tiff"
    sips -s format tiff "$src" --out "$render_src" >/dev/null
  fi

  magick "$render_src" -auto-orient -strip -resize 480x \
    -quality 50 "${OUT_DIR}/${slug}-480.avif"
  magick "$render_src" -auto-orient -strip -resize 960x \
    -quality 54 "${OUT_DIR}/${slug}-960.avif"
  magick "$render_src" -auto-orient -strip -resize '2048x2048>' \
    -quality 58 "${OUT_DIR}/${slug}-lg.avif"
  magick "$render_src" -auto-orient -strip -resize 1024x \
    -quality 80 -interlace JPEG "${OUT_DIR}/${slug}-1024.jpg"
  echo "  done $slug"
}

echo "Encoding ${photo_count} photos from ${SRC_DIR} into ${OUT_DIR} ..."

# Wait on every PID individually so an encoder failure cannot be hidden by a
# later successful job in the same batch. This works with macOS's Bash 3.2.
wait_for_batch() {
  local pid
  local failed=0
  for pid in "${pids[@]}"; do
    if ! wait "$pid"; then
      failed=1
    fi
  done
  pids=()
  if (( failed != 0 )); then
    echo "ERROR: one or more photo encoders failed" >&2
    return 1
  fi
}

max_jobs=6
pids=()
while IFS=$'\t' read -r captured_at slug src; do
  process_one "$slug" "$src" &
  pids+=("$!")
  if (( ${#pids[@]} == max_jobs )); then
    wait_for_batch
  fi
done < "$ORDER_FILE"
if (( ${#pids[@]} > 0 )); then
  wait_for_batch
fi

expected=$(( photo_count * 4 ))
actual="$(find "$OUT_DIR" -maxdepth 1 \( \
  -name 'story-*.avif' -o -name 'story-*.jpg' \
\) | wc -l | tr -d ' ')"
echo "Wrote ${actual} of ${expected} expected files to ${OUT_DIR}."
if [[ "$actual" -ne "$expected" ]]; then
  echo "ERROR: expected ${expected} files (4 per photo); something failed." >&2
  exit 1
fi

echo "Capture order (copy the slugs to GALLERY_MANIFEST):"
awk -F '\t' '{ print "  " $1 "  " $2 }' "$ORDER_FILE"
echo "Done."
