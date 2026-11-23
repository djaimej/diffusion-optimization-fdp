import { Injectable, computed, inject, signal } from '@angular/core';
import {
  CostMode,
  EXACT_LIMIT,
  Solution,
  Topology,
  Weight,
  validate,
} from '@core/diffusion-solver';
import { SolverRunner } from './solver-runner';

/** Límites de la UI (el solver exacto se usa hasta EXACT_LIMIT difusores; arriba, heurística). */
export const MAX_DIFFUSERS = 60;
export const MAX_PASSIVES = 120;

export type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }
  | {
    status: 'done';
    solution: Solution;
    /** Copia de la topología y modo con los que se calculó (para mostrar nombres aunque cambie). */
    topology: Topology;
    mode: CostMode;
    version: number;
    ms: number;
  };

/** Archivo de import/export. */
export interface TopologyFile {
  mode: CostMode;
  topology: Topology;
}

@Injectable({ providedIn: 'root' })
export class TopologyStore {
  private readonly runner = inject(SolverRunner);

  private readonly _topology = signal<Topology>(exampleTopology());
  /** Se incrementa en cada cambio de la topología; sirve para saber si el resultado quedó viejo. */
  private readonly _version = signal(0);

  readonly topology = this._topology.asReadonly();
  readonly mode = signal<CostMode>('broadcast');
  readonly run = signal<RunState>({ status: 'idle' });

  readonly errors = computed(() => validate(this._topology()));
  readonly diffuserCount = computed(() => this._topology().diffusers.length);
  readonly passiveCount = computed(() => this._topology().passives.length);
  readonly edgeCount = computed(
    () =>
      this.diffuserCount() +
      this._topology().cost.reduce((s, row) => s + row.filter((w) => w !== null).length, 0),
  );
  readonly willBeExact = computed(() => this.diffuserCount() <= EXACT_LIMIT);
  readonly canAddDiffuser = computed(() => this.diffuserCount() < MAX_DIFFUSERS);
  readonly canAddPassive = computed(() => this.passiveCount() < MAX_PASSIVES);

  /** Resultado vigente: sólo si se calculó con la topología y el modo actuales. */
  readonly freshResult = computed(() => {
    const r = this.run();
    return r.status === 'done' && r.version === this._version() && r.mode === this.mode()
      ? r
      : null;
  });
  readonly isStale = computed(() => this.run().status === 'done' && !this.freshResult());

  /* ------------------------------------------------------------ */
  /* Cálculo (disparado por botón, no en tiempo real)             */
  /* ------------------------------------------------------------ */

  async calculate(): Promise<void> {
    if (this.errors().length || this.run().status === 'running') return;
    const topology = structuredClone(this._topology());
    const mode = this.mode();
    const version = this._version();
    this.run.set({ status: 'running' });
    const res = await this.runner.run(topology, mode);
    if (res.kind === 'cancelled') this.run.set({ status: 'cancelled' });
    else if (res.kind === 'error') this.run.set({ status: 'error', message: res.message });
    else
      this.run.set({ status: 'done', solution: res.solution, ms: res.ms, topology, mode, version });
  }

  cancel(): void {
    this.runner.cancel();
  }

  /* ------------------------------------------------------------ */
  /* Edición de la topología                                      */
  /* ------------------------------------------------------------ */

  addDiffuser(): void {
    if (!this.canAddDiffuser()) return;
    this.mutate((t) => ({
      ...t,
      diffusers: [...t.diffusers, nextName('D', t.diffusers)],
      sourceCost: [...t.sourceCost, 1],
      cost: [...t.cost, t.passives.map(() => null)],
    }));
  }

  removeDiffuser(d: number): void {
    this.mutate((t) => ({
      ...t,
      diffusers: t.diffusers.filter((_, i) => i !== d),
      sourceCost: t.sourceCost.filter((_, i) => i !== d),
      cost: t.cost.filter((_, i) => i !== d),
    }));
  }

  addPassive(): void {
    if (!this.canAddPassive()) return;
    this.mutate((t) => ({
      ...t,
      passives: [...t.passives, nextName('P', t.passives)],
      cost: t.cost.map((row) => [...row, null]),
    }));
  }

  removePassive(p: number): void {
    this.mutate((t) => ({
      ...t,
      passives: t.passives.filter((_, i) => i !== p),
      cost: t.cost.map((row) => row.filter((_, i) => i !== p)),
    }));
  }

