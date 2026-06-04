import * as vscode from 'vscode';

export interface TabSnippet {
  filePath: string;
  content: string;
  similarity: number;
}

export class OpenTabsAgent {
  private static instance: OpenTabsAgent | null = null;

  private constructor() {}

  public static getInstance(): OpenTabsAgent {
    if (!OpenTabsAgent.instance) {
      OpenTabsAgent.instance = new OpenTabsAgent();
    }
    return OpenTabsAgent.instance;
  }

  /**
   * Obtém snippets relevantes dos outros documentos abertos no workspace.
   * Classifica-os usando a similaridade Jaccard com o prefixo atual.
   * Operação síncrona/rápida, limitada para evitar gargalos.
   */
  public getRelevantSnippets(
    currentDocument: vscode.TextDocument,
    prefix: string,
    maxSnippets: number = 3,
    windowSizeLines: number = 15,
    stepLines: number = 10
  ): TabSnippet[] {
    const activeUri = currentDocument.uri.toString();
    const prefixTokens = this.tokenize(prefix);
    if (prefixTokens.size === 0) {
      return [];
    }

    const allSnippets: TabSnippet[] = [];

    // Obter todos os documentos de texto abertos no VSCode
    const openDocs = vscode.workspace.textDocuments.filter(
      doc => doc.uri.toString() !== activeUri && !doc.isClosed && doc.fileName.match(/\.(js|ts|jsx|tsx|py|go|rs)$/)
    );

    // Limitar para varrer no máximo as 5 abas abertas mais recentes
    const docsToScan = openDocs.slice(0, 5);

    for (const doc of docsToScan) {
      const text = doc.getText();
      const lines = text.split(/\r?\n/);
      const filePath = vscode.workspace.asRelativePath(doc.uri);

      // Deslizar janela por linhas
      for (let i = 0; i < lines.length; i += stepLines) {
        const windowLines = lines.slice(i, i + windowSizeLines);
        if (windowLines.length < 3) {
          continue; // Pular blocos muito pequenos
        }

        const content = windowLines.join('\n');
        const snippetTokens = this.tokenize(content);
        const similarity = this.calculateJaccard(prefixTokens, snippetTokens);

        if (similarity > 0.05) { // Limiar mínimo de relevância
          allSnippets.push({
            filePath,
            content,
            similarity
          });
        }
      }
    }

    // Ordenar por maior similaridade e selecionar as melhores
    allSnippets.sort((a, b) => b.similarity - a.similarity);

    // Garantir deduplicação de conteúdo muito similar
    const uniqueSnippets: TabSnippet[] = [];
    const seenContent = new Set<string>();

    for (const snip of allSnippets) {
      const trimmed = snip.content.trim();
      if (!seenContent.has(trimmed)) {
        seenContent.add(trimmed);
        uniqueSnippets.push(snip);
        if (uniqueSnippets.length >= maxSnippets) {
          break;
        }
      }
    }

    return uniqueSnippets;
  }

  /**
   * Tokeniza uma string em um conjunto (Set) de palavras em minúsculas.
   */
  private tokenize(text: string): Set<string> {
    const tokens = new Set<string>();
    // Divide por caracteres não alfanuméricos e descarta tokens muito curtos (< 2 chars)
    const matches = text.toLowerCase().match(/[a-zA-Z0-9_]+/g);
    if (matches) {
      for (const m of matches) {
        if (m.length > 2 && !this.isCommonKeyword(m)) {
          tokens.add(m);
        }
      }
    }
    return tokens;
  }

  /**
   * Calcula a similaridade de Jaccard entre dois conjuntos de tokens.
   * Jaccard = |A ∩ B| / |A ∪ B|
   */
  private calculateJaccard(setA: Set<string>, setB: Set<string>): number {
    let intersectionSize = 0;
    for (const val of setA) {
      if (setB.has(val)) {
        intersectionSize++;
      }
    }

    const unionSize = setA.size + setB.size - intersectionSize;
    if (unionSize === 0) {
      return 0;
    }

    return intersectionSize / unionSize;
  }

  /**
   * Ignora palavras-chave genéricas comuns de linguagem para melhorar a precisão da correspondência de símbolos.
   */
  private isCommonKeyword(word: string): boolean {
    const keywords = new Set([
      'const', 'let', 'var', 'function', 'class', 'import', 'export', 'from',
      'return', 'true', 'false', 'null', 'undefined', 'if', 'else', 'for', 'while',
      'switch', 'case', 'break', 'continue', 'default', 'new', 'this', 'typeof',
      'instanceof', 'async', 'await', 'try', 'catch', 'finally', 'throw'
    ]);
    return keywords.has(word);
  }
}
