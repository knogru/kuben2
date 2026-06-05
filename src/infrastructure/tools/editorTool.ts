import * as vscode from 'vscode';

export class EditorTool {
  /**
   * Aplica uma modificação de busca e substituição em bloco de forma cirúrgica.
   * Ele encontra `oldBlock` no `document` e substitui por `newBlock` via WorkspaceEdit.
   */
  public static async applyBlockEdit(document: vscode.TextDocument, oldBlock: string, newBlock: string): Promise<boolean> {
    const text = document.getText();
    const startIndex = text.indexOf(oldBlock);
    
    if (startIndex === -1) {
      vscode.window.showErrorMessage("Kuben: Falha ao aplicar edição. O bloco de código original não foi encontrado exatamente como fornecido.");
      return false;
    }

    const startPos = document.positionAt(startIndex);
    const endPos = document.positionAt(startIndex + oldBlock.length);
    const range = new vscode.Range(startPos, endPos);

    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, range, newBlock);

    return vscode.workspace.applyEdit(edit);
  }
}
