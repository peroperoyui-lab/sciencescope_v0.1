/**
 * Keep timing packages separate from the user's installed preview, including
 * NSIS's product-name registry key. Production remains the default.
 * @param {NodeJS.ProcessEnv} environment
 * @returns {{productName?: string, identifier?: string, prune: boolean}}
 */
export function buildOptions(environment) {
  const installTest = environment.SCIENCESCOPE_BUILD_VARIANT === 'installtest';
  if (environment.SCIENCESCOPE_BUILD_PRUNE === '0' && !installTest)
    throw new Error('Unpruned builds are only available for installtest measurements');
  return {
    ...(installTest
      ? { productName: 'ScienceScope Install Test', identifier: 'org.sciencescope.installtest' }
      : {}),
    prune: environment.SCIENCESCOPE_BUILD_PRUNE !== '0',
  };
}
