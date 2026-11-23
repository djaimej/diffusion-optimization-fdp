import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NgbTooltip } from '@ng-bootstrap/ng-bootstrap';
import { TopologyStore } from '../../services/topology.store';

/**
 * Editor de la topología como matriz [D][P]:
 *  - Cada fila es un difusor, con su costo F→D.
 *  - Cada celda es el costo D→P; vacía = sin arista.
 *  - Con un resultado vigente se resaltan los difusores y aristas usados.
 */
@Component({
  selector: 'app-cost-matrix',
  imports: [NgbTooltip],
  templateUrl: './cost-matrix.html',
  styleUrl: './cost-matrix.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CostMatrix {
  protected readonly store = inject(TopologyStore);
  protected readonly t = this.store.topology;

  /** Conjuntos de difusores / aristas usados por el resultado vigente. */
  protected readonly used = computed(() => {
    const r = this.store.freshResult();
    const diffusers = new Set<number>();
    const edges = new Set<string>();
    if (!r) return { diffusers, edges };
    const { solution, topology, mode } = r;
    solution.diffusers.forEach((d) => diffusers.add(d));
    if (mode === 'select') {
      solution.assignment.forEach((d, p) => edges.add(`${d}:${p}`));
    } else {
      for (const d of solution.diffusers)
        topology.cost[d].forEach((w, p) => w !== null && edges.add(`${d}:${p}`));
    }
    return { diffusers, edges };
  });

  /** Pasivos sin ninguna arista entrante (para marcarlos en el encabezado). */
  protected readonly orphanPassives = computed(() => {
    const t = this.t();
    return new Set(t.passives.map((_, p) => p).filter((p) => !t.cost.some((r) => r[p] !== null)));
  });

  protected invalidWeight(w: number | null): boolean {
    return w !== null && !(Number.isFinite(w) && w >= 1);
  }

  protected fmt(w: number | null): number | string {
    return w !== null && Number.isFinite(w) ? w : '';
  }

  protected rowHasEdges(d: number): boolean {
    return this.t().cost[d].some((w) => w !== null);
  }

  protected value(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }
}
