import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

async function copyIfExists(relativePath) {
  const sourcePath = path.join(rootDir, relativePath);
  const targetPath = path.join(distDir, relativePath);
  await cp(sourcePath, targetPath, { recursive: true });
}

async function build() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  const manifestPath = path.join(rootDir, "manifest.json");
  const manifestText = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);

  // Keep the packaged extension scoped to only the files Chrome actually needs.
  await writeFile(path.join(distDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await copyIfExists("src");
  await copyIfExists("public");
}

await build();
