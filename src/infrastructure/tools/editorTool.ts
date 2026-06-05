import * as vscode from 'vscode';

import * as path from 'path';

export class EditorTool {
  /**
   * Aplica uma modificação de busca e substituição em bloco de forma cirúrgica num arquivo do workspace.
   */
  public static async applyBlockEdit(filePath: string, oldBlock: string, newBlock: string): Promise<{success: boolean, message: string}> {
    if (!filePath) {
      return { success: false, message: "O argumento filePath é obrigatório." };
    }
    
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return { success: false, message: "Nenhum workspace aberto." };
    }
    
    // Resolve URI do arquivo
    const rootPath = workspaceFolders[0].uri.fsPath;
    const fileUri = vscode.Uri.file(path.join(rootPath, filePath));
    
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(fileUri);
    } catch (e) {
      return { success: false, message: `Falha ao abrir arquivo: ${filePath}` };
    }

    const text = document.getText();
    const startIndex = text.indexOf(oldBlock);
    
    if (startIndex === -1) {
      return { success: false, message: `O bloco de código original não foi encontrado exatamente como fornecido em ${filePath}.` };
    }

    const startPos = document.positionAt(startIndex);
    const endPos = document.positionAt(startIndex + oldBlock.length);
    const range = new vscode.Range(startPos, endPos);

    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, range, newBlock);

    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      return { success: false, message: "Falha ao aplicar WorkspaceEdit." };
    }

    // Mostra o documento para o usuário
    await vscode.window.showTextDocument(document);

    // Pergunta ao usuário
    const userChoice = await vscode.window.showInformationMessage(
      `Kuben alterou o arquivo ${path.basename(filePath)}. Deseja manter as alterações?`,
      'Manter',
      'Desfazer'
    );

    if (userChoice === 'Desfazer') {
      const revertEdit = new vscode.WorkspaceEdit();
      // O tamanho do newBlock substituiu o oldBlock. Recalculamos o fim baseado nisso.
      const revertEndPos = document.positionAt(startIndex + newBlock.length);
      const revertRange = new vscode.Range(startPos, revertEndPos);
      revertEdit.replace(document.uri, revertRange, oldBlock);
      await vscode.workspace.applyEdit(revertEdit);
      return { success: false, message: "O usuário optou por desfazer a edição." };
    }

    await document.save();
    return { success: true, message: "Edição aplicada e confirmada pelo usuário com sucesso." };
  }
}
