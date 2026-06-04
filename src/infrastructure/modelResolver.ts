import { IResolvedModel, IModelProfile } from '../domain/modelTypes';
import { MODEL_REGISTRY, FALLBACK_PROFILE } from '../domain/modelRegistry';

export class ModelResolver {
  constructor(private readonly ollamaEndpoint: string) {}

  /**
   * Consulta GET /api/tags e retorna lista de modelos disponíveis no Ollama.
   */
  public async listAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.ollamaEndpoint}/api/tags`, {
        method: 'GET',
      });
      if (!response.ok) {
        return [];
      }
      const data = await response.json() as { models?: { name: string }[] };
      return data.models?.map(m => m.name) || [];
    } catch {
      return [];
    }
  }

  /**
   * Resolve o perfil completo de um modelo.
   * Ordem de prioridade:
   *   1. Override manual do usuário (se fornecido e != 'auto')
   *   2. Detecção por nome via registry
   *   3. Consulta /api/show (para metadata futura ou logs adicionais)
   *   4. Fallback para qwen
   */
  public async resolve(modelName: string, userOverride?: string): Promise<IResolvedModel> {
    // 1. Override manual do usuário
    if (userOverride && userOverride !== 'auto') {
      const matched = MODEL_REGISTRY.find(p => p.family === userOverride);
      if (matched) {
        console.log(`[ModelResolver] Perfil resolvido por override do usuário: ${matched.family}`);
        return {
          modelName,
          profile: matched,
          source: 'user_override',
        };
      }
    }

    // 2. Detecção por nome via registry
    const detectedProfile = this.detectFamily(modelName);
    if (detectedProfile) {
      console.log(`[ModelResolver] Perfil detectado por correspondência de padrão: ${detectedProfile.family}`);
      return {
        modelName,
        profile: detectedProfile,
        source: 'registry',
      };
    }

    // 3. Consulta opcional a /api/show
    const showMetadata = await this.fetchModelMetadata(modelName);
    if (showMetadata) {
      console.log(`[ModelResolver] Metadata probe para '${modelName}' concluída.`);
    }

    // 4. Fallback para qwen (melhor comportamento FIM genérico)
    console.warn(`[ModelResolver] Não foi possível resolver perfil para '${modelName}'. Usando fallback '${FALLBACK_PROFILE.family}'.`);
    return {
      modelName,
      profile: FALLBACK_PROFILE,
      source: 'fallback',
    };
  }

  /**
   * Consulta POST /api/show para o modelo especificado.
   */
  private async fetchModelMetadata(modelName: string): Promise<any | null> {
    try {
      const response = await fetch(`${this.ollamaEndpoint}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName }),
      });
      if (!response.ok) {
        return null;
      }
      return await response.json();
    } catch {
      return null;
    }
  }

  /**
   * Detecta a família correspondente ao nome do modelo.
   */
  private detectFamily(modelName: string): IModelProfile | null {
    for (const profile of MODEL_REGISTRY) {
      for (const pattern of profile.detectionPatterns) {
        if (pattern.test(modelName)) {
          return profile;
        }
      }
    }
    return null;
  }
}
