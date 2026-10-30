import { channel } from 'node:diagnostics_channel';

const observations = channel('sciencescope.settings.performance');
const noop = () => {};

/**
 * Private opt-in timings contain stage names and counts, never resource content.
 * @param {string} stage
 * @param {boolean} [enabled]
 * @returns {(count?:number)=>void}
 */
export function startSettingsStage(stage, enabled = true) {
  if (!enabled || !observations.hasSubscribers) return noop;
  const started = performance.now();
  return (count = 1) =>
    observations.publish({ stage, durationMs: performance.now() - started, count });
}
