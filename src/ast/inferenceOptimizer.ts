import { ASTManager } from './astManager';

/**
 * Parâmetros de inferência ajustados dinamicamente com base no contexto AST.
 */
export interface InferenceParams {
  maxTokens: number;
  temperature: number;
  repeatPenalty: number;
}

/**
 * Analisa o nó AST sob o cursor e retorna parâmetros de inferência otimizados.
 *
 * A ideia central é: contextos simples (completar o nome de uma variável ou
 * uma assinatura curta) precisam de poucos tokens e temperatura zero.
 * Contextos mais complexos (corpo de função, bloco condicional) podem se
 * beneficiar de mais tokens e uma temperatura levemente maior.
 */
export class InferenceOptimizer {

  /**
   * Determina os parâmetros ideais de inferência com base na posição do cursor
   * dentro da árvore sintática do documento.
   *
   * @param languageId  - ID da linguagem do VSCode (ex: 'typescript')
   * @param code        - Código completo do documento
   * @param cursorLine  - Linha do cursor (0-based)
   * @param cursorCol   - Coluna do cursor (0-based)
   * @param defaultMax  - Valor padrão de maxTokens configurado pelo usuário
   */
  public static resolve(
    languageId: string,
    code: string,
    cursorLine: number,
    cursorCol: number,
    defaultMax: number
  ): InferenceParams {
    const astManager = ASTManager.getInstance();

    // Se o AST não estiver pronto, retorna os padrões sem otimização
    if (!astManager.isReady()) {
      return { maxTokens: defaultMax, temperature: 0.0, repeatPenalty: 1.2 };
    }

    const tree = astManager.parse(languageId, code);
    if (!tree) {
      return { maxTokens: defaultMax, temperature: 0.0, repeatPenalty: 1.2 };
    }

    // Encontrar o nó mais específico (folha) na posição do cursor
    const node = tree.rootNode.descendantForPosition({
      row: cursorLine,
      column: cursorCol
    });

    if (!node) {
      return { maxTokens: defaultMax, temperature: 0.0, repeatPenalty: 1.2 };
    }

    // Subir pela árvore para encontrar o contexto semântico mais relevante
    const contextNode = InferenceOptimizer.findContextNode(node);
    const nodeType = contextNode ? contextNode.type : node.type;

    return InferenceOptimizer.paramsForNodeType(nodeType, defaultMax);
  }

  /**
   * Sobe pela árvore AST a partir do nó folha até encontrar um nó de contexto
   * significativo (declaração de função, classe, bloco, etc.).
   */
  private static findContextNode(node: { type: string; parent: typeof node | null }): { type: string } | null {
    const contextTypes = new Set([
      // Declarações de alto nível
      'function_declaration',
      'method_definition',
      'class_declaration',
      'arrow_function',
      'generator_function_declaration',
      // Blocos de controle
      'if_statement',
      'for_statement',
      'for_in_statement',
      'while_statement',
      'switch_statement',
      'try_statement',
      // Expressões de atribuição e chamada
      'variable_declarator',
      'assignment_expression',
      'call_expression',
      'return_statement',
      // Containers
      'statement_block',
      'object',
      'array',
      // Imports
      'import_statement',
      'export_statement',
    ]);

    let current: typeof node | null = node;
    while (current) {
      if (contextTypes.has(current.type)) {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  /**
   * Mapeia o tipo de nó AST para parâmetros de inferência otimizados.
   */
  private static paramsForNodeType(nodeType: string, defaultMax: number): InferenceParams {
    // Contextos que exigem completions curtas (nomes, assinaturas)
    const shortContexts = new Set([
      'variable_declarator',
      'assignment_expression',
      'call_expression',
      'import_statement',
      'export_statement',
      'return_statement',
    ]);

    // Contextos que exigem completions médias (blocos de controle)
    const mediumContexts = new Set([
      'if_statement',
      'for_statement',
      'for_in_statement',
      'while_statement',
      'switch_statement',
      'try_statement',
      'arrow_function',
    ]);

    // Contextos que exigem completions longas (corpos de função/classe)
    const longContexts = new Set([
      'function_declaration',
      'method_definition',
      'class_declaration',
      'generator_function_declaration',
      'statement_block',
    ]);

    if (shortContexts.has(nodeType)) {
      return {
        maxTokens: Math.min(defaultMax, 15),
        temperature: 0.0,
        repeatPenalty: 1.2,
      };
    }

    if (mediumContexts.has(nodeType)) {
      return {
        maxTokens: Math.min(Math.max(defaultMax, 25), 40),
        temperature: 0.0,
        repeatPenalty: 1.15,
      };
    }

    if (longContexts.has(nodeType)) {
      return {
        maxTokens: Math.min(Math.max(defaultMax, 35), 60),
        temperature: 0.1,
        repeatPenalty: 1.1,
      };
    }

    // Fallback: manter o padrão do usuário
    return { maxTokens: defaultMax, temperature: 0.0, repeatPenalty: 1.2 };
  }
}
