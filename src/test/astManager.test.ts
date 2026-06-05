import * as assert from 'assert';
import * as vscode from 'vscode';
import { ASTManager } from '../ast/astManager';
import * as path from 'path';

suite('ASTManager Test Suite', () => {
  let astManager: ASTManager;

  setup(async () => {
    astManager = ASTManager.getInstance();
    
    const extensionUri = vscode.Uri.file(path.resolve(__dirname, '../../../'));
    await astManager.initialize(extensionUri);
  });

  test('Deve inicializar o motor AST e carregar as gramáticas', () => {
    assert.strictEqual(astManager.isReady(), true, 'ASTManager deve estar pronto após a inicialização');
  });

  test('Deve parsear código TypeScript válido e gerar uma árvore', () => {
    const code = 'function sum(a: number, b: number): number { return a + b; }';
    const tree = astManager.parse('typescript', code);
    assert.ok(tree, 'A árvore não deve ser null');
    assert.strictEqual(tree!.rootNode.type, 'program');
  });

  test('Deve extrair a assinatura das funções locais (getLocalSymbols)', () => {
    const code = `
      class User {
        getName() { return "John"; }
      }
      function sum(a, b) {
        return a + b;
      }
    `;
    const symbols = astManager.getLocalSymbols('javascript', code);
    
    assert.strictEqual(symbols.length, 3, 'Deve extrair três assinaturas (Classe, Método e Função)');
    assert.strictEqual(symbols[0].name, 'User');
    assert.strictEqual(symbols[0].kind, 'Class');
    assert.strictEqual(symbols[1].name, 'getName');
    assert.strictEqual(symbols[1].kind, 'Method');
    assert.strictEqual(symbols[2].name, 'sum');
    assert.strictEqual(symbols[2].kind, 'Function');
  });
});
