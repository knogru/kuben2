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
  private provider: string = 'ollama';
  private apiKey: string = '';

  constructor(
    private endpoint: string = 'http://localhost:11434',
    private model: string = 'qwen2.5-coder:1.5b-base',
    chatModel?: string,
    provider: string = 'ollama',
    apiKey: string = ''
  ) {
    this.chatModel = chatModel || model;
    this.provider = provider;
    this.apiKey = apiKey;
  }

  setActiveModel(resolved: IResolvedModel) {
    this.activeModel = resolved;
    this.model = resolved.modelName;
  }

  getActiveModel(): IResolvedModel | null {
    return this.activeModel;
  }

  updateConfig(endpoint: string, model: string, chatModel?: string, provider: string = 'ollama', apiKey: string = '') {
    this.endpoint = endpoint;
    this.model = model;
    this.chatModel = chatModel || model;
    this.provider = provider;
    this.apiKey = apiKey;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  async checkConnection(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const url = this.provider === 'openai' ? `${this.endpoint}/models` : `${this.endpoint}/api/tags`;
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      clearTimeout(timeout);
      return false;
    }
  }

  async generateWithFIM(
    prefix: string,
    suffix: string,
    maxTokens: number = 20,
    options?: Partial<GenerateOptions>
  ): Promise<string | undefined> {
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

    // Limpeza inteligente de contexto para modelos locais (maximizando velocidade e relevância)
    const MAX_FIM_LENGTH = 3500;
    const safePrefix = prefix.length > MAX_FIM_LENGTH ? prefix.slice(-MAX_FIM_LENGTH) : prefix;
    const safeSuffix = suffix.length > MAX_FIM_LENGTH ? suffix.slice(0, MAX_FIM_LENGTH) : suffix;

    const isFimSupported = profile?.capabilities.supportsFim ?? true;
    const isSpm = profile?.capabilities.preferredFormat === 'spm';
    const prompt = isFimSupported && profile
      ? PromptFormatter.formatFim({ prefix: safePrefix, suffix: safeSuffix, isSpmFormat: isSpm }, profile.sentinels)
      : PromptFormatter.formatChatFallback({ prefix: safePrefix, suffix: safeSuffix });

    try {
      const isOllama = this.provider === 'ollama';
      const url = isOllama ? `${this.endpoint}/api/generate` : `${this.endpoint}/completions`;
      
      const payload = isOllama ? {
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
      } : {
        model: this.model,
        prompt: prompt,
        max_tokens: numPredict,
        temperature: temperature,
        top_p: 0.9,
        frequency_penalty: repeatPenalty > 1 ? (repeatPenalty - 1) : 0,
        stop: stopSequences.length > 0 ? stopSequences : undefined,
        stream: false
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        return undefined;
      }

      const data = await response.json() as any;
      const responseText = isOllama ? data.response : (data.choices?.[0]?.text || '');
      return this.cleanCompletion(responseText);
    } catch (error) {
      return undefined;
    }
  }

  async generateWithFIMStream(
    prefix: string,
    suffix: string,
    options?: Partial<GenerateOptions>
  ): Promise<string | undefined> {
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

    // Limpeza inteligente de contexto para modelos locais (maximizando velocidade e relevância)
    const MAX_FIM_LENGTH = 3500;
    const safePrefix = prefix.length > MAX_FIM_LENGTH ? prefix.slice(-MAX_FIM_LENGTH) : prefix;
    const safeSuffix = suffix.length > MAX_FIM_LENGTH ? suffix.slice(0, MAX_FIM_LENGTH) : suffix;

    const isFimSupported = profile?.capabilities.supportsFim ?? true;
    const isSpm = profile?.capabilities.preferredFormat === 'spm';
    const prompt = isFimSupported && profile
      ? PromptFormatter.formatFim({ prefix: safePrefix, suffix: safeSuffix, isSpmFormat: isSpm }, profile.sentinels)
      : PromptFormatter.formatChatFallback({ prefix: safePrefix, suffix: safeSuffix });

    try {
      const isOllama = this.provider === 'ollama';
      const url = isOllama ? `${this.endpoint}/api/generate` : `${this.endpoint}/completions`;

      const payload = isOllama ? {
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
      } : {
        model: this.model,
        prompt: prompt,
        max_tokens: numPredict,
        temperature: temperature,
        top_p: 0.9,
        stop: stopSequences.length > 0 ? stopSequences : undefined,
        stream: true
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
        signal: this.abortController.signal,
      });

      if (!response.ok) return undefined;

      const body = response.body;
      if (!body) return undefined;

      const reader = body.getReader();
      const decoder = new TextDecoder('utf-8');
      let accumulated = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (isOllama) {
            try {
              const chunk = JSON.parse(trimmed) as { response?: string; done?: boolean };
              if (chunk.response) accumulated += chunk.response;
              if (chunk.done) return this.cleanCompletion(accumulated);
            } catch {}
          } else {
            // OpenAI SSE parsing
            if (trimmed.startsWith('data: ')) {
              const dataStr = trimmed.slice(6);
              if (dataStr === '[DONE]') return this.cleanCompletion(accumulated);
              try {
                const chunk = JSON.parse(dataStr);
                const text = chunk.choices?.[0]?.text;
                if (text) accumulated += text;
                if (chunk.choices?.[0]?.finish_reason) return this.cleanCompletion(accumulated);
              } catch {}
            }
          }
        }
      }

      return this.cleanCompletion(accumulated);
    } catch (error) {
      return undefined;
    }
  }

  async generateInstruction(prompt: string, systemPrompt?: string): Promise<string | undefined> {
    try {
      const isOllama = this.provider === 'ollama';
      const url = isOllama ? `${this.endpoint}/api/generate` : `${this.endpoint}/chat/completions`;

      let payload: any;
      if (isOllama) {
        payload = {
          model: this.model,
          prompt: prompt,
          system: systemPrompt,
          stream: false,
          options: { 
            temperature: 0.1,
            top_p: 0.85,
            stop: ['</tool_call>']
          }
        };
      } else {
        const messages = [];
        if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
        messages.push({ role: 'user', content: prompt });
        payload = {
          model: this.model,
          messages: messages,
          temperature: 0.1,
          top_p: 0.85,
          stop: ['</tool_call>'],
          stream: false
        };
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) return undefined;
      const data = await response.json() as any;
      return isOllama ? data.response : (data.choices?.[0]?.message?.content || '');
    } catch (error) {
      return undefined;
    }
  }

  async *generateStream(prompt: string, systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    const messages: ChatMessage[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    yield* this.generateChatStream(messages);
  }

  async *generateChatStream(messages: ChatMessage[]): AsyncGenerator<string, void, unknown> {
    try {
      const isOllama = this.provider === 'ollama';
      const url = isOllama ? `${this.endpoint}/api/chat` : `${this.endpoint}/chat/completions`;
      const modelToUse = this.chatModel || this.model;
      
      const payload = isOllama ? {
        model: modelToUse,
        messages: messages,
        stream: true,
        options: { 
          temperature: 0.1,
          top_p: 0.85,
          stop: ['</tool_call>']
        }
      } : {
        model: modelToUse,
        messages: messages,
        stream: true,
        temperature: 0.1,
        top_p: 0.85,
        stop: ['</tool_call>']
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error(`Status: ${response.status}`);

      const body = response.body;
      if (!body) return;

      const reader = body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (isOllama) {
            try {
              const chunk = JSON.parse(trimmed) as { message?: { content?: string } };
              if (chunk.message?.content) yield chunk.message.content;
            } catch {}
          } else {
            // OpenAI SSE parsing
            if (trimmed.startsWith('data: ')) {
              const dataStr = trimmed.slice(6);
              if (dataStr === '[DONE]') return;
              try {
                const chunk = JSON.parse(dataStr);
                const content = chunk.choices?.[0]?.delta?.content;
                if (content) yield content;
              } catch {}
            }
          }
        }
      }
    } catch (error) {
      console.error('[OllamaClient] Chat stream failed:', error);
    }
  }

  private cleanCompletion(response: string): string | undefined {
    if (/[\u0400-\u04FF]/.test(response)) return undefined;

    const lines = response.split('\n');
    const codeLines: string[] = [];
    let foundCode = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!foundCode && trimmed === '') continue;
      if (trimmed.startsWith('```')) continue;

      const isProse = /^[A-Z].*[.!?:]$/.test(trimmed);
      if (isProse && !foundCode) continue;

      foundCode = true;
      codeLines.push(line);
      if (codeLines.length >= 5) break;
    }

    const result = codeLines.join('\n').trimEnd();
    return result || undefined;
  }
}
