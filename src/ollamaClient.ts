import { IResolvedModel } from './domain/modelTypes';
import { PromptFormatter } from './infrastructure/promptFormatter';

export interface GenerateOptions {
  maxTokens: number;
  temperature: number;
  repeatPenalty: number;
  stop?: string[];
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class OllamaClient {
  private abortController: AbortController | null = null;
  private activeModel: IResolvedModel | null = null;
  private chatModel: string = 'qwen2.5-coder:1.5b-instruct';

  constructor(
    private endpoint: string = 'http://localhost:11434',
    private model: string = 'qwen2.5-coder:1.5b-base',
    chatModel?: string
  ) {
    this.chatModel = chatModel || model;
  }

  setActiveModel(resolved: IResolvedModel) {
    this.activeModel = resolved;
    this.model = resolved.modelName;
  }

  getActiveModel(): IResolvedModel | null {
    return this.activeModel;
  }

  // Permite atualizar as configurações dinamicamente quando mudam no editor
  updateConfig(endpoint: string, model: string, chatModel?: string) {
    this.endpoint = endpoint;
    this.model = model;
    this.chatModel = chatModel || model;
  }

  /**
   * Verifica se o servidor do Ollama está acessível.
   */
  async checkConnection(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch(`${this.endpoint}/api/tags`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      clearTimeout(timeout);
      return false;
    }
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

    const profile = this.activeModel?.profile;
    const temperature = options?.temperature ?? 0.0;
    const repeatPenalty = options?.repeatPenalty ?? 1.2;
    const numPredict = options?.maxTokens ?? profile?.capabilities.recommendedNumPredict ?? maxTokens;
    const requiresRaw = profile?.capabilities.requiresRaw ?? true;
    const stopSequences = [
      ...(profile?.capabilities.requiresStop || []),
      ...(options?.stop || [])
    ];

    const isFimSupported = profile?.capabilities.supportsFim ?? true;
    const prompt = isFimSupported && profile
      ? PromptFormatter.formatFim({ prefix, suffix }, profile.sentinels)
      : PromptFormatter.formatChatFallback({ prefix, suffix });

    try {
      const url = `${this.endpoint}/api/generate`;
      console.log(`Calling Ollama API at ${url} with model ${this.model}`);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          raw: requiresRaw,
          stream: false,
          options: {
            num_predict: numPredict,
            temperature: temperature,
            top_p: 0.9,
            repeat_penalty: repeatPenalty,
            stop: stopSequences.length > 0 ? stopSequences : undefined,
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

    const profile = this.activeModel?.profile;
    const temperature = options?.temperature ?? 0.0;
    const repeatPenalty = options?.repeatPenalty ?? 1.2;
    const numPredict = options?.maxTokens ?? profile?.capabilities.recommendedNumPredict ?? 20;
    const requiresRaw = profile?.capabilities.requiresRaw ?? true;
    const stopSequences = [
      ...(profile?.capabilities.requiresStop || []),
      ...(options?.stop || [])
    ];

    const isFimSupported = profile?.capabilities.supportsFim ?? true;
    const prompt = isFimSupported && profile
      ? PromptFormatter.formatFim({ prefix, suffix }, profile.sentinels)
      : PromptFormatter.formatChatFallback({ prefix, suffix });

    try {
      const url = `${this.endpoint}/api/generate`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          raw: requiresRaw,
          stream: true,
          options: {
            num_predict: numPredict,
            temperature: temperature,
            top_p: 0.9,
            repeat_penalty: repeatPenalty,
            stop: stopSequences.length > 0 ? stopSequences : undefined,
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

  /**
   * Geração para tarefas de instrução/chat síncronas.
   */
  async generateInstruction(prompt: string, systemPrompt?: string): Promise<string | undefined> {
    try {
      const url = `${this.endpoint}/api/generate`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          system: systemPrompt,
          stream: false,
          options: {
            temperature: 0.1,
          }
        }),
      });

      if (!response.ok) {
        console.error(`Ollama instruction error: ${response.status} - ${response.statusText}`);
        return undefined;
      }

      const data = (await response.json()) as { response: string };
      return data.response;
    } catch (error) {
      console.error('[OllamaClient] Instruction generation failed:', error);
      return undefined;
    }
  }

  /**
   * Geração livre de stream de tokens (usado para Chat e Explicações).
   * Retorna um AsyncGenerator que entrega os tokens à medida que chegam.
   */
  async *generateStream(prompt: string, systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    try {
      const url = `${this.endpoint}/api/generate`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          system: systemPrompt,
          stream: true,
          options: {
            temperature: 0.2,
          }
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama stream error: ${response.status} - ${response.statusText}`);
      }

      const body = response.body;
      if (!body) {
        return;
      }

      const reader = body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }

          try {
            const chunk = JSON.parse(trimmed) as { response?: string; done?: boolean };
            if (chunk.response) {
              yield chunk.response;
            }
          } catch {
            // Ignorar erros de parse NDJSON parcial
          }
        }
      }
    } catch (error) {
      console.error('[OllamaClient] Stream libre failed:', error);
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

  /**
   * Geração de stream usando a API de Chat (/api/chat) do Ollama.
   * Retorna os chunks de resposta à medida que são gerados.
   */
  async *generateChatStream(messages: ChatMessage[]): AsyncGenerator<string, void, unknown> {
    try {
      const url = `${this.endpoint}/api/chat`;
      const modelToUse = this.chatModel || this.model;
      
      console.log(`[OllamaClient] Calling Chat API at ${url} with model ${modelToUse}`);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelToUse,
          messages: messages,
          stream: true,
          options: {
            temperature: 0.5,
          }
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama chat stream error: ${response.status} - ${response.statusText}`);
      }

      const body = response.body;
      if (!body) {
        return;
      }

      const reader = body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }

          try {
            const chunk = JSON.parse(trimmed) as { message?: { content?: string }; done?: boolean };
            if (chunk.message && chunk.message.content) {
              yield chunk.message.content;
            }
          } catch {
            // Ignorar erros de parse NDJSON parcial
          }
        }
      }
    } catch (error) {
      console.error('[OllamaClient] Chat stream failed:', error);
    }
  }
}
