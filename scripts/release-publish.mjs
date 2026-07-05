#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = path.join(repoRoot, "packages");
const dependencyFields = ["dependencies", "peerDependencies", "optionalDependencies"];

function parseArgs(argv) {
  const args = { dryRun: false, tag: "latest", skipRegistry: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--skip-registry") {
      args.skipRegistry = true;
    } else if (arg === "--tag") {
      args.tag = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown release-publish argument "${arg}".`);
    }
  }
  return args;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function loadPackages() {
  const packageDirs = await readdir(packagesRoot, { withFileTypes: true });
  const packages = [];

  for (const entry of packageDirs) {
    if (!entry.isDirectory()) continue;

    const dir = path.join("packages", entry.name);
    const manifestPath = path.join(repoRoot, dir, "package.json");
    if (!existsSync(manifestPath)) continue;

    const manifest = await readJson(manifestPath);
    if (manifest.private) continue;

    packages.push({ dir, manifest, name: manifest.name, version: manifest.version, deps: [] });
  }

  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  for (const pkg of packages) {
    const deps = new Set();
    for (const field of dependencyFields) {
      for (const depName of Object.keys(pkg.manifest[field] ?? {})) {
        if (byName.has(depName)) deps.add(depName);
      }
    }
    pkg.deps = [...deps].sort((a, b) => a.localeCompare(b));
  }

  return packages;
}

function sortTopologically(packages) {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const visited = new Set();
  const sorted = [];

  function visit(name) {
    if (visited.has(name)) return;
    visited.add(name);

    const pkg = byName.get(name);
    if (!pkg) return;

    for (const dep of pkg.deps) visit(dep);
    sorted.push(pkg);
  }

  for (const pkg of [...packages].sort((a, b) => a.name.localeCompare(b.name))) {
    visit(pkg.name);
  }

  return sorted;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });

  if (result.error) throw result.error;
  return result;
}

function isAlreadyPublished(pkg) {
  const result = run("npm", ["view", `${pkg.name}@${pkg.version}`, "version"]);
  return result.status === 0 && result.stdout.trim() === pkg.version;
}

function publishPackage(pkg, options) {
  const args = [
    "--filter",
    pkg.name,
    "publish",
    "--access",
    "public",
    "--tag",
    options.tag,
    "--no-git-checks",
  ];

  if (options.dryRun) args.push("--dry-run");

  const result = run("pnpm", args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`Failed to publish ${pkg.name}@${pkg.version}.`);
  }
}

const options = parseArgs(process.argv.slice(2));
const packages = sortTopologically(await loadPackages());
const pending = [];

for (const pkg of packages) {
  if (!options.skipRegistry && isAlreadyPublished(pkg)) {
    process.stdout.write(`skip ${pkg.name}@${pkg.version}: already published\n`);
    continue;
  }

  pending.push(pkg);
}

if (pending.length === 0) {
  process.stdout.write("No unpublished package versions found.\n");
  process.exit(0);
}

process.stdout.write(
  [
    `Publishing ${pending.length} package(s) with dist-tag "${options.tag}"${options.dryRun ? " (dry-run)" : ""}:`,
    ...pending.map((pkg) => `- ${pkg.name}@${pkg.version}`),
    "",
  ].join("\n"),
);

for (const pkg of pending) {
  publishPackage(pkg, options);
}
