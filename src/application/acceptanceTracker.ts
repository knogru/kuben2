import * as vscode from 'vscode';

export interface CompletionSession {
  text: string;
  uri: string;
  version: number;
  position: vscode.Position;
  timestamp: number;
}

export class AcceptanceTracker {
  private static instance: AcceptanceTracker | null = null;
  private pendingCompletion: CompletionSession | null = null;

  // Estatísticas da sessão
  private shownCount = 0;
  private acceptedCount = 0;

  private constructor() {}

  public static getInstance(): AcceptanceTracker {
    if (!AcceptanceTracker.instance) {
      AcceptanceTracker.instance = new AcceptanceTracker();
    }
    return AcceptanceTracker.instance;
  }

  /**
   * Registra uma sugestão que acabou de ser exibida ao usuário.
   */
  public registerShown(text: string, document: vscode.TextDocument, position: vscode.Position): void {
    this.pendingCompletion = {
      text,
      uri: document.uri.toString(),
      version: document.version,
      position,
      timestamp: Date.now(),
    };
    this.shownCount++;
  }

  /**
   * Avalia a alteração no documento para verificar aceitação ou rejeição.
   */
  public evaluateChange(event: vscode.TextDocumentChangeEvent): 'accepted' | 'rejected' | 'pending' {
    if (!this.pendingCompletion) {
      return 'pending';
    }

    // Se o documento alterado for diferente do da sugestão pendente, ignorar
    if (event.document.uri.toString() !== this.pendingCompletion.uri) {
      return 'pending';
    }

    const now = Date.now();
    // Janela máxima de 15 segundos para aceitar sugestão
    if (now - this.pendingCompletion.timestamp > 15000) {
      this.pendingCompletion = null;
      return 'rejected';
    }

    // Analisar as mudanças no texto
    for (const change of event.contentChanges) {
      const changeText = change.text;
      const expectedText = this.pendingCompletion.text;

      // Se a mudança inseriu exatamente o texto da completação (ou parte significativa dele)
      if (changeText && (expectedText === changeText || expectedText.startsWith(changeText.trim()))) {
        this.acceptedCount++;
        console.log(`[AcceptanceTracker] Sugestão ACEITA (${this.acceptedCount}/${this.shownCount})`);
        this.pendingCompletion = null;
        return 'accepted';
      }
    }

    // Se a alteração for um caractere de apagar/remover, rejeitar
    const hasDeletes = event.contentChanges.some(c => c.text === '' && c.rangeLength > 0);
    if (hasDeletes) {
      console.log(`[AcceptanceTracker] Sugestão REJEITADA.`);
      this.pendingCompletion = null;
      return 'rejected';
    }

    return 'pending';
  }

  /**
   * Retorna estatísticas agregadas da sessão.
   */
  public getSessionStats() {
    return {
      shown: this.shownCount,
      accepted: this.acceptedCount,
      acceptanceRate: this.shownCount > 0 ? Math.round((this.acceptedCount / this.shownCount) * 100) : 0,
    };
  }
}
