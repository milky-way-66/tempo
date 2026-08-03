#!/usr/bin/env node
// Regenerate CHANGELOG.md from git tags + commits. No dependencies.
//
// Sections, newest first: the version in package.json (from the latest tag to
// HEAD — the release in progress), then one section per existing `vX.Y.Z` tag
// (from the previous tag to that tag). `release:` version-bump commits are
// filtered out. Idempotent: safe to run repeatedly.
//
// Run standalone with `npm run changelog`, or automatically during `npm version`
// (the deploy flow) via the "version" lifecycle script, which stages the result
// into the release commit.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEP = "";

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function pkgVersion() {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
}

/** Existing version tags, newest first. */
function tags() {
  const out = git(["tag", "--list", "v*", "--sort=-v:refname"]);
  return out ? out.split("\n").filter(Boolean) : [];
}

/** Commits in (from, to], excluding merges and `release:` bumps. */
function commits(from, to) {
  const range = from ? `${from}..${to}` : to;
  let raw = "";
  try {
    raw = git(["log", "--no-merges", `--pretty=format:%s${SEP}%h`, range]);
  } catch {
    return [];
  }
  if (!raw) return [];
  return raw
    .split("\n")
    .map((line) => {
      const [subject, hash] = line.split(SEP);
      return { subject, hash };
    })
    .filter((c) => c.subject && !/^release:/i.test(c.subject));
}

function dateOf(ref) {
  try {
    return git(["log", "-1", "--format=%ad", "--date=short", ref]);
  } catch {
    return "";
  }
}

function section(heading, date, list) {
  const out = [`## ${heading}${date ? ` — ${date}` : ""}`, ""];
  if (list.length === 0) out.push("_No notable changes._");
  else for (const c of list) out.push(`- ${c.subject} (${c.hash})`);
  out.push("");
  return out.join("\n");
}

function build() {
  const version = pkgVersion();
  const tagList = tags();
  const latestTag = tagList[0] ?? null;
  const latestTagVersion = latestTag ? latestTag.replace(/^v/, "") : null;

  const sections = [];

  // The release in progress: commits after the latest tag, filed under the
  // current package version (which the deploy flow has already bumped).
  const pending = commits(latestTag, "HEAD");
  if (version !== latestTagVersion && pending.length) {
    sections.push(section(version, dateOf("HEAD"), pending));
  }

  // One section per released tag.
  for (let i = 0; i < tagList.length; i++) {
    const tag = tagList[i];
    const prev = tagList[i + 1] ?? null;
    sections.push(section(tag.replace(/^v/, ""), dateOf(tag), commits(prev, tag)));
  }

  if (sections.length === 0) sections.push(section(version, dateOf("HEAD"), []));

  const body =
    ["# Changelog", "", "All notable changes to Tempo, newest first.", "", ...sections]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n";

  writeFileSync(join(root, "CHANGELOG.md"), body, "utf8");
  const unreleased = version !== latestTagVersion && pending.length ? ` + ${version} (pending)` : "";
  process.stdout.write(`Wrote CHANGELOG.md — ${tagList.length} released${unreleased}\n`);
}

build();
