# ImgMinify CLI ⚡️

A lightning-fast, highly concurrent CLI tool to losslessly compress images (JPG, PNG, WebP, GIF, SVG). Powered by `sharp` and `svgo`.

## Features

- **Smart Compression:** Auto-detects optimal settings for JPEGs, PNGs, and GIFs.
- **WebP Optimization:** Converts WebP images using high-quality lossy compression.
- **SVG Parsing:** Minifies vector graphics safely using SVGO.
- **Safety Bailout:** Never inflates file sizes. If an optimized image is larger than the original, it intelligently keeps the original.
- **Directory Replication:** Mirrors your complex nested folder structures in the output directory.

## Usage

You can run this tool instantly without installing it globally using `npx` or `bunx`.

```bash
npx minyimg --path ./public/images
```
