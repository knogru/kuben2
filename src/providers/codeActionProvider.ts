import * as vscode from 'vscode';

export class KubenCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
    vscode.CodeActionKind.Refactor,
  ];

  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    // Se houver uma seleção de texto não-vazia, oferecer Explicação e Testes
    if (!range.isEmpty) {
      const explainAction = new vscode.CodeAction('Kuben: Explicar Código Selecionado', vscode.CodeActionKind.Refactor);
      explainAction.command = {
        command: 'ai-autocomplete-vscode.explainSelection',
        title: 'Explicar Código Selecionado',
        arguments: [document, range],
      };
      actions.push(explainAction);

      const testAction = new vscode.CodeAction('Kuben: Gerar Testes Unitários', vscode.CodeActionKind.Refactor);
      testAction.command = {
        command: 'ai-autocomplete-vscode.generateTests',
        title: 'Gerar Testes Unitários',
        arguments: [document, range],
      };
      actions.push(testAction);
    }

    // Se houver algum diagnóstico de erro/aviso no contexto, oferecer correção
    if (context.diagnostics.length > 0) {
      const fixAction = new vscode.CodeAction('Kuben: Corrigir Problema com IA', vscode.CodeActionKind.QuickFix);
      fixAction.command = {
        command: 'ai-autocomplete-vscode.fixDiagnostic',
        title: 'Corrigir Problema com IA',
        arguments: [document, range, context.diagnostics],
      };
      fixAction.diagnostics = [...context.diagnostics];
      fixAction.isPreferred = true;
      actions.push(fixAction);
    }

    return actions;
  }
}
