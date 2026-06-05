import * as vscode from 'vscode';

export class DiagnosticsTool {
  /**
   * Obtém os diagnósticos (erros, avisos, etc.) para o documento fornecido
   * e os formata em uma string limpa e amigável para o LLM.
   */
  public static getDiagnosticsForDocument(document: vscode.TextDocument): string {
    const diagnostics = vscode.languages.getDiagnostics(document.uri);
    
    if (diagnostics.length === 0) {
      return "Nenhum erro ou aviso encontrado no arquivo atual.";
    }

    const formatted = diagnostics.map(d => {
      const severity = this.getSeverityName(d.severity);
      const line = d.range.start.line + 1; // LSP range is 0-indexed
      return `[${severity}] Linha ${line}: ${d.message}`;
    });

    return `Diagnósticos LSP para ${document.fileName}:\n` + formatted.join('\n');
  }

  private static getSeverityName(severity: vscode.DiagnosticSeverity): string {
    switch (severity) {
      case vscode.DiagnosticSeverity.Error: return 'Erro';
      case vscode.DiagnosticSeverity.Warning: return 'Aviso';
      case vscode.DiagnosticSeverity.Information: return 'Info';
      case vscode.DiagnosticSeverity.Hint: return 'Dica';
      default: return 'Desconhecido';
    }
  }
}
