export interface GenerateOptions {
  maxTokens: number;
  temperature: number;
  repeatPenalty: number;
}

export class OllamaClient {
  private abortController: AbortController | null = null;

  constructor(
    private endpoint: string = 'http://localhost:11434',
    private model: string = 'qwen2.5-coder:1.5b-base'
  ) {}

  // Permite atualizar as configurações dinamicamente quando mudam no editor
  updateConfig(endpoint: string, model: string) {
    this.endpoint = endpoint;
    this.model = model;
  }

  /**
   * Geração FIM síncrona (sem streaming) — mantida para compatibilidade.
   * Aceita opções dinâmicas de inferência vindas do InferenceOptimizer.
   */
  async generateWithFIM(
    prefix: string,
    suffix: string,
    maxTokens: number = 20,
    options?: Partial<GenerateOptions>
  ): Promise<string | undefined> {
    // Cancelar requisição anterior se ainda estiver em progresso
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();

    const temperature = options?.temperature ?? 0.0;
    const repeatPenalty = options?.repeatPenalty ?? 1.2;
    const numPredict = options?.maxTokens ?? maxTokens;

    // Formato FIM (Fill-in-the-Middle) padrão para Qwen e CodeGemma
    const prompt = `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;

    try {
      const url = `${this.endpoint}/api/generate`;
      console.log(`Calling Ollama API at ${url} with model ${this.model}`);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          stream: false,
          options: {
            num_predict: numPredict,
            temperature: temperature,
            top_p: 0.9,
            repeat_penalty: repeatPenalty,
          }
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        console.error(`Ollama error: ${response.status} - ${response.statusText}`);
        return undefined;
      }

      const data = (await response.json()) as { response: string };
      console.log(`[OllamaClient] Raw response: "${data.response}"`);
      const cleaned = this.cleanCompletion(data.response);
      console.log(`[OllamaClient] Cleaned response: "${cleaned}"`);
      return cleaned;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Request cancelled');
      } else {
        console.error('Generation failed:', error);
      }
      return undefined;
    }
  }

  /**
   * Geração FIM com streaming de tokens via NDJSON do Ollama.
   * Retorna a string completa acumulada após o fim do stream.
   * Permite cancelamento imediato se o usuário continuar digitando.
   */
  async generateWithFIMStream(
    prefix: string,
    suffix: string,
    options?: Partial<GenerateOptions>
  ): Promise<string | undefined> {
    // Cancelar requisição anterior se ainda estiver em progresso
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();

    const numPredict = options?.maxTokens ?? 20;
    const temperature = options?.temperature ?? 0.0;
    const repeatPenalty = options?.repeatPenalty ?? 1.2;

    const prompt = `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;

    try {
      const url = `${this.endpoint}/api/generate`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          stream: true,
          options: {
            num_predict: numPredict,
            temperature: temperature,
            top_p: 0.9,
            repeat_penalty: repeatPenalty,
          }
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        console.error(`Ollama stream error: ${response.status} - ${response.statusText}`);
        return undefined;
      }

      // Processar NDJSON stream (cada linha é um JSON com { response: "token", done: bool })
      const body = response.body;
      if (!body) {
        return undefined;
      }

      const reader = body.getReader();
      const decoder = new TextDecoder('utf-8');
      let accumulated = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Separar por linhas, pois o Ollama envia NDJSON (um JSON por linha)
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // A última parte pode estar incompleta

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }

          try {
            const chunk = JSON.parse(trimmed) as { response?: string; done?: boolean };
            if (chunk.response) {
              accumulated += chunk.response;
            }
            if (chunk.done) {
              // Stream concluído pelo servidor
              const cleaned = this.cleanCompletion(accumulated);
              console.log(`[OllamaClient] Stream concluído. Resultado: "${cleaned}"`);
              return cleaned;
            }
          } catch {
            // Ignorar linhas JSON malformadas silenciosamente
          }
        }
      }

      // Se saiu do loop sem um done explícito, limpar o que temos
      const cleaned = this.cleanCompletion(accumulated);
      return cleaned;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[OllamaClient] Stream cancelled');
      } else {
        console.error('[OllamaClient] Stream generation failed:', error);
      }
      return undefined;
    }
  }

  // Filtra a resposta para extrair apenas código, descartando prosa e markdown
  private cleanCompletion(response: string): string | undefined {
    // Detectar alucinação cirílica (russo) comum em modelos pequenos como Qwen fora de contexto
    if (/[\u0400-\u04FF]/.test(response)) {
      console.log('[OllamaClient] Descartada resposta com caracteres cirílicos (alucinação do Qwen).');
      return undefined;
    }

    const lines = response.split('\n');
    const codeLines: string[] = [];
    let foundCode = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Pular linhas em branco antes do código começar
      if (!foundCode && trimmed === '') continue;

      // Ignorar markdown code fences
      if (trimmed.startsWith('```')) continue;

      // Detectar se a linha parece prosa (começa com maiúscula e termina com pontuação)
      const isProse = /^[A-Z].*[.!?:]$/.test(trimmed);
      if (isProse && !foundCode) continue;

      // A partir daqui é código
      foundCode = true;
      codeLines.push(line);

      // Parar após 5 linhas de código
      if (codeLines.length >= 5) break;
    }

    const result = codeLines.join('\n').trimEnd();
    return result || undefined;
  }
}
