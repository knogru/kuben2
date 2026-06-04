import { IFimSentinels } from '../domain/modelTypes';

export interface FimPayload {
  prefix: string;
  suffix: string;
  isSpmFormat?: boolean;
}

export class PromptFormatter {
  /**
   * Formata a requisição FIM com base nos tokens sentinelas do modelo.
   */
  public static formatFim(payload: FimPayload, sentinels: IFimSentinels): string {
    if (payload.isSpmFormat) {
      // SPM: Suffix-Prefix-Middle
      return `${sentinels.prefix}${sentinels.suffix}${payload.suffix}${sentinels.prefix}${payload.prefix}${sentinels.middle}`;
    }
    // PSM: Prefix-Suffix-Middle (padrão)
    return `${sentinels.prefix}${payload.prefix}${sentinels.suffix}${payload.suffix}${sentinels.middle}`;
  }

  /**
   * Fallback para modelos que não suportam FIM nativo (instruct-only).
   * Usa prompt estruturado simulando FIM.
   */
  public static formatChatFallback(payload: FimPayload): string {
    return [
      'Complete the following code. Output ONLY the code that goes in the gap, nothing else.',
      '```',
      payload.prefix + '[CURSOR]' + payload.suffix,
      '```'
    ].join('\n');
  }
}
