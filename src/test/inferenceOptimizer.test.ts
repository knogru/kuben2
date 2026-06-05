import * as assert from 'assert';
import { InferenceOptimizer } from '../ast/inferenceOptimizer';

suite('InferenceOptimizer', () => {

  test('deve retornar parâmetros padrão (ou otimizados se AST pronto) para fallback', () => {
    // O ASTManager pode já ter sido inicializado pelo runner,
    // então verificamos apenas se ele retorna um params válido.
    const params = InferenceOptimizer.resolve('typescript', 'const x = 1;', 0, 10, 20);
    assert.ok(params.maxTokens >= 15);
    assert.ok(params.temperature >= 0.0);
    assert.ok(params.repeatPenalty >= 1.0);
  });

  test('deve retornar parâmetros padrão para linguagens não suportadas', () => {
    const params = InferenceOptimizer.resolve('python', 'x = 1', 0, 5, 25);
    assert.strictEqual(params.maxTokens, 25);
    assert.strictEqual(params.temperature, 0.0);
  });

  test('deve manter defaults estáveis', () => {
    const params1 = InferenceOptimizer.resolve('unknown', '', 0, 0, 30);
    const params2 = InferenceOptimizer.resolve('unknown', '', 0, 0, 30);
    assert.deepStrictEqual(params1, params2);
  });
});
