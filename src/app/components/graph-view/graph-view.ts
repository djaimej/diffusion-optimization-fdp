import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TopologyStore } from '../../services/topology.store';

interface NodeView {
  id: string;
  label: string;
  x: number;
  y: number;
  kind: 'source' | 'diffuser' | 'passive';
  used: boolean;
}

interface EdgeView {
  id: string;
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
  /** Fracción de la arista donde va la etiqueta. */
  k: number;
  state: 'none' | 'used' | 'unused';
}

const W = 720;
const PAD = 28;
const X = { source: 60, diffuser: 360, passive: 660 };
/** Con más aristas D→P que esto, sus etiquetas sólo aparecen al pasar el cursor por un nodo. */
const LABEL_LIMIT = 60;

/** Grafo de 3 capas (FUENTE → DIFUSORES → PASIVOS) con la solución resaltada. */
@Component({
  selector: 'app-graph-view',
  templateUrl: './graph-view.html',
  styleUrl: './graph-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphView {
  private readonly store = inject(TopologyStore);

  protected readonly hovered = signal<string | null>(null);

  protected readonly view = computed(() => {
    const t = this.store.topology();
    const r = this.store.freshResult();
    const D = t.diffusers.length;
    const P = t.passives.length;
    const n = Math.max(D, P, 3);
    const row = n > 30 ? 32 : 60;
    const H = n * row + PAD * 2;
    const y = (i: number, n: number) => PAD + ((i + 0.5) * (H - PAD * 2)) / n;

    const usedD = new Set(r?.solution.diffusers ?? []);
    const usedEdge = (d: number, p: number) =>
      !r ? false : r.mode === 'select' ? r.solution.assignment[p] === d : usedD.has(d);
    const state = (used: boolean): EdgeView['state'] => (!r ? 'none' : used ? 'used' : 'unused');

    const source: NodeView = {
      id: 'F',
      label: 'F',
      x: X.source,
      y: H / 2,
      kind: 'source',
      used: !!r,
    };
    const diffusers: NodeView[] = t.diffusers.map((name, d) => ({
      id: `D${d}`,
      label: name,
      x: X.diffuser,
      y: y(d, D),
      kind: 'diffuser',
      used: usedD.has(d),
    }));
    const passives: NodeView[] = t.passives.map((name, p) => ({
      id: `P${p}`,
      label: name,
      x: X.passive,
      y: y(p, P),
      kind: 'passive',
      used: !!r,
    }));

    const edges: EdgeView[] = [];
    t.sourceCost.forEach((w, d) => {
      const n = diffusers[d];
      edges.push({
        id: `F-${d}`,
        from: 'F',
        to: n.id,
        x1: source.x,
        y1: source.y,
        x2: n.x,
        y2: n.y,
        w,
        k: 0.55,
        state: state(usedD.has(d)),
      });
    });
    let dp = 0;
    t.cost.forEach((row, d) =>
      row.forEach((w, p) => {
        if (w === null) return;
        dp++;
        const a = diffusers[d];
        const b = passives[p];
        edges.push({
          id: `${d}-${p}`,
          from: a.id,
          to: b.id,
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          // Escalonar por pasivo destino para que las etiquetas no compartan columna
          w,
          k: 0.26 + 0.16 * (p % 4),
          state: state(usedEdge(d, p)),
        });
      }),
    );

    // Dibujar primero las no usadas para que las usadas queden encima
    const order = { unused: 0, none: 1, used: 2 };
    edges.sort((a, b) => order[a.state] - order[b.state]);

    return {
      width: W,
      height: H,
      nodes: [source, ...diffusers, ...passives],
      edges,
      showAllLabels: dp <= LABEL_LIMIT,
    };
  });

  protected isHot(e: EdgeView): boolean {
    const h = this.hovered();
    return h !== null && (e.from === h || e.to === h);
  }

  protected showLabel(e: EdgeView): boolean {
    const h = this.hovered();
    if (h !== null) return this.isHot(e);
    return e.from === 'F' || this.view().showAllLabels;
  }

  protected labelPos(e: EdgeView): { x: number; y: number } {
    const k = e.k;
    return { x: e.x1 + (e.x2 - e.x1) * k, y: e.y1 + (e.y2 - e.y1) * k };
  }

  protected short(label: string): string {
    return label.length > 4 ? label.slice(0, 3) + '…' : label;
  }
}
