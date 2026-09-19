import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareDesktop, defaultRoot, defaultOutputDir } from "../scripts/prepare-desktop.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const tempBase = path.join(repoRoot, ".sciencescope-local", "temp");

async function makeTemp(prefix) {
  await mkdir(tempBase, { recursive: true });
  return await mkdtemp(path.join(tempBase, prefix + "-"));
}

test("copies ScienceScope.html bytes unchanged including UTF8", async () => {
  const dir = await makeTemp("prepare-ok");
  try {
    const root = path.join(dir, "root");
    const out = path.join(dir, "out", "nested");
    await mkdir(root, { recursive: true });
    const content = "<!doctype html><html><body>hello \u4e2d\u6587 \u{1F525} caf\u00e9</body></html>";
    await writeFile(path.join(root, "ScienceScope.html"), content, "utf8");
    const result = await prepareDesktop({ root, outputDir: out });
    const expected = await readFile(path.join(root, "ScienceScope.html"));
    const actual = await readFile(path.join(out, "index.html"));
    assert.deepEqual(actual, expected);
    assert.equal(actual.toString("utf8"), content);
    assert.equal(result.bytes, expected.length);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing source fails and creates no placeholder", async () => {
  const dir = await makeTemp("prepare-missing");
  try {
    const root = path.join(dir, "empty-root");
    await mkdir(root, { recursive: true });
    const out = path.join(dir, "should-not-exist");
    await assert.rejects(() => prepareDesktop({ root, outputDir: out }));
    await assert.rejects(() => stat(path.join(out, "index.html")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("defaults resolve under repository root", () => {
  assert.equal(defaultRoot, repoRoot);
  assert.equal(defaultOutputDir, path.join(repoRoot, ".sciencescope-local", "desktop-dist"));
});

test("temp base stays inside repository", () => {
  assert.equal(path.relative(repoRoot, tempBase), path.join(".sciencescope-local", "temp"));
});

test("custom root owns its default output directory", async () => {
  const root = await makeTemp("prepare-custom");
  try {
    await writeFile(path.join(root, "ScienceScope.html"), "approved prototype");
    const result = await prepareDesktop({ root });
    assert.equal(result.output, path.join(root, ".sciencescope-local", "desktop-dist", "index.html"));
    assert.equal(await readFile(result.output, "utf8"), "approved prototype");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
