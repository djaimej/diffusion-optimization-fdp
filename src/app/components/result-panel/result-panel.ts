import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import {
  NgbNav,
  NgbNavContent,
  NgbNavItem,
  NgbNavLinkButton,
  NgbNavOutlet,
} from '@ng-bootstrap/ng-bootstrap';
import { TopologyStore } from '../../services/topology.store';

interface DiffuserRow {
  name: string;
  source: number;
  delivery: number;
  passives: string[];
}

interface PassiveRow {
  name: string;
  /** Difusores de la solución que le entregan, con su costo. */
  from: { name: string; w: number }[];
}

@Component({
  selector: 'app-result-panel',
  imports: [DecimalPipe, NgbNav, NgbNavItem, NgbNavLinkButton, NgbNavContent, NgbNavOutlet],
  templateUrl: './result-panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResultPanel {
  protected readonly store = inject(TopologyStore);

  /** Último resultado calculado (aunque esté desactualizado). */
  protected readonly result = computed(() => {
    const r = this.store.run();
    return r.status === 'done' ? r : null;
  });

  protected readonly breakdown = computed(() => {
    const r = this.result();
    if (!r) return null;
    const { solution: s, topology: t, mode } = r;

    const diffusers: DiffuserRow[] = s.diffusers.map((d) => {
      const served =
        mode === 'select'
          ? s.assignment.map((a, p) => (a === d ? p : -1)).filter((p) => p >= 0)
          : t.cost[d].map((w, p) => (w !== null ? p : -1)).filter((p) => p >= 0);
      return {
        name: t.diffusers[d],
        source: t.sourceCost[d],
        delivery: served.reduce((sum, p) => sum + (t.cost[d][p] as number), 0),
        passives: served.map((p) => t.passives[p]),
      };
    });

    const passives: PassiveRow[] = t.passives.map((name, p) => ({
      name,
      from:
        mode === 'select'
          ? [{ name: t.diffusers[s.assignment[p]], w: t.cost[s.assignment[p]][p] as number }]
          : s.diffusers
            .filter((d) => t.cost[d][p] !== null)
            .map((d) => ({ name: t.diffusers[d], w: t.cost[d][p] as number })),
    }));

    return { diffusers, passives };
  });
}
