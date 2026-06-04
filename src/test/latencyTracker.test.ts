import * as assert from 'assert';
import { LatencyTracker } from '../telemetry/latencyTracker';

suite('LatencyTracker', () => {
  let tracker: LatencyTracker;

  setup(() => {
    tracker = LatencyTracker.getInstance();
    tracker.clear();
  });

  test('deve iniciar sem amostras', () => {
    const summary = tracker.getSummary();
    assert.strictEqual(summary.count, 0);
    assert.strictEqual(summary.avgTotalMs, 0);
  });

  test('deve registrar e recuperar amostras', () => {
    tracker.record({
      timestamp: Date.now(),
      contextMs: 5,
      inferenceMs: 200,
      totalMs: 205,
      tokensGenerated: 15,
      nodeType: 'function_declaration',
    });

    tracker.record({
      timestamp: Date.now(),
      contextMs: 3,
      inferenceMs: 150,
      totalMs: 153,
      tokensGenerated: 10,
      nodeType: 'variable_declarator',
    });

    const samples = tracker.getSamples();
    assert.strictEqual(samples.length, 2);
  });

  test('deve calcular estatísticas corretamente', () => {
    tracker.record({
      timestamp: Date.now(),
      contextMs: 10,
      inferenceMs: 100,
      totalMs: 110,
      tokensGenerated: 20,
      nodeType: 'test',
    });

    tracker.record({
      timestamp: Date.now(),
      contextMs: 20,
      inferenceMs: 200,
      totalMs: 220,
      tokensGenerated: 30,
      nodeType: 'test',
    });

    const summary = tracker.getSummary();
    assert.strictEqual(summary.count, 2);
    assert.strictEqual(summary.avgTotalMs, 165);    // (110 + 220) / 2
    assert.strictEqual(summary.avgContextMs, 15);    // (10 + 20) / 2
    assert.strictEqual(summary.avgInferenceMs, 150); // (100 + 200) / 2
    assert.strictEqual(summary.avgTokens, 25);       // (20 + 30) / 2
  });

  test('deve respeitar o limite de amostras (buffer circular)', () => {
    // O limite é 200, inserir 205 amostras
    for (let i = 0; i < 205; i++) {
      tracker.record({
        timestamp: Date.now(),
        contextMs: 1,
        inferenceMs: i,
        totalMs: i + 1,
        tokensGenerated: 1,
        nodeType: 'test',
      });
    }
    assert.strictEqual(tracker.getSamples().length, 200);
  });

  test('deve formatar resumo legível', () => {
    tracker.record({
      timestamp: Date.now(),
      contextMs: 5,
      inferenceMs: 100,
      totalMs: 105,
      tokensGenerated: 10,
      nodeType: 'test',
    });

    const formatted = tracker.formatSummary();
    assert.ok(formatted.includes('Telemetria'));
    assert.ok(formatted.includes('105ms'));
  });

  test('deve retornar mensagem quando vazio', () => {
    const formatted = tracker.formatSummary();
    assert.ok(formatted.includes('Nenhuma amostra'));
  });
});
