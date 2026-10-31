// Aggregate complete startup measurements. A later shutdown-verification failure
// stays explicitly flagged rather than deleting otherwise valid startup data.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { median } from './p5-font-summary.mjs';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    out: { type: 'string' },
  },
});
assert.ok(values.dir && values.out, 'Use --dir <matrix directory> --out <new JSON receipt>.');
const rows = [];
const samples = [];
const shutdownFailures = [];
for (const variant of ['A', 'B', 'C', 'D']) {
  for (const mode of ['cold', 'warm']) {
    const group = [];
    for (let repetition = 1; repetition <= 5; repetition++) {
      const folder = path.join(values.dir, variant + '-' + repetition);
      const restoration = JSON.parse(await readFile(path.join(folder, 'restored.json'), 'utf8'));
      assert.ok(restoration.restoredAt);
      const sample = JSON.parse(await readFile(path.join(folder, mode, 'sample.json'), 'utf8'));
      assert.equal(
        sample.error,
        undefined,
        'A failed startup measurement is not a zero or a substitute sample.',
      );
      assert.equal(sample.trace?.complete, true);
      assert.equal(sample.fontResources?.complete, true);
      assert.ok(Number.isFinite(sample.firstScreenFromSpawnMs));
      if (sample.shutdownError)
        shutdownFailures.push({
          variant,
          mode,
          repetition,
          error: sample.shutdownError,
          startedAt: sample.startedAt,
          finishedAt: sample.finishedAt,
        });
      else assert.equal(sample.complete, true);
      assert.equal(sample.variant, variant);
      assert.equal(sample.mode, mode);
      assert.equal(sample.repetition, repetition);
      assert.equal(sample.page.devicePixelRatio, 1.25);
      assert.equal(sample.page.nativeScaleFactor, 1.25);
      assert.equal(sample.page.resourceBufferOverflow, 0);
      if (mode === 'cold') assert.equal(sample.purge?.success, true);
      group.push(sample);
    }
    const med = (read) => {
      const value = median(group.map(read));
      assert.notEqual(value, null, 'A metric is missing or invalid in the planned five samples.');
      return value;
    };
    rows.push({
      variant,
      mode,
      n: group.length,
      firstScreenMs: med((sample) => sample.firstScreenFromSpawnMs),
      documentToRenderMs: med((sample) => sample.trace.documentToRenderMs),
      layoutMaxMs: med((sample) => sample.trace.updateLayoutTree.maxMs),
      layoutTotalMs: med((sample) => sample.trace.updateLayoutTree.totalMs),
      layoutEvents: med((sample) => sample.trace.updateLayoutTree.count),
      fontRequestsStartedByRender: med(
        (sample) => sample.fontResources.fonts.startedBeforeRender.count,
      ),
      fontRequestsCompletedByRender: med(
        (sample) => sample.fontResources.fonts.completedByRender.count,
      ),
      fontRequestsReady: med((sample) => sample.fontResources.fonts.allReady.count),
      fontTransferBytes: med((sample) => sample.fontResources.fonts.allReady.transferBytes),
      fontEncodedBytes: med((sample) => sample.fontResources.fonts.allReady.encodedBodyBytes),
      fontCacheHits: med((sample) => sample.fontResources.fonts.allReady.resourceTimingCacheHits),
      notoStylesheets: med((sample) => sample.fontResources.notoStylesheets.allReady.count),
      fontCollectionAfterRenderMs: med(
        (sample) => sample.page.capturedAtMs - sample.fontResources.renderAtMs,
      ),
      firstScreenRangeMs: [
        Math.min(...group.map((sample) => sample.firstScreenFromSpawnMs)),
        Math.max(...group.map((sample) => sample.firstScreenFromSpawnMs)),
      ],
    });
    samples.push(
      ...group.map((sample) => ({
        variant,
        mode,
        repetition: sample.repetition,
        firstScreenMs: sample.firstScreenFromSpawnMs,
        layoutMaxMs: sample.trace.updateLayoutTree.maxMs,
        layoutTotalMs: sample.trace.updateLayoutTree.totalMs,
        fontRequests: sample.fontResources.fonts.allReady.count,
        documentToRenderMs: sample.trace.documentToRenderMs,
        ...(mode === 'cold' ? { purge: sample.purge } : {}),
      })),
    );
  }
}
const result = {
  method:
    'Five planned samples per variant and mode; every sample used startup tracing and actual 125% scaling. Probe and screenshots excluded.',
  generatedAt: new Date().toISOString(),
  samples: samples.length,
  coldPurges: samples.filter((sample) => sample.purge).length,
  shutdownFailures,
  medians: rows,
  rawMetrics: samples,
};
assert.equal(result.samples, 40);
assert.equal(
  new Set(samples.filter((sample) => sample.purge).map((sample) => sample.purge.run)).size,
  20,
);
await writeFile(values.out, JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(
  JSON.stringify({ samples: result.samples, coldPurges: result.coldPurges, medians: rows }),
);
