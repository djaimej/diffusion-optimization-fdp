import { CostMode, Topology, solveExact, solveGreedy, validate } from './diffusion-solver';

/** Costo de un conjunto de difusores según el modo (definición directa, sin el modelo interno). */
function costOf(t: Topology, mode: CostMode, set: number[]): number {
  let total = set.reduce((s, d) => s + t.sourceCost[d], 0);
  for (let p = 0; p < t.passives.length; p++) {
    const ws = set.map((d) => t.cost[d][p]).filter((w): w is number => w !== null);
    if (!ws.length) return Infinity;
    if (mode === 'select') total += Math.min(...ws);
  }
  if (mode === 'broadcast') {
    for (const d of set) total += t.cost[d].reduce<number>((s, w) => s + (w ?? 0), 0);
  }
  return total;
}

function bruteForce(t: Topology, mode: CostMode): number {
  const D = t.diffusers.length;
  let best = Infinity;
  for (let mask = 1; mask < 1 << D; mask++) {
    const set = [...Array(D).keys()].filter((d) => mask & (1 << d));
    best = Math.min(best, costOf(t, mode, set));
  }
  return best;
}

/** Generador determinista para que las fallas sean reproducibles. */
function rng(seed: number) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

function randomTopology(rand: () => number, D: number, P: number): Topology {
  const w = () => 1 + Math.floor(rand() * 9);
  const cost = Array.from({ length: D }, () =>
    Array.from({ length: P }, () => (rand() < 0.4 ? w() : null)),
  );
  for (let p = 0; p < P; p++)
    if (!cost.some((r) => r[p] !== null)) cost[Math.floor(rand() * D)][p] = w();
  for (let d = 0; d < D; d++)
    if (!cost[d].some((x) => x !== null)) cost[d][Math.floor(rand() * P)] = w();
  return {
    diffusers: Array.from({ length: D }, (_, i) => `D${i}`),
    passives: Array.from({ length: P }, (_, i) => `P${i}`),
    sourceCost: Array.from({ length: D }, w),
    cost,
  };
}

const example: Topology = {
  diffusers: ['A', 'B', 'C'],
  passives: ['P1', 'P2', 'P3'],
  sourceCost: [1, 1, 2],
  cost: [
    [1, 3, null],
    [null, 1, 2],
    [2, 2, 1],
  ],
};

describe('diffusion-solver', () => {
  it('resuelve el diagrama de ejemplo en ambos modos', () => {
    const sel = solveExact(example, 'select');
    expect(sel.diffusers).toEqual([0, 1]); // A, B
    expect(sel.total).toBe(6);

    const bc = solveExact(example, 'broadcast');
    expect(bc.diffusers).toEqual([2]); // C
    expect(bc.total).toBe(7);
    expect(bc.sourceCost + bc.deliveryCost).toBe(bc.total);
  });

  it('valida las reglas base', () => {
    expect(validate(example)).toEqual([]);
    const bad: Topology = {
      diffusers: ['A', 'B'],
      passives: ['P1', 'P2'],
      sourceCost: [0, 1],
      cost: [
        [1, null],
        [null, null],
      ],
    };
    const errs = validate(bad);
    expect(errs.some((e) => e.includes('F→A'))).toBe(true);
    expect(errs.some((e) => e.includes('B no entrega'))).toBe(true);
    expect(errs.some((e) => e.includes('P2 no recibe'))).toBe(true);
  });

  for (const mode of ['select', 'broadcast'] as const) {
    it(`exacto = fuerza bruta en 200 instancias aleatorias (${mode})`, () => {
      const rand = rng(mode === 'select' ? 7 : 11);
      for (let i = 0; i < 200; i++) {
        const t = randomTopology(rand, 1 + Math.floor(rand() * 8), 1 + Math.floor(rand() * 10));
        const exact = solveExact(t, mode);
        const expected = bruteForce(t, mode);
        expect(exact.total).toBe(expected);
        expect(costOf(t, mode, exact.diffusers)).toBe(exact.total);
        expect(exact.assignment.every((d) => exact.diffusers.includes(d))).toBe(true);

        const greedy = solveGreedy(t, mode);
        expect(greedy.total).toBeGreaterThanOrEqual(expected);
        expect(costOf(t, mode, greedy.diffusers)).toBe(greedy.total);
      }
    });
  }
});
