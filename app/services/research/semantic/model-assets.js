import path from 'node:path';
import { AppError } from '../../../core/errors.js';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, open, rename, rm, statfs } from 'node:fs/promises';

const run = promisify(execFile);
/** @returns {Promise<any>} */
export async function embeddingManifest() {
  return JSON.parse(
    await readFile(new URL('../../../../models/default-embedding.json', import.meta.url), 'utf8'),
  );
}
/** @param {string} file @returns {Promise<string>} */
export async function fileDigest(file) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

// OS capability detection, never a CPU-name guess. The Windows constant 40 is
// PF_AVX2_INSTRUCTIONS_AVAILABLE (IsProcessorFeaturePresent).
/** @param {string} directory @returns {Promise<any>} */
export async function embeddingHardware(directory) {
  await mkdir(directory, { recursive: true });
  const disk = await statfs(directory),
    memoryBytes = os.totalmem();
  let avx2 = false,
    detectionError = null;
  try {
    if (process.arch === 'x64' && process.platform === 'win32') {
      const script = `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class ScienceScopeCpu { [DllImport("kernel32.dll")] public static extern bool IsProcessorFeaturePresent(uint feature); }'; [ScienceScopeCpu]::IsProcessorFeaturePresent(40)`;
      const powershell = path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      );
      const { stdout } = await run(
        powershell,
        ['-NoProfile', '-NonInteractive', '-Command', script],
        {
          windowsHide: true,
          timeout: 15000,
          env: {
            ...process.env,
            TEMP: directory,
            TMP: directory,
            PSModuleAnalysisCachePath: path.join(directory, 'powershell-analysis-cache'),
          },
          maxBuffer: 16384,
        },
      );
      avx2 = /true/iu.test(stdout);
    } else if (process.arch === 'x64' && process.platform === 'linux') {
      avx2 = /\bavx2\b/u.test(await readFile('/proc/cpuinfo', 'utf8'));
    } else if (process.arch === 'x64' && process.platform === 'darwin') {
      avx2 = /AVX2/iu.test(
        (await run('sysctl', ['-n', 'machdep.cpu.leaf7_features'], { timeout: 5000 })).stdout,
      );
    }
  } catch (error) {
    detectionError = String(error.code ?? 'CPU_DETECTION_FAILED');
  }
  const freeBytes = Number(disk.bavail) * Number(disk.bsize);
  return {
    avx2,
    memoryBytes,
    freeBytes,
    ...(detectionError ? { detectionError } : {}),
    supported: avx2 && memoryBytes >= 8 * 1024 ** 3 && freeBytes >= 5 * 1024 ** 3,
  };
}

const entries = (manifest) =>
  Array.isArray(manifest.files)
    ? manifest.files
    : Object.entries(manifest.files).map(([name, value]) => ({ path: name, ...value }));
