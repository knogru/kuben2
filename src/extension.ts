import * as vscode from 'vscode';
import { OllamaClient } from './ollamaClient';

let providerDisposable: vscode.Disposable | null = null;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  // Ler configurações do workspace
  let config = vscode.workspace.getConfiguration('aiAutocomplete');
  let enabled = config.get<boolean>('enabled', true);
  let endpoint = config.get<string>('endpoint', 'http://localhost:11434');
  let model = config.get<string>('model', 'qwen2.5-coder:1.5b-base');
  let maxTokens = config.get<number>('maxTokens', 20);
  let debounceDelay = config.get<number>('debounceDelay', 300);
  let maxContextLines = config.get<number>('maxContextLines', 30);
  let targetLanguages = config.get<string[]>('languages', [
    'javascript',
    'typescript',
    'javascriptreact',
    'typescriptreact',
    'python',
    'go',
    'rust',
    'c',
    'cpp',
    'html',
    'css'
  ]);

  const client = new OllamaClient(endpoint, model);

  // Criar item da Barra de Status
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'ai-autocomplete-vscode.toggle';
  context.subscriptions.push(statusBarItem);
  updateStatusBar(enabled);

  // Helper de debounce que aceita um delay dinâmico
  function createDebounced<T extends any[], R>(
    fn: (...args: T) => Promise<R>,
    getDelay: () => number
  ) {
    let timeout: NodeJS.Timeout | null = null;
    let pendingResolve: ((value: R | undefined) => void) | null = null;

    return (...args: T): Promise<R | undefined> => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
        if (pendingResolve) {
          pendingResolve(undefined);
          pendingResolve = null;
        }
      }

      return new Promise((resolve) => {
        pendingResolve = resolve;
        timeout = setTimeout(async () => {
          try {
            const result = await fn(...args);
            resolve(result as R | undefined);
          } catch (e) {
            console.error('Debounced function error:', e);
            resolve(undefined);
          } finally {
            pendingResolve = null;
            timeout = null;
          }
        }, getDelay());
      });
    };
  }

  // Instanciar a chamada do autocomplete debounced com status bar update
  const debouncedGenerate = createDebounced(
    async (prefix: string, suffix: string, tokens: number) => {
      statusBarItem.text = '$(sync~spin) AI: Gerando...';
      statusBarItem.tooltip = `Consultando modelo ${model} no Ollama`;
      try {
        const result = await client.generateWithFIM(prefix, suffix, tokens);
        return result;
      } finally {
        updateStatusBar(enabled);
      }
    },
    () => debounceDelay
  );

  // Registrar / recriar o provedor de autocomplete inline
  function registerProvider() {
    if (providerDisposable) {
      providerDisposable.dispose();
      providerDisposable = null;
    }

    if (!enabled) {
      return;
    }

    // Criar seletores para todas as linguagens configuradas
    const documentSelectors = targetLanguages.map(lang => ({ language: lang }));

    providerDisposable = vscode.languages.registerInlineCompletionItemProvider(
      documentSelectors,
      {
        async provideInlineCompletionItems(document, position, _context, token) {
          if (!enabled) {
            return [];
          }

          // Tratar sinal de cancelamento nativo do VSCode
          token.onCancellationRequested(() => {
            console.log('VSCode cancelou a geração de autocomplete inline.');
          });

          const lineNumber = position.line;
          const charPos = position.character;
          
          // Pegar o contexto respeitando as configurações (prefixo acima do cursor)
          const startLine = Math.max(0, lineNumber - maxContextLines);
          const prefix = document.getText(
            new vscode.Range(startLine, 0, lineNumber, charPos)
          );

          // Se o prefixo for vazio ou contiver apenas espaços, não disparar para evitar alucinações no vácuo
          if (!prefix.trim()) {
            return [];
          }

          // Pega 5 linhas após a linha atual para servir como sufixo FIM
          const endLine = Math.min(document.lineCount - 1, lineNumber + 5);
          const suffix = document.getText(
            new vscode.Range(lineNumber, charPos, endLine, 0)
          );

          try {
            // Executa a chamada debounced com limite de tokens
            const completion = await debouncedGenerate(prefix, suffix, maxTokens);
            if (completion && completion.trim()) {
              return [new vscode.InlineCompletionItem(completion)];
            }
          } catch (err) {
            console.error('Erro na geração de autocomplete inline:', err);
          }

          return [];
        }
      }
    );

    context.subscriptions.push(providerDisposable);
  }

  // Executa o registro inicial
  registerProvider();

  // Registrar comando Toggle
  const toggleCommand = vscode.commands.registerCommand('ai-autocomplete-vscode.toggle', async () => {
    enabled = !enabled;
    // Atualizar persistência nas configurações globais do workspace do usuário
    await vscode.workspace.getConfiguration('aiAutocomplete').update('enabled', enabled, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`AI Autocomplete ${enabled ? 'Habilitado' : 'Desabilitado'}.`);
    updateStatusBar(enabled);
    registerProvider();
  });
  context.subscriptions.push(toggleCommand);

  // Escutar mudanças de configuração para atualizar o estado sem precisar recarregar a extensão
  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('aiAutocomplete')) {
      config = vscode.workspace.getConfiguration('aiAutocomplete');
      enabled = config.get<boolean>('enabled', true);
      endpoint = config.get<string>('endpoint', 'http://localhost:11434');
      model = config.get<string>('model', 'qwen2.5-coder:1.5b-base');
      maxTokens = config.get<number>('maxTokens', 20);
      debounceDelay = config.get<number>('debounceDelay', 300);
      maxContextLines = config.get<number>('maxContextLines', 30);
      targetLanguages = config.get<string[]>('languages', [
        'javascript',
        'typescript',
        'javascriptreact',
        'typescriptreact',
        'python',
        'go',
        'rust',
        'c',
        'cpp',
        'html',
        'css'
      ]);

      client.updateConfig(endpoint, model);
      updateStatusBar(enabled);
      registerProvider();
    }
  });
  context.subscriptions.push(configListener);
}

function updateStatusBar(enabled: boolean) {
  if (enabled) {
    statusBarItem.text = '$(sparkle) AI Autocomplete';
    statusBarItem.tooltip = 'AI Autocomplete Inline Habilitado (Ollama)';
    statusBarItem.backgroundColor = undefined;
  } else {
    statusBarItem.text = '$(circle-slash) AI Autocomplete';
    statusBarItem.tooltip = 'AI Autocomplete Inline Desabilitado';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
  statusBarItem.show();
}

export function deactivate() {
  if (providerDisposable) {
    providerDisposable.dispose();
  }
}
