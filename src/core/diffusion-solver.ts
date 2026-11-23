/**
 * Solver de difusión FUENTE → DIFUSOR → PASIVO (altura 3).
 *
 * Modelo: Uncapacitated Facility Location (UFL).
 *   - "Abrir" un difusor d cuesta w(F→d).
 *   - Cada pasivo p se asigna a UN difusor abierto, pagando w(d→p).
 *   - Minimizar  Σ w(F→d) [d abierto]  +  Σ_p w(asignado(p)→p).
 *
 * Modo 'broadcast' (alternativo): un difusor activado envía a TODOS sus pasivos,
 * así que abrirlo cuesta w(F→d) + Σ w(d→p) de todas sus aristas y la asignación es gratis.
 * Eso lo convierte en Set Cover ponderado; el mismo solver lo resuelve.
 *
 * Ambos problemas son NP-difíciles: exacto (branch & bound) para D pequeño,
 * greedy + búsqueda local para D grande.
 */

export type Weight = number | null; // null = no existe la arista
export type CostMode = 'select' | 'broadcast';

export interface Topology {
  diffusers: string[];   // etiquetas de difusores (D)
  passives: string[];    // etiquetas de pasivos (P)
  sourceCost: number[];  // w(F→d), longitud D
  cost: Weight[][];      // w(d→p), matriz [D][P]
}

export interface Solution {
  diffusers: number[];   // índices de difusores activados
  assignment: number[];  // assignment[p] = difusor que entrega a p (en broadcast: el más barato de los abiertos)
  sourceCost: number;    // Σ w(F→d) de los abiertos
  deliveryCost: number;  // Σ costos D→P pagados
  total: number;
  exact: boolean;        // true si se garantiza óptimo
  explored: number;      // nodos explorados por el branch & bound
}

export const EXACT_LIMIT = 24;

/* ------------------------------------------------------------------ */
/* Validación de las reglas base                                       */
/* ------------------------------------------------------------------ */

export function validate(t: Topology): string[] {
  const errs: string[] = [];
  const D = t.diffusers.length;
  const P = t.passives.length;
  if (D === 0) errs.push('Debe existir al menos un difusor.');
  if (P === 0) errs.push('Debe existir al menos un pasivo.');
  if (t.sourceCost.length !== D) errs.push('sourceCost debe tener un valor por difusor.');
  if (t.cost.length !== D || t.cost.some(r => r.length !== P)) errs.push('cost debe ser una matriz D×P.');
  if (errs.length) return errs;

  const ok = (w: number) => Number.isFinite(w) && w >= 1;
  t.sourceCost.forEach((w, d) => {
    if (!ok(w)) errs.push(`F→${t.diffusers[d]}: el costo debe ser ≥ 1.`);
  });
  for (let d = 0; d < D; d++) {
    let out = 0;
    for (let p = 0; p < P; p++) {
      const w = t.cost[d][p];
      if (w === null) continue;
      if (!ok(w)) errs.push(`${t.diffusers[d]}→${t.passives[p]}: el costo debe ser ≥ 1.`);
      out++;
    }
    if (out === 0) errs.push(`${t.diffusers[d]} no entrega a ningún pasivo.`);
  }
  for (let p = 0; p < P; p++) {
    if (!t.cost.some(r => r[p] !== null)) errs.push(`${t.passives[p]} no recibe de ningún difusor.`);
  }
  return errs;
}

/* ------------------------------------------------------------------ */
/* Modelo interno normalizado                                          */
/* ------------------------------------------------------------------ */

interface Model {
  D: number;
  P: number;
  open: number[];      // costo de abrir cada difusor
  assign: number[][];  // costo de asignar p a d (Infinity = sin arista)
}

function toModel(t: Topology, mode: CostMode): Model {
  const D = t.diffusers.length;
  const P = t.passives.length;
  const assign = t.cost.map(row =>
    row.map(w => (w === null ? Infinity : mode === 'broadcast' ? 0 : w)),
  );
  const open = t.sourceCost.map((f, d) =>
    mode === 'broadcast' ? f + t.cost[d].reduce<number>((s, w) => s + (w ?? 0), 0) : f,
  );
  return { D, P, open, assign };
}

function setCost(m: Model, set: Iterable<number>): number {
  const ids = [...set];
  let total = 0;
  for (const d of ids) total += m.open[d];
  for (let p = 0; p < m.P; p++) {
    let best = Infinity;
    for (const d of ids) if (m.assign[d][p] < best) best = m.assign[d][p];
    if (best === Infinity) return Infinity;
    total += best;
  }
  return total;
}

function buildSolution(
  t: Topology, mode: CostMode, set: number[], exact: boolean, explored: number,
): Solution {
  const diffusers = [...set].sort((a, b) => a - b);
  const assignment: number[] = [];
  for (let p = 0; p < t.passives.length; p++) {
    let best = -1;
    for (const d of diffusers) {
      const w = t.cost[d][p];
      if (w !== null && (best === -1 || w < (t.cost[best][p] as number))) best = d;
    }
    assignment.push(best);
  }
  const sourceCost = diffusers.reduce((s, d) => s + t.sourceCost[d], 0);
  const deliveryCost =
    mode === 'broadcast'
      ? diffusers.reduce((s, d) => s + t.cost[d].reduce<number>((a, w) => a + (w ?? 0), 0), 0)
      : assignment.reduce((s, d, p) => s + (t.cost[d][p] as number), 0);
  return { diffusers, assignment, sourceCost, deliveryCost, total: sourceCost + deliveryCost, exact, explored };
}

