/**
 * Sistema de telemetria local de latência para auditoria de desempenho.
 * Armazena amostras em memória volátil (não persiste em disco).
 */
export interface LatencySample {
  timestamp: number;
  contextMs: number;    // Tempo gasto montando o contexto (AST + Graph RAG)
  inferenceMs: number;  // Tempo gasto na chamada ao Ollama
  totalMs: number;      // Tempo total do pipeline
  tokensGenerated: number;
  nodeType: string;     // Tipo de nó AST sob o cursor
}

export class LatencyTracker {
  private static instance: LatencyTracker | null = null;
  private samples: LatencySample[] = [];
  private readonly maxSamples = 200;

  private constructor() {}

  public static getInstance(): LatencyTracker {
    if (!LatencyTracker.instance) {
      LatencyTracker.instance = new LatencyTracker();
    }
    return LatencyTracker.instance;
  }

  /**
   * Registra uma amostra de latência.
   */
  public record(sample: LatencySample): void {
    this.samples.push(sample);
    // Manter o buffer circular para evitar consumo de memória crescente
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  /**
   * Retorna todas as amostras armazenadas.
   */
  public getSamples(): readonly LatencySample[] {
    return this.samples;
  }

  /**
   * Retorna um resumo estatístico das últimas N amostras.
   */
  public getSummary(lastN?: number): {
    count: number;
    avgTotalMs: number;
    avgContextMs: number;
    avgInferenceMs: number;
    p50TotalMs: number;
    p95TotalMs: number;
    avgTokens: number;
  } {
    const subset = lastN ? this.samples.slice(-lastN) : this.samples;
    const count = subset.length;

    if (count === 0) {
      return {
        count: 0,
        avgTotalMs: 0,
        avgContextMs: 0,
        avgInferenceMs: 0,
        p50TotalMs: 0,
        p95TotalMs: 0,
        avgTokens: 0,
      };
    }

    const totals = subset.map(s => s.totalMs).sort((a, b) => a - b);
    const sumTotal = subset.reduce((a, s) => a + s.totalMs, 0);
    const sumContext = subset.reduce((a, s) => a + s.contextMs, 0);
    const sumInference = subset.reduce((a, s) => a + s.inferenceMs, 0);
    const sumTokens = subset.reduce((a, s) => a + s.tokensGenerated, 0);

    const p50Index = Math.floor(count * 0.5);
    const p95Index = Math.min(Math.floor(count * 0.95), count - 1);

    return {
      count,
      avgTotalMs: Math.round(sumTotal / count),
      avgContextMs: Math.round(sumContext / count),
      avgInferenceMs: Math.round(sumInference / count),
      p50TotalMs: totals[p50Index],
      p95TotalMs: totals[p95Index],
      avgTokens: Math.round(sumTokens / count),
    };
  }

  /**
   * Formata o resumo para exibição legível pelo usuário.
   */
  public formatSummary(lastN?: number): string {
    const s = this.getSummary(lastN);
    if (s.count === 0) {
      return 'Nenhuma amostra de latência coletada ainda.';
    }

    return [
      `📊 Telemetria de Latência (últimas ${s.count} amostras)`,
      `─────────────────────────────────────`,
      `  Total médio:       ${s.avgTotalMs}ms`,
      `  Contexto médio:    ${s.avgContextMs}ms`,
      `  Inferência média:  ${s.avgInferenceMs}ms`,
      `  P50 (mediana):     ${s.p50TotalMs}ms`,
      `  P95:               ${s.p95TotalMs}ms`,
      `  Tokens médios:     ${s.avgTokens}`,
    ].join('\n');
  }

  /**
   * Limpa todas as amostras.
   */
  public clear(): void {
    this.samples = [];
  }
}
