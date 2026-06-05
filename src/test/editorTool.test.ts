import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as sinon from 'sinon';
import { EditorTool } from '../infrastructure/tools/editorTool';
import * as fs from 'fs';

suite('EditorTool Test Suite', () => {
  let showInfoStub: sinon.SinonStub;
  let showTextDocStub: sinon.SinonStub;

  setup(async () => {
    showInfoStub = sinon.stub(vscode.window, 'showInformationMessage');
    showTextDocStub = sinon.stub(vscode.window, 'showTextDocument');
    showTextDocStub.resolves();
  });

  teardown(async () => {
    sinon.restore();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('applyBlockEdit deve falhar se o arquivo nao for encontrado', async () => {
    const result = await EditorTool.applyBlockEdit('invalidFile.ts', 'x', 'y');
    assert.strictEqual(result.success, false);
    assert.ok(result.message.includes('Falha ao abrir arquivo'));
  });

  test('applyBlockEdit deve aplicar a alteração e retornar sucesso se o usuário Mantiver', async () => {
    showInfoStub.resolves('Manter');

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspacePath = workspaceFolders![0].uri.fsPath;
    const testFilePath = path.join(workspacePath, 'testFile1.ts');
    fs.writeFileSync(testFilePath, 'function hello() { return "world"; }');

    const result = await EditorTool.applyBlockEdit(
      'testFile1.ts',
      'return "world";',
      'return "kuben";'
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(showInfoStub.calledOnce, true);
    assert.strictEqual(showTextDocStub.calledOnce, true);

    const content = fs.readFileSync(testFilePath, 'utf8');
    assert.ok(content.includes('return "kuben";'));
    assert.ok(!content.includes('return "world";'));
  });

  test('applyBlockEdit deve reverter a alteração se o usuário Desfazer', async () => {
    showInfoStub.resolves('Desfazer');

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspacePath = workspaceFolders![0].uri.fsPath;
    const testFilePath = path.join(workspacePath, 'testFile2.ts');
    fs.writeFileSync(testFilePath, 'function hello() { return "world"; }');

    const result = await EditorTool.applyBlockEdit(
      'testFile2.ts',
      'return "world";',
      'return "universe";'
    );

    assert.strictEqual(result.success, false);
    assert.ok(result.message.includes('optou por desfazer'));
    assert.strictEqual(showInfoStub.calledOnce, true);

    const content = fs.readFileSync(testFilePath, 'utf8');
    assert.ok(content.includes('return "world";'), 'Deveria manter original');
    assert.ok(!content.includes('return "universe";'), 'Deveria remover nova versão');
  });
});
