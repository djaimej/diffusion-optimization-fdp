import { Injectable } from '@angular/core';
import { CostMode, Solution, Topology, solve } from '@core/diffusion-solver';

export type RunResult =
  | { kind: 'ok'; solution: Solution; ms: number }
  | { kind: 'error'; message: string }
  | { kind: 'cancelled' };

/** Mensajes intercambiados con solver.worker.ts */
export interface SolverRequest {
  topology: Topology;
  mode: CostMode;
}
export type SolverResponse =
  { ok: true; solution: Solution; ms: number } | { ok: false; error: string };

/**
 * Ejecuta el solver en un Web Worker para no bloquear la UI
 * (el exacto es exponencial en el número de difusores).
 * Un worker por cálculo: cancelar = terminate().
 */
@Injectable({ providedIn: 'root' })
export class SolverRunner {
  private worker: Worker | null = null;
  private settle: ((r: RunResult) => void) | null = null;

  run(topology: Topology, mode: CostMode): Promise<RunResult> {
    this.cancel();

    if (typeof Worker === 'undefined') return Promise.resolve(runInline(topology, mode));

    return new Promise<RunResult>((resolve) => {
      const worker = new Worker(new URL('../../core/solver.worker', import.meta.url), {
        type: 'module',
      });
      this.worker = worker;
      this.settle = resolve;

      worker.onmessage = ({ data }: MessageEvent<SolverResponse>) => {
        this.finish(
          data.ok
            ? { kind: 'ok', solution: data.solution, ms: data.ms }
            : { kind: 'error', message: data.error },
        );
      };
      worker.onerror = (e) => {
        e.preventDefault();
        this.finish({ kind: 'error', message: e.message || 'Error en el worker del solver.' });
      };
      worker.postMessage({ topology, mode } satisfies SolverRequest);
    });
  }

  cancel(): void {
    if (this.worker) this.finish({ kind: 'cancelled' });
  }

  private finish(result: RunResult): void {
    this.worker?.terminate();
    this.worker = null;
    const settle = this.settle;
    this.settle = null;
    settle?.(result);
  }
}

function runInline(topology: Topology, mode: CostMode): RunResult {
  const t0 = performance.now();
  try {
    return { kind: 'ok', solution: solve(topology, mode), ms: performance.now() - t0 };
  } catch (e) {
    return { kind: 'error', message: (e as Error).message };
  }
}
