import { solve, Topology } from "./diffusion-solver";

// Tu diagrama (sin la rama N, que es forzada: PN sólo recibe de DN)
const t: Topology = {
  diffusers: ['A', 'B', 'C'],
  passives: ['P1', 'P2', 'P3'],
  sourceCost: [1, 1, 2],
  cost: [
    [1, 3, null],
    [null, 1, 2],
    [2, 2, 1],
  ],
};

// Enfoque propuesto: por cada pasivo, el difusor con menor w(d→p)
const naive = new Set<number>();
let naiveDelivery = 0;
for (let p = 0; p < 3; p++) {
  let best = -1;
  for (let d = 0; d < 3; d++) {
    const w = t.cost[d][p];
    if (w !== null && (best < 0 || w < (t.cost[best][p] as number))) best = d;
  }
  naive.add(best);
  naiveDelivery += t.cost[best][p] as number;
}
const naiveSource = [...naive].reduce((s, d) => s + t.sourceCost[d], 0);
console.log('greedy por pasivo:', [...naive].map(d => t.diffusers[d]), 'total', naiveSource + naiveDelivery);

for (const mode of ['select', 'broadcast'] as const) {
  const s = solve(t, mode);
  console.log(mode, s.diffusers.map(d => t.diffusers[d]), s);
}

// Estrés: 24 difusores × 80 pasivos aleatorios
const D = 24, P = 80;
const big: Topology = {
  diffusers: [...Array(D).keys()].map(i => `D${i}`),
  passives: [...Array(P).keys()].map(i => `P${i}`),
  sourceCost: [...Array(D)].map(() => 1 + Math.floor(Math.random() * 20)),
  cost: [...Array(D)].map(() => [...Array(P)].map(() => (Math.random() < 0.3 ? 1 + Math.floor(Math.random() * 10) : null))),
};
for (let p = 0; p < P; p++) if (!big.cost.some(r => r[p] !== null)) big.cost[0][p] = 5;
for (let d = 0; d < D; d++) if (!big.cost[d].some(w => w !== null)) big.cost[d][0] = 5;
let t0 = performance.now();
const ex = solve(big);
console.log('24x80 exacto:', ex.total, 'nodos', ex.explored, `${(performance.now() - t0).toFixed(0)} ms`);