function targetPath(root, entry) {
  const file = path.resolve(root, entry.path ?? entry.name);
  if (!file.startsWith(path.resolve(root) + path.sep))
    throw new AppError('INVALID_MODEL_MANIFEST_PATH', '模型清单里的文件路径无效。');
  return file;
}
/** @param {any} handle @param {Uint8Array} chunk @returns {Promise<void>} */
export async function writeChunkFully(handle, chunk) {
  let offset = 0;
  while (offset < chunk.length) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
    if (!bytesWritten)
      throw new AppError('MODEL_DOWNLOAD_WRITE_INCOMPLETE', '模型文件没有写完，请重新下载。');
    offset += bytesWritten;
  }
}
/** @param {string} root @param {any} manifest @returns {Promise<boolean>} */
export async function verifyEmbeddingFiles(root, manifest) {
  for (const entry of entries(manifest)) {
    try {
      if ((await fileDigest(targetPath(root, entry))) !== entry.sha256) return false;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }
  return true;
}

/** Explicit user action only. No model records, API keys or research text leave
 * the machine; fetches are pinned public model artifacts.
 * @param {string} root @param {any} manifest
 * @param {{onProgress?:(progress:any)=>void,fetchImpl?:typeof fetch,signal?:AbortSignal,downloadSource?:string,customDownloadUrl?:string}} [options]
 * @returns {Promise<void>}
 */
export async function downloadEmbeddingFiles(
  root,
  manifest,
  {
    onProgress = () => {},
    fetchImpl = fetch,
    signal,
    downloadSource = 'official',
    customDownloadUrl = '',
  } = {},
) {
  await mkdir(root, { recursive: true });
  const files = entries(manifest);
  let completed = 0;
  for (const entry of files) {
    if (signal?.aborted)
      throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
    const destination = targetPath(root, entry),
      relative = entry.path ?? entry.name;
    try {
      if ((await fileDigest(destination)) === entry.sha256) {
        completed++;
        continue;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = destination + '.download';
    let lastError;
    const urls = embeddingDownloadUrls(manifest, relative, downloadSource, customDownloadUrl);
    for (const url of urls) {
      if (signal?.aborted)
        throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
      let handle;
      try {
        const timeout = AbortSignal.timeout(10 * 60 * 1000);
        const response = await fetchImpl(url, {
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (signal?.aborted)
          throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
        if (!response.ok || !response.body)
          throw new AppError(
            'MODEL_DOWNLOAD_HTTP_ERROR',
            `Model artifact HTTP response: ${response.status}`,
            502,
          );
        handle = await open(temporary, 'w');
        const hash = createHash('sha256');
        let bytes = 0;
        for await (const chunk of response.body) {
          if (signal?.aborted)
            throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
          await writeChunkFully(handle, chunk);
          hash.update(chunk);
          bytes += chunk.length;
          onProgress({
            file: relative,
            bytes,
            total: Number(response.headers.get('content-length')) || entry.bytes || null,
            completed,
            files: files.length,
          });
        }
        if (signal?.aborted)
          throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
        await handle.close();
        handle = null;
        if (hash.digest('hex') !== entry.sha256)
          throw new AppError(
            'MODEL_CHECKSUM_MISMATCH',
            '模型文件校验不一致，没有使用；请换一个下载源或稍后重试。',
          );
        await rename(temporary, destination);
        completed++;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        await handle?.close().catch(() => {});
        await rm(temporary, { force: true });
        // A successful HTTP response with different bytes is not a transport
        // failure. Never change sources after a checksum mismatch.
        if (error.code === 'MODEL_CHECKSUM_MISMATCH') throw error;
        if (signal?.aborted) throw error;
      }
    }
    if (lastError) throw lastError;
  }
  onProgress({ completed, files: files.length, done: true });
}

/**
 * ModelScope's repository was checked against all five manifest SHA-256 values
 * on 2026-10-12. Its own revision is pinned; byte verification stays mandatory.
 * @param {any} manifest
 * @param {string} relative
 * @param {string} source
 * @param {string} custom
 * @returns {string[]}
 */
export function embeddingDownloadUrls(manifest, relative, source, custom) {
  const suffix = `${manifest.modelId}/resolve/${manifest.revision}/${relative}`;
  if (source === 'official')
    return [`https://huggingface.co/${suffix}`, `https://hf-mirror.com/${suffix}`];
  if (source === 'hf-mirror') return [`https://hf-mirror.com/${suffix}`];
  if (source === 'modelscope')
    return [
      `https://modelscope.cn/models/${manifest.modelId}/resolve/252d0dcb679dda2c7b6fd5bbfed15df3c7feaebf/${relative}`,
    ];
  if (source === 'custom' && custom.trim())
    return [`${custom.trim().replace(/\/$/, '')}/${suffix}`];
  throw new AppError('MODEL_DOWNLOAD_SOURCE_INVALID', '模型下载源未设置或无效，请在设置里选择。');
}
