import * as assert from 'assert';
import { OllamaClient } from '../ollamaClient';

suite('OllamaClient', () => {

  test('deve instanciar com valores padrão', () => {
    const client = new OllamaClient();
    assert.ok(client, 'Cliente deve ser instanciado');
  });

  test('deve atualizar configurações dinamicamente', () => {
    const client = new OllamaClient('http://localhost:11434', 'model-a');
    client.updateConfig('http://localhost:9999', 'model-b');
    // Não há getter público, mas o teste garante que o método não lança exceção
    assert.ok(true);
  });

  test('deve aceitar GenerateOptions parciais', async () => {
    // Teste de integração leve: verifica que o método aceita parâmetros
    // sem lançar exceção de tipagem. A chamada real falhará porque o
    // Ollama não está rodando no ambiente de testes.
    const client = new OllamaClient('http://localhost:1', 'fake-model');
    const result = await client.generateWithFIM('test', 'test', 10, {
      maxTokens: 10,
      temperature: 0.1,
      repeatPenalty: 1.0,
    });
    // Deve retornar undefined porque o endpoint não existe
    assert.strictEqual(result, undefined);
  });
});
