/// <reference lib="webworker" />

import { CostMode, Topology, solve } from './diffusion-solver';

addEventListener('message', ({ data }: MessageEvent<{ topology: Topology; mode: CostMode }>) => {
  const t0 = performance.now();
  try {
    const solution = solve(data.topology, data.mode);
    postMessage({ ok: true, solution, ms: performance.now() - t0 });
  } catch (e) {
    postMessage({ ok: false, error: (e as Error).message });
  }
});
