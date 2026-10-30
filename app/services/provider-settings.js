import { dataPaths } from '../core/paths.js';
import { settings } from '../core/workspace/resources/settings.js';
import { storeProviderHeaders, removeProviderHeaders } from './providers.js';
import { startSettingsStage } from '../core/workspace/settings-observation.js';

/**
 * Inject credential I/O into this resource at the composition boundary. The
 * workspace queue covers both the file and its credentials, including AI edits.
 * @param {string} dataRoot
 * @returns {import('../core/workspace/workspace.js').Resource}
 */
export function providerSettings(dataRoot) {
  const paths = dataPaths(dataRoot);
  return {
    ...settings,
    async prepare(text) {
      const finish = startSettingsStage('provider.prepare');
      try {
        if (text == null) return null;
        const value = JSON.parse(text);
        value.providers = await storeProviderHeaders(paths, value.providers ?? []);
        return `${JSON.stringify(value, null, 2)}\n`;
      } finally {
        finish();
      }
    },
    async afterEdit(before, after) {
      const finish = startSettingsStage('provider.afterEdit');
      try {
        await removeProviderHeaders(paths, settings.parse(before), settings.parse(after));
      } finally {
        finish();
      }
    },
  };
}
