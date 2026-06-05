import { ChatMessage } from '../ollamaClient';

export class ContextOptimizer {
  /**
   * Remove ruídos do código para poupar tokens de modelos pequenos.
   * Remove espaços excessivos, quebras de linha múltiplas e logs padrão.
   */
  public static minifyCode(code: string): string {
    return code
      // Remove console.logs simples (opcional, mas bom para contexto bruto)
      .replace(/console\.log\([^)]*\);?/g, '')
      // Remove múltiplas quebras de linha consecutivas
      .replace(/\n\s*\n/g, '\n')
      // Remove espaços duplos
      .replace(/ {2,}/g, ' ')
      .trim();
  }

  /**
   * Comprime o histórico do chat.
   * Modelos de 1.5B enlouquecem com históricos longos. 
   * Mantém o System Prompt intacto e preserva apenas os últimos N turnos relevantes.
   * Remove os turnos intermediários de Tool Calling para poupar tokens de memória.
   */
  public static compressHistory(history: ChatMessage[], maxTurns: number = 4): ChatMessage[] {
    if (history.length <= maxTurns) {
      return history;
    }

    const systemPrompt = history.find(m => m.role === 'system');
    // Pegar apenas as últimas N mensagens
    const recentMessages = history.slice(-maxTurns);

    // Filtrar tool calls e resultados antigos que não importam mais para o contexto
    // (Preserva apenas se for a resposta imediatamente anterior)
    const cleanMessages = recentMessages.filter((msg, index) => {
      // Se for a última mensagem, mantenha
      if (index === recentMessages.length - 1) return true;
      
      // Se for um resultado de ferramenta antigo, descarte para poupar tokens
      if (msg.role === 'user' && msg.content.includes('[Resultado da Ferramenta]')) {
        return false;
      }
      return true;
    });

    const compressed = [];
    if (systemPrompt && cleanMessages[0]?.role !== 'system') {
      compressed.push(systemPrompt);
    }
    
    compressed.push(...cleanMessages);
    return compressed;
  }
}
