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

  async generateWithFIM(
    prefix: string,
    suffix: string,
    maxTokens: number = 20
  ): Promise<string | undefined> {
    // Cancelar requisição anterior se ainda estiver em progresso
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();

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
            num_predict: maxTokens,
            temperature: 0.0,
            top_p: 0.9,
            repeat_penalty: 1.2,
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
