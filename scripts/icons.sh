#!/usr/bin/env bash
# Make the raster icons from the mark in apps/web/app/icon.svg (the paths in apps/web/lib/brand.tsx):
#   app/favicon.ico          16, 32 and 48 px, for browsers that ask for /favicon.ico
#   app/apple-icon.png       180 px, full-bleed (iOS rounds the corners itself)
#   public/icon-192.png, public/icon-512.png       the rounded tile, for the web app manifest
#   public/icon-maskable-512.png                   full-bleed with the glyph inside the safe zone (Android masks)
# Needs rsvg-convert and ImageMagick: brew install librsvg imagemagick. Run after changing the mark.
set -euo pipefail
cd "$(dirname "$0")/../apps/web"
command -v rsvg-convert > /dev/null || { echo "rsvg-convert is needed: brew install librsvg" >&2; exit 1; }
command -v magick > /dev/null || { echo "ImageMagick is needed: brew install imagemagick" >&2; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
src=app/icon.svg
paths=$(grep -o '<path [^>]*/>' "$src" | tr -d '\n')
tile=$(grep -o '<rect [^>]*fill="#[0-9a-fA-F]*"' "$src" | grep -o '#[0-9a-fA-F]*')

# Full-bleed square, the glyph (centred on 32, 29.5) scaled about the middle.
bleed() { printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="%s"/><g transform="translate(32 32) scale(%s) translate(-32 -29.5)">%s</g></svg>' "$tile" "$1" "$paths"; }

for s in 16 32 48; do rsvg-convert -w $s -h $s "$src" -o "$tmp/$s.png"; done
magick "$tmp/16.png" "$tmp/32.png" "$tmp/48.png" app/favicon.ico

bleed 0.8 > "$tmp/apple.svg"
rsvg-convert -w 180 -h 180 "$tmp/apple.svg" -o app/apple-icon.png

rsvg-convert -w 192 -h 192 "$src" -o public/icon-192.png
rsvg-convert -w 512 -h 512 "$src" -o public/icon-512.png
bleed 0.66 > "$tmp/maskable.svg"
rsvg-convert -w 512 -h 512 "$tmp/maskable.svg" -o public/icon-maskable-512.png

ls -l app/favicon.ico app/apple-icon.png public/icon-192.png public/icon-512.png public/icon-maskable-512.png | awk '{print $5, $9}'
