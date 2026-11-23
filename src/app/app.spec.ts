import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { TopologyStore } from './services/topology.store';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });

  it('renderiza el título y la matriz del ejemplo', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Optimización de difusión');
    // 3 difusores + fila "+ Difusor"
    expect(el.querySelectorAll('app-cost-matrix tbody tr').length).toBe(4);
  });

  it('calcula sólo al presionar el botón y muestra el costo', async () => {
    const fixture = TestBed.createComponent(App);
    const store = TestBed.inject(TopologyStore);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(store.run().status).toBe('idle');

    const button = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Calcular'),
    )!;
    button.click();
    await new Promise((r) => setTimeout(r, 50));
    await fixture.whenStable();

    const run = store.run();
    expect(run.status).toBe('done');
    if (run.status === 'done') expect(run.solution.total).toBe(7); // broadcast por defecto
    expect(el.querySelector('app-result-panel')?.textContent).toContain('7');
  });

  it('marca el resultado como desactualizado al cambiar el modo', async () => {
    const store = TestBed.inject(TopologyStore);
    await store.calculate();
    expect(store.freshResult()).not.toBeNull();
    store.mode.set('select');
    expect(store.isStale()).toBe(true);
  });

  it('deshabilita Calcular cuando la topología no cumple las reglas', async () => {
    const fixture = TestBed.createComponent(App);
    const store = TestBed.inject(TopologyStore);
    store.setSourceCost(0, '0');
    await fixture.whenStable();
    const button = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
      (b) => b.textContent?.includes('Calcular'),
    )!;
    expect(button.disabled).toBe(true);
  });
});
