#!/usr/bin/env node
import { Command } from "commander";
import sharp from "sharp";
import fg from "fast-glob";
import pLimit from "p-limit";
import cliProgress from "cli-progress";
import pc from "picocolors";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { optimize as optimizeSvg, type Config } from "svgo";

const program = new Command();

program
  .name("minyimg")
  .description("Lightning fast lossless and smart-lossy image compression CLI")
  .version("1.0.0")
  .requiredOption("-p, --path <dir>", "Path to the folder containing images")
  .option(
    "-o, --out <dir>",
    "Output folder (defaults to overwriting original files)",
  )
  .parse(process.argv);

const options = program.opts();

async function processSvg(
  imagePath: string,
  outputPath: string,
  originalSize: number,
  hasOutDir: boolean,
): Promise<number> {
  const svgString = await fs.readFile(imagePath, "utf-8");

  const svgoConfig: Config = {
    path: imagePath,
    multipass: true,
    plugins: ["preset-default"],
  };

  const result = optimizeSvg(svgString, svgoConfig);
  const resultSize = Buffer.byteLength(result.data, "utf8");

  if (resultSize < originalSize) {
    await fs.writeFile(outputPath, result.data);
    return resultSize;
  } else {
    if (hasOutDir && imagePath !== outputPath) {
      await fs.copyFile(imagePath, outputPath);
    }
    return originalSize; // Bailout: Kept original
  }
}

async function processRaster(
  imagePath: string,
  outputPath: string,
  originalSize: number,
  ext: string,
  hasOutDir: boolean,
): Promise<number> {
  const imageBuffer = await fs.readFile(imagePath);
  let sharpInstance = sharp(imageBuffer, { animated: ext === ".gif" });

  if (ext === ".png") {
    sharpInstance = sharpInstance.png({ compressionLevel: 9, effort: 10 });
  } else if (ext === ".jpg" || ext === ".jpeg") {
    sharpInstance = sharpInstance.jpeg({ mozjpeg: true, quality: 80 });
  } else if (ext === ".webp") {
    sharpInstance = sharpInstance.webp({ quality: 85, effort: 6 });
  } else if (ext === ".gif") {
    sharpInstance = sharpInstance.gif({
      reuse: false,
      colors: 128,
      dither: 0.5,
      effort: 7,
    });
  }

  const outputBuffer = await sharpInstance.toBuffer();

  if (outputBuffer.length < originalSize) {
    await fs.writeFile(outputPath, outputBuffer);
    return outputBuffer.length;
  } else {
    if (hasOutDir && imagePath !== outputPath) {
      await fs.copyFile(imagePath, outputPath);
    }
    return originalSize;
  }
}

async function optimizeImages() {
  const targetDir = path.resolve(process.cwd(), options.path);
  const outDir = options.out
    ? path.resolve(process.cwd(), options.out)
    : targetDir;

  console.log(pc.cyan(`\n🔍 Scanning directory: ${targetDir}`));

  try {
    await fs.access(targetDir);
  } catch {
    console.error(
      pc.red(`❌ Error: The directory "${targetDir}" does not exist.`),
    );
    process.exit(1);
  }

  const images = await fg(["**/*.{jpg,jpeg,png,webp,gif,svg}"], {
    cwd: targetDir,
    absolute: true,
    caseSensitiveMatch: false,
  });

  if (images.length === 0) {
    console.log(pc.yellow("⚠️  No images found in the specified directory."));
    return;
  }

  console.log(
    pc.green(`Found ${images.length} images. Starting compression...\n`),
  );

  const cpuCores = os.cpus().length;
  const limit = pLimit(cpuCores);

  const progressBar = new cliProgress.SingleBar({
    format:
      "Progress |" +
      pc.cyan("{bar}") +
      "| {percentage}% || {value}/{total} Images || Current: {file}",
    barCompleteChar: "\u2588",
    barIncompleteChar: "\u2591",
    hideCursor: true,
  });

  progressBar.start(images.length, 0, { file: "Initializing..." });

  let totalOriginalSize = 0;
  let totalOptimizedSize = 0;

  // Array to collect files that threw errors (e.g., corrupted images)
  const failedFiles: { file: string; reason: string }[] = [];

  // 3. Processing Queue
  const tasks = images.map((imagePath) =>
    limit(async () => {
      const filename = path.basename(imagePath);

      try {
        const stats = await fs.stat(imagePath);
        totalOriginalSize += stats.size;
        const ext = path.extname(filename).toLowerCase();

        const relativePath = path.relative(targetDir, imagePath);
        const outputPath = options.out
          ? path.join(outDir, relativePath)
          : imagePath;

        if (options.out) {
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
        }

        let finalSize = 0;
        if (ext === ".svg") {
          finalSize = await processSvg(
            imagePath,
            outputPath,
            stats.size,
            !!options.out,
          );
        } else {
          finalSize = await processRaster(
            imagePath,
            outputPath,
            stats.size,
            ext,
            !!options.out,
          );
        }

        totalOptimizedSize += finalSize;
        progressBar.increment({ file: filename });
      } catch (error: any) {
        failedFiles.push({
          file: filename,
          reason: error.message || "Unknown error",
        });
        progressBar.increment({ file: `Failed: ${filename}` });
      }
    }),
  );

  await Promise.all(tasks);
  progressBar.stop();

  const savedBytes = totalOriginalSize - totalOptimizedSize;
  const savedMb = (savedBytes / (1024 * 1024)).toFixed(2);
  const percentage =
    totalOriginalSize > 0
      ? ((savedBytes / totalOriginalSize) * 100).toFixed(1)
      : "0.0";

  console.log(pc.green(`\n✅ Compression Complete!`));
  console.log(
    pc.cyan(`📉 Reduced total size by ${savedMb} MB (${percentage}%)`),
  );

  // Print Error Report if any files failed
  if (failedFiles.length > 0) {
    console.log(
      pc.yellow(`\n⚠️  Completed with ${failedFiles.length} error(s):`),
    );
    failedFiles.forEach((err) => {
      console.log(pc.red(`   - ${err.file}: `) + pc.gray(err.reason));
    });
    process.exit(1);
  }
}

optimizeImages().catch((err) => {
  console.error(pc.red("\n❌ An unexpected fatal error occurred:"), err);
  process.exit(1);
});
