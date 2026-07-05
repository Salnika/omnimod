#!/usr/bin/env node

import { access, lstat, mkdir, readlink, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliEntryPath = path.join(repoRoot, "packages", "cli", "dist", "index.mjs");
const linkName = "omnimod";

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function getPathEntries() {
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
}

function resolveInstallDirectory() {
  const overrideDirectory = process.env.OMNIMOD_LOCAL_BIN_DIR?.trim();
  if (overrideDirectory) {
    return path.resolve(overrideDirectory);
  }

  const homeDirectory = os.homedir();
  const preferredDirectories = [
    path.join(homeDirectory, ".local", "bin"),
    path.join(homeDirectory, "bin"),
    path.join(homeDirectory, "Library", "pnpm", "bin"),
  ];
  const pathEntries = new Set(getPathEntries());

  for (const candidateDirectory of preferredDirectories) {
    if (pathEntries.has(path.resolve(candidateDirectory))) {
      return candidateDirectory;
    }
  }

  throw new Error(
    [
      "Could not find a supported local bin directory in PATH.",
      "Add ~/.local/bin to PATH or rerun with OMNIMOD_LOCAL_BIN_DIR=/absolute/bin/dir.",
    ].join(" "),
  );
}

async function removeExistingLink(targetPath) {
  try {
    const stats = await lstat(targetPath);
    if (stats.isDirectory() && !stats.isSymbolicLink()) {
      throw new Error(`Refusing to replace directory at "${targetPath}".`);
    }

    await rm(targetPath, { force: true, recursive: true });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return;
    }

    throw error;
  }
}

async function main() {
  if (!(await pathExists(cliEntryPath))) {
    throw new Error(
      `Could not find the built omnimod CLI entry at "${cliEntryPath}". Run "vp run -r build" first.`,
    );
  }

  const installDirectory = resolveInstallDirectory();
  const targetPath = path.join(installDirectory, linkName);

  await mkdir(installDirectory, { recursive: true });
  await removeExistingLink(targetPath);
  await symlink(cliEntryPath, targetPath);

  const linkedPath = await readlink(targetPath);

  process.stdout.write(
    [
      `Installed ${linkName} -> ${linkedPath}`,
      `Bin dir: ${installDirectory}`,
      `Verify with: command -v ${linkName} && ${linkName} --help`,
      "",
    ].join("\n"),
  );
}

await main();
