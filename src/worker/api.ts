import * as Comlink from 'comlink';
import type { GeneratorApi } from './generator.worker';

export type Generator = Comlink.Remote<GeneratorApi>;

export function createGenerator(): Generator {
  const worker = new Worker(new URL('./generator.worker.ts', import.meta.url), {
    type: 'module',
    name: 'generator',
  });
  return Comlink.wrap<GeneratorApi>(worker);
}
