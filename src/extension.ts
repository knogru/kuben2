import * as vscode from 'vscode';
import * as path from 'path';
import { OllamaClient } from './ollamaClient';
import { ASTManager } from './ast/astManager';
import { SymbolIndexer } from './ast/symbolIndexer';
import { ContextManager } from './ast/contextManager';
import { InferenceOptimizer } from './ast/inferenceOptimizer';
import { LatencyTracker } from './telemetry/latencyTracker';

let providerDisposable: vscode.Disposable | null = null;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  // Ler configurações do workspace
  let config = vscode.workspace.getConfiguration('aiAutocomplete');
  let enabled = config.get<boolean>('enabled', true);
  let useASTEngine = config.get<boolean>('useASTEngine', true);
  let enableGraphRag = config.get<boolean>('enableGraphRag', true);

  // Inicializa o ASTManager e o SymbolIndexer
  const indexer = SymbolIndexer.getInstance();
  if (useASTEngine) {
    ASTManager.getInstance().initialize(context.extensionUri).then(success => {
      if (success) {
        console.log('[Extension] ASTManager inicializado com sucesso.');
      } else {
        console.warn('[Extension] Falha ao inicializar ASTManager. Fallbacks ativos.');
      }
      indexer.scanWorkspace();
    });
  } else {
    indexer.scanWorkspace();
  }
  console.log(`[Extension] Configurações de Contexto - AST: ${useASTEngine}, Graph RAG: ${enableGraphRag}`);
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
    async (prefix: string, suffix: string, tokens: number, opts?: { temperature: number; repeatPenalty: number }) => {
      statusBarItem.text = '$(sync~spin) AI: Gerando...';
      statusBarItem.tooltip = `Consultando modelo ${model} no Ollama`;
      try {
        const result = await client.generateWithFIM(prefix, suffix, tokens, opts ? {
          maxTokens: tokens,
          temperature: opts.temperature,
          repeatPenalty: opts.repeatPenalty,
        } : undefined);
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

          // Enriquecer o prefixo com contexto de dependências (Graph RAG Light)
          let enrichedPrefix = prefix;
          const contextStart = Date.now();
          if (enableGraphRag) {
            enrichedPrefix = ContextManager.getInstance().getContextualPrefix(
              document, position, prefix
            );
          }
          const contextMs = Date.now() - contextStart;

          // Otimizar parâmetros de inferência com base no nó AST sob o cursor
          const fullCode = document.getText();
          const inferenceParams = InferenceOptimizer.resolve(
            document.languageId, fullCode,
            lineNumber, charPos, maxTokens
          );

          // Pega 5 linhas após a linha atual para servir como sufixo FIM
          const endLine = Math.min(document.lineCount - 1, lineNumber + 5);
          const suffix = document.getText(
            new vscode.Range(lineNumber, charPos, endLine, 0)
          );

          try {
            // Executa a chamada debounced com parâmetros otimizados
            const inferenceStart = Date.now();
            const completion = await debouncedGenerate(
              enrichedPrefix, suffix, inferenceParams.maxTokens,
              inferenceParams
            );
            const inferenceMs = Date.now() - inferenceStart;

            // Registrar amostra de telemetria
            LatencyTracker.getInstance().record({
              timestamp: Date.now(),
              contextMs,
              inferenceMs,
              totalMs: contextMs + inferenceMs,
              tokensGenerated: completion ? completion.length : 0,
              nodeType: 'inline',
            });

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

  // Registrar comando de telemetria de latência
  const latencyCommand = vscode.commands.registerCommand('ai-autocomplete-vscode.showLatency', () => {
    const summary = LatencyTracker.getInstance().formatSummary();
    vscode.window.showInformationMessage(summary, { modal: true });
  });
  context.subscriptions.push(latencyCommand);

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
      useASTEngine = config.get<boolean>('useASTEngine', true);
      enableGraphRag = config.get<boolean>('enableGraphRag', true);

      if (useASTEngine && !ASTManager.getInstance().isReady()) {
        ASTManager.getInstance().initialize(context.extensionUri);
      }
      console.log(`[Extension] Configurações recarregadas - AST: ${useASTEngine}, Graph RAG: ${enableGraphRag}`);

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

  // Listeners para indexação incremental de arquivos
  const saveListener = vscode.workspace.onDidSaveTextDocument(async (document) => {
    const ext = path.extname(document.fileName);
    if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
      console.log(`[Extension] Documento salvo detectado. Atualizando index: ${document.fileName}`);
      await SymbolIndexer.getInstance().indexFile(document.uri);
    }
  });
  context.subscriptions.push(saveListener);

  const deleteListener = vscode.workspace.onDidDeleteFiles((e) => {
    for (const fileUri of e.files) {
      SymbolIndexer.getInstance().removeFile(fileUri);
    }
  });
  context.subscriptions.push(deleteListener);

  const createListener = vscode.workspace.onDidCreateFiles(async (e) => {
    for (const fileUri of e.files) {
      const ext = path.extname(fileUri.fsPath);
      if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
        await SymbolIndexer.getInstance().indexFile(fileUri);
      }
    }
  });
  context.subscriptions.push(createListener);
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
