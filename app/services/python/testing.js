import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
/** Fake uv implements its file/command boundary without downloads. */
export function fakeUv() {
  const calls = [];
  let fail = false;
  return {
    calls,
    setFail(value) {
      fail = value;
    },
    async runner(command, args, options) {
      calls.push({ command, args, env: options.env });
      if (fail) throw new Error('fixture package unavailable');
      if (args[0] === 'venv') {
        const folder = path.join(args.at(-1), process.platform === 'win32' ? 'Scripts' : 'bin');
        await mkdir(folder, { recursive: true });
        await writeFile(
          path.join(folder, process.platform === 'win32' ? 'python.exe' : 'python'),
          'fixture',
        );
      }
      if (args[0] === '--version') return { stdout: 'Python 3.14.7', stderr: '' };
      if (args[1] === 'compile') {
        const text = await readFile(args[2], 'utf8');
        await writeFile(
          args[args.indexOf('--output-file') + 1],
          text
            .split('\n')
            .filter(Boolean)
            .map((spec) => (spec.includes('==') ? spec : spec + '==1.0'))
            .join('\n'),
        );
      }
      return { stdout: '', stderr: '' };
    },
  };
}