/* ------------------------------------------------------------------ */
/* Heurística: greedy de cobertura + búsqueda local (add/drop/swap)    */
/* ------------------------------------------------------------------ */

function greedySet(m: Model): number[] {
  const open = new Set<number>();

  // Difusores forzados: pasivos con un solo difusor entrante
  for (let p = 0; p < m.P; p++) {
    const cands: number[] = [];
    for (let d = 0; d < m.D; d++) if (m.assign[d][p] !== Infinity) cands.push(d);
    if (cands.length === 1) open.add(cands[0]);
  }

  // Cobertura: elegir el difusor con menor costo por pasivo nuevo cubierto
  const covered = (p: number) => [...open].some(d => m.assign[d][p] !== Infinity);
  for (;;) {
    const uncovered = [...Array(m.P).keys()].filter(p => !covered(p));
    if (!uncovered.length) break;
    let bestD = -1;
    let bestRatio = Infinity;
    for (let d = 0; d < m.D; d++) {
      if (open.has(d)) continue;
      let n = 0;
      let c = m.open[d];
      for (const p of uncovered) if (m.assign[d][p] !== Infinity) { n++; c += m.assign[d][p]; }
      if (n && c / n < bestRatio) { bestRatio = c / n; bestD = d; }
    }
    open.add(bestD);
  }

  // Búsqueda local: aplicar el mejor movimiento que mejore hasta que ninguno lo haga
  let current = setCost(m, open);
  for (;;) {
    let bestMove: Set<number> | null = null;
    let bestCost = current;
    const inside = [...open];
    const outside = [...Array(m.D).keys()].filter(d => !open.has(d));
    const tryCand = (cand: Set<number>) => {
      const c = setCost(m, cand);
      if (c < bestCost) { bestCost = c; bestMove = cand; }
    };
    for (const d of outside) tryCand(new Set([...open, d]));
    for (const d of inside) tryCand(new Set(inside.filter(x => x !== d)));
    for (const a of inside) for (const b of outside) tryCand(new Set([...inside.filter(x => x !== a), b]));
    if (!bestMove) break;
    open.clear();
    for (const d of bestMove as Set<number>) open.add(d);
    current = bestCost;
  }
  return [...open];
}

export function solveGreedy(t: Topology, mode: CostMode = 'select'): Solution {
  return buildSolution(t, mode, greedySet(toModel(t, mode)), false, 0);
}

/* ------------------------------------------------------------------ */
/* Exacto: branch & bound sobre incluir/excluir cada difusor           */
/* ------------------------------------------------------------------ */

export function solveExact(t: Topology, mode: CostMode = 'select'): Solution {
  const m = toModel(t, mode);
  if (m.D > EXACT_LIMIT) throw new Error(`Exacto limitado a ${EXACT_LIMIT} difusores.`);

  // Cota superior inicial con la heurística
  let bestSet = greedySet(m);
  let best = setCost(m, bestSet);

  // Explorar primero los difusores más baratos de abrir
  const order = [...Array(m.D).keys()].sort((a, b) => m.open[a] - m.open[b]);

  // suffixMin[i][p] = menor costo de asignar p con algún difusor de order[i..]
  const suffixMin: number[][] = Array.from({ length: m.D + 1 }, () => Array(m.P).fill(Infinity));
  for (let i = m.D - 1; i >= 0; i--) {
    const d = order[i];
    for (let p = 0; p < m.P; p++) suffixMin[i][p] = Math.min(suffixMin[i + 1][p], m.assign[d][p]);
  }

  const chosen: number[] = [];
  let explored = 0;

  const dfs = (i: number, openSum: number, cur: number[]): void => {
    explored++;
    // Cota inferior: lo ya abierto + para cada pasivo el mejor costo alcanzable
    let lb = openSum;
    for (let p = 0; p < m.P; p++) {
      const v = Math.min(cur[p], suffixMin[i][p]);
      if (v === Infinity) return; // pasivo imposible de cubrir en esta rama
      lb += v;
    }
    if (lb >= best) return;
    if (i === m.D) { best = lb; bestSet = [...chosen]; return; }

    const d = order[i];
    chosen.push(d);
    dfs(i + 1, openSum + m.open[d], cur.map((v, p) => Math.min(v, m.assign[d][p])));
    chosen.pop();
    dfs(i + 1, openSum, cur);
  };

  dfs(0, 0, Array(m.P).fill(Infinity));
  return buildSolution(t, mode, bestSet, true, explored);
}

/** Punto de entrada: valida, y usa exacto si D ≤ EXACT_LIMIT, heurística si no. */
export function solve(t: Topology, mode: CostMode = 'select'): Solution {
  const errs = validate(t);
  if (errs.length) throw new Error(errs.join('\n'));
  return t.diffusers.length <= EXACT_LIMIT ? solveExact(t, mode) : solveGreedy(t, mode);
}
