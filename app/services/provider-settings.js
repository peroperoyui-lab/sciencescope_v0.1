import { dataPaths } from '../core/paths.js';
import { settings } from '../core/workspace/resources/settings.js';
import { storeProviderHeaders, removeProviderHeaders } from './providers.js';

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
      if (text == null) return null;
      const value = JSON.parse(text);
      value.providers = await storeProviderHeaders(paths, value.providers ?? []);
      return `${JSON.stringify(value, null, 2)}\n`;
    },
    async afterEdit(before, after) {
      await removeProviderHeaders(paths, settings.parse(before), settings.parse(after));
    },
  };
}