  renameDiffuser(d: number, name: string): void {
    const clean = name.trim();
    if (!clean) return;
    this.mutate((t) => ({ ...t, diffusers: t.diffusers.map((n, i) => (i === d ? clean : n)) }));
  }

  renamePassive(p: number, name: string): void {
    const clean = name.trim();
    if (!clean) return;
    this.mutate((t) => ({ ...t, passives: t.passives.map((n, i) => (i === p ? clean : n)) }));
  }

  /** Valor vacío → NaN (la validación lo marca: F→D es obligatorio). */
  setSourceCost(d: number, raw: string): void {
    const w = parseWeight(raw) ?? NaN;
    this.mutate((t) => ({ ...t, sourceCost: t.sourceCost.map((v, i) => (i === d ? w : v)) }));
  }

  /** Valor vacío → sin arista. */
  setCost(d: number, p: number, raw: string): void {
    const w = parseWeight(raw);
    this.mutate((t) => ({
      ...t,
      cost: t.cost.map((row, i) => (i === d ? row.map((v, j) => (j === p ? w : v)) : row)),
    }));
  }

  loadExample(): void {
    this.replace(exampleTopology());
  }

  loadRandom(D: number, P: number, density = 0.3, maxWeight = 10): void {
    this.replace(
      randomTopology(Math.min(D, MAX_DIFFUSERS), Math.min(P, MAX_PASSIVES), density, maxWeight),
    );
  }

  clear(): void {
    this.replace({ diffusers: ['D1'], passives: ['P1'], sourceCost: [1], cost: [[1]] });
  }

  toFile(): TopologyFile {
    return { mode: this.mode(), topology: structuredClone(this._topology()) };
  }

  /** Lanza error si el JSON no tiene la forma esperada. */
  loadFile(data: unknown): void {
    const f = data as Partial<TopologyFile>;
    const t = f?.topology;
    const isStrArr = (a: unknown): a is string[] =>
      Array.isArray(a) && a.every((x) => typeof x === 'string');
    if (
      !t ||
      !isStrArr(t.diffusers) ||
      !isStrArr(t.passives) ||
      !Array.isArray(t.sourceCost) ||
      !Array.isArray(t.cost) ||
      t.cost.some((r) => !Array.isArray(r))
    ) {
      throw new Error('El archivo no contiene una topología válida.');
    }
    if (t.diffusers.length > MAX_DIFFUSERS || t.passives.length > MAX_PASSIVES) {
      throw new Error(`Límite: ${MAX_DIFFUSERS} difusores y ${MAX_PASSIVES} pasivos.`);
    }
    if (f.mode === 'select' || f.mode === 'broadcast') this.mode.set(f.mode);
    this.replace(structuredClone(t));
  }

  private replace(t: Topology): void {
    this._topology.set(t);
    this._version.update((v) => v + 1);
    this.run.set({ status: 'idle' });
  }

  private mutate(fn: (t: Topology) => Topology): void {
    this._topology.update(fn);
    this._version.update((v) => v + 1);
  }
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function parseWeight(raw: string): Weight {
  const s = raw.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function nextName(prefix: string, existing: string[]): string {
  let i = existing.length + 1;
  while (existing.includes(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

/** Topología del diagrama original (A, B, C → P1, P2, P3). */
export function exampleTopology(): Topology {
  return {
    diffusers: ['A', 'B', 'C'],
    passives: ['P1', 'P2', 'P3'],
    sourceCost: [1, 1, 2],
    cost: [
      [1, 3, null],
      [null, 1, 2],
      [2, 2, 1],
    ],
  };
}

/** Topología aleatoria que siempre cumple las reglas base. */
export function randomTopology(D: number, P: number, density: number, maxWeight: number): Topology {
  const w = () => 1 + Math.floor(Math.random() * maxWeight);
  const cost: Weight[][] = Array.from({ length: D }, () =>
    Array.from({ length: P }, () => (Math.random() < density ? w() : null)),
  );
  for (let p = 0; p < P; p++) {
    if (!cost.some((r) => r[p] !== null)) cost[Math.floor(Math.random() * D)][p] = w();
  }
  for (let d = 0; d < D; d++) {
    if (!cost[d].some((x) => x !== null)) cost[d][Math.floor(Math.random() * P)] = w();
  }
  return {
    diffusers: Array.from({ length: D }, (_, i) => `D${i + 1}`),
    passives: Array.from({ length: P }, (_, i) => `P${i + 1}`),
    sourceCost: Array.from({ length: D }, w),
    cost,
  };
}
