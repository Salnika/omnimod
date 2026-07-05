#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = path.join(repoRoot, "packages");
const changesetRoot = path.join(repoRoot, ".changeset");
const releaseTypes = new Set(["patch", "minor", "major"]);
const bumpRank = { patch: 1, minor: 2, major: 3 };
const dependencyFields = ["dependencies", "peerDependencies", "optionalDependencies"];
const ignoredPackageChanges = [
  /(^|\/)dist\//,
  /(^|\/)tests?\//,
  /(^|\/)__fixtures__\//,
  /\.test\.[cm]?[jt]sx?$/,
  /(^|\/)README\.md$/,
  /(^|\/)CHANGELOG\.md$/,
];

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--since") {
      args.since = argv[index + 1];
      index += 1;
    } else {
      args._.push(arg);
    }
  }
  return args;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function mergeBump(current, next) {
  if (!current) return next;
  return bumpRank[next] > bumpRank[current] ? next : current;
}

function bumpVersion(version, type) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/.exec(version);
  if (!match) throw new Error(`Unsupported semver version "${version}".`);

  const [, majorText, minorText, patchText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);

  if (type === "major") return `${major + 1}.0.0`;
  if (type === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
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

    packages.push({ dir, manifest, manifestPath, name: manifest.name, deps: [] });
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

  return { packages, byName };
}

async function parseChangesets() {
  if (!existsSync(changesetRoot)) return { files: [], releases: new Map() };

  const entries = await readdir(changesetRoot, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
    .map((entry) => path.join(changesetRoot, entry.name))
    .sort();
  const releases = new Map();

  for (const file of files) {
    const content = await readFile(file, "utf8");
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(content)?.[1];
    if (!frontmatter) continue;

    for (const rawLine of frontmatter.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const quoted = /^["']([^"']+)["']:\s*(major|minor|patch|none)$/.exec(line);
      const bare = /^([^:]+):\s*(major|minor|patch|none)$/.exec(line);
      const name = quoted?.[1] ?? bare?.[1]?.trim();
      const type = quoted?.[2] ?? bare?.[2];

      if (!name || !type || !releaseTypes.has(type)) continue;
      releases.set(name, mergeBump(releases.get(name), type));
    }
  }

  return { files, releases };
}

function createReverseGraph(packages) {
  const reverse = new Map(packages.map((pkg) => [pkg.name, []]));

  for (const pkg of packages) {
    for (const dep of pkg.deps) {
      reverse.get(dep)?.push(pkg.name);
    }
  }

  for (const dependents of reverse.values()) dependents.sort();
  return reverse;
}

function collectDependents(packageName, reverseGraph) {
  const dependents = new Set();
  const queue = [...(reverseGraph.get(packageName) ?? [])];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || dependents.has(current)) continue;

    dependents.add(current);
    queue.push(...(reverseGraph.get(current) ?? []));
  }

  return dependents;
}

function sortTopologically(packages, selectedNames) {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const selected = new Set(selectedNames);
  const visited = new Set();
  const sorted = [];

  function visit(name) {
    if (visited.has(name)) return;
    visited.add(name);

    const pkg = byName.get(name);
    if (!pkg) return;

    for (const dep of pkg.deps) {
      if (selected.has(dep)) visit(dep);
    }

    sorted.push(name);
  }

  for (const name of [...selected].sort((a, b) => a.localeCompare(b))) visit(name);
  return sorted;
}

function createReleasePlan(packages, directReleases) {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const reverseGraph = createReverseGraph(packages);
  const releases = new Map();
  const reasons = new Map();

  for (const [name, type] of directReleases) {
    if (!byName.has(name)) {
      throw new Error(`Changeset references unknown package "${name}".`);
    }

    releases.set(name, mergeBump(releases.get(name), type));
    reasons.set(name, ["changeset"]);

    for (const dependent of collectDependents(name, reverseGraph)) {
      releases.set(dependent, mergeBump(releases.get(dependent), "patch"));
      const list = reasons.get(dependent) ?? [];
      list.push(`depends on ${name}`);
      reasons.set(dependent, list);
    }
  }

  const order = sortTopologically(packages, releases.keys());
  return order.map((name) => ({
    name,
    type: releases.get(name),
    reason: [...new Set(reasons.get(name) ?? [])],
    currentVersion: byName.get(name).manifest.version,
    nextVersion: bumpVersion(byName.get(name).manifest.version, releases.get(name)),
  }));
}

function formatPlan(plan) {
  if (plan.length === 0) return "No package releases planned.";

  return plan
    .map((release) => {
      const reason = release.reason.length > 0 ? ` (${release.reason.join(", ")})` : "";
      return `${release.name}: ${release.currentVersion} -> ${release.nextVersion} (${release.type})${reason}`;
    })
    .join("\n");
}

function gitChangedFiles(since) {
  const range = `${since}...HEAD`;
  return execFileSync("git", ["diff", "--name-only", range], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function isReleaseRelevantPackageFile(relativePath) {
  return !ignoredPackageChanges.some((pattern) => pattern.test(relativePath));
}

function getChangedPackages(packages, changedFiles) {
  const changedPackages = new Set();

  for (const file of changedFiles) {
    for (const pkg of packages) {
      const prefix = `${pkg.dir}/`;
      if (!file.startsWith(prefix)) continue;

      const relativePath = file.slice(prefix.length);
      if (isReleaseRelevantPackageFile(relativePath)) changedPackages.add(pkg.name);
    }
  }

  return [...changedPackages].sort((a, b) => a.localeCompare(b));
}

async function commandPlan() {
  const { packages } = await loadPackages();
  const changesets = await parseChangesets();
  const plan = createReleasePlan(packages, changesets.releases);
  process.stdout.write(`${formatPlan(plan)}\n`);
}

async function commandCheck(args) {
  const since = args.since ?? process.env.CHANGESET_BASE ?? "origin/master";
  const { packages } = await loadPackages();
  const changesets = await parseChangesets();
  const changedPackages = getChangedPackages(packages, gitChangedFiles(since));
  const missing = changedPackages.filter((name) => !changesets.releases.has(name));

  if (missing.length > 0) {
    process.stderr.write(
      [
        `Missing changesets for package changes since ${since}:`,
        ...missing.map((name) => `- ${name}`),
        "",
        "Run `pnpm changeset`, commit the generated .changeset/*.md file, then rerun this check.",
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const plan = createReleasePlan(packages, changesets.releases);
  process.stdout.write(
    [
      changedPackages.length > 0
        ? `Changeset coverage OK for: ${changedPackages.join(", ")}`
        : "No release-relevant package changes detected.",
      formatPlan(plan),
      "",
    ].join("\n"),
  );
}

async function commandApply() {
  const { packages, byName } = await loadPackages();
  const changesets = await parseChangesets();

  if (changesets.releases.size === 0) {
    throw new Error("No pending changesets. Run `pnpm changeset` before applying versions.");
  }

  const plan = createReleasePlan(packages, changesets.releases);
  for (const release of plan) {
    const pkg = byName.get(release.name);
    pkg.manifest.version = release.nextVersion;
    await writeJson(pkg.manifestPath, pkg.manifest);
  }

  for (const file of changesets.files) {
    await rm(file);
  }

  process.stdout.write(`${formatPlan(plan)}\n`);
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0] ?? "plan";

try {
  if (command === "plan") {
    await commandPlan();
  } else if (command === "check") {
    await commandCheck(args);
  } else if (command === "apply") {
    await commandApply();
  } else {
    throw new Error(`Unknown release-plan command "${command}".`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
