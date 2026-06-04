/**
 * Famílias de modelos com suporte FIM nativo verificado.
 */
export type TModelFamily =
  | 'qwen'
  | 'deepseek'
  | 'codellama'
  | 'starcoder'
  | 'codegemma'
  | 'phi'
  | 'generic_fim'   // tokens genéricos padrão, sem garantia de qualidade
  | 'chat_only';    // sem FIM — usa prompt de chat como fallback

export interface IFimSentinels {
  readonly prefix: string;
  readonly suffix: string;
  readonly middle: string;
  readonly eot: string;       // token de fim de geração esperado
}

export interface IModelCapabilities {
  readonly supportsFim: boolean;
  readonly supportsStreaming: boolean;
  readonly maxContextTokens: number;
  readonly recommendedNumPredict: number;   // para inline completion (curto)
  readonly recommendedNumPredictBlock: number; // para block completion (longo)
  readonly requiresRaw: boolean;            // raw:true para preservar tokens FIM
  readonly requiresStop: readonly string[]; // stop sequences adicionais
}

export interface IModelProfile {
  readonly family: TModelFamily;
  readonly sentinels: IFimSentinels;
  readonly capabilities: IModelCapabilities;
  readonly detectionPatterns: readonly RegExp[]; // padrões de nome para auto-detecção
}

export type TModelResolutionSource = 'registry' | 'ollama_metadata' | 'user_override' | 'fallback';

export interface IResolvedModel {
  readonly modelName: string;
  readonly profile: IModelProfile;
  readonly source: TModelResolutionSource;
}
