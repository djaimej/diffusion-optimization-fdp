import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  NgbDropdown,
  NgbDropdownItem,
  NgbDropdownMenu,
  NgbDropdownToggle,
  NgbTooltip,
} from '@ng-bootstrap/ng-bootstrap';
import { CostMode, EXACT_LIMIT } from '@core/diffusion-solver';
import { CostMatrix } from './components/cost-matrix/cost-matrix';
import { GraphView } from './components/graph-view/graph-view';
import { ResultPanel } from './components/result-panel/result-panel';
import { MAX_DIFFUSERS, MAX_PASSIVES, TopologyStore } from './services/topology.store';

@Component({
  selector: 'app-root',
  imports: [
    CostMatrix,
    GraphView,
    ResultPanel,
    NgbTooltip,
    NgbDropdown,
    NgbDropdownToggle,
    NgbDropdownMenu,
    NgbDropdownItem,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly store = inject(TopologyStore);
  protected readonly importError = signal<string | null>(null);

  protected readonly EXACT_LIMIT = EXACT_LIMIT;
  protected readonly MAX_DIFFUSERS = MAX_DIFFUSERS;
  protected readonly MAX_PASSIVES = MAX_PASSIVES;
  protected readonly randomPresets = [
    { D: 5, P: 8 },
    { D: 12, P: 25 },
    { D: 20, P: 50 },
    { D: 40, P: 100 },
  ];

  protected setMode(mode: CostMode): void {
    this.store.mode.set(mode);
  }

  protected exportJson(): void {
    const blob = new Blob([JSON.stringify(this.store.toFile(), null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'topologia.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  protected async importJson(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      this.store.loadFile(JSON.parse(await file.text()));
      this.importError.set(null);
    } catch (err) {
      this.importError.set((err as Error).message || 'No se pudo leer el archivo.');
    }
  }
}
