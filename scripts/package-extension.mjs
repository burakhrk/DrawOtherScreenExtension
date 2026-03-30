import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const artifactsDir = path.join(rootDir, "artifacts");

const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
const version = packageJson.version || "0.0.0";
const zipPath = path.join(artifactsDir, `sketch-party-extension-v${version}.zip`);

await mkdir(artifactsDir, { recursive: true });
await rm(zipPath, { force: true });

const command = `Compress-Archive -Path '${distDir}\\*' -DestinationPath '${zipPath}' -Force`;
const result = spawnSync("powershell", ["-NoProfile", "-Command", command], {
  cwd: rootDir,
  stdio: "inherit",
});

if (result.status !== 0) {
  throw new Error(`Zip packaging failed with exit code ${result.status ?? "unknown"}.`);
}

console.log(`Created ${zipPath}`);
