import * as vscode from 'vscode';
import * as path from 'path';
import { OllamaClient } from './ollamaClient';
import { ASTManager } from './ast/astManager';
import { SymbolIndexer } from './ast/symbolIndexer';
import { ContextManager } from './ast/contextManager';
import { InferenceOptimizer } from './ast/inferenceOptimizer';
import { LatencyTracker } from './telemetry/latencyTracker';
import { ModelResolver } from './infrastructure/modelResolver';
import { OpenTabsAgent } from './infrastructure/openTabsAgent';
import { AcceptanceTracker } from './application/acceptanceTracker';
import { KubenCodeActionProvider } from './providers/codeActionProvider';
import { ChatViewProvider } from './providers/chatViewProvider';

let providerDisposable: vscode.Disposable | null = null;
let statusBarItem: vscode.StatusBarItem;
let isConnected = false;
let isCheckingConnection = false;

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
  let chatModel = config.get<string>('chatModel', 'qwen2.5-coder:1.5b-instruct');
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

  const client = new OllamaClient(endpoint, model, chatModel);
  let modelResolver = new ModelResolver(endpoint);

  async function updateActiveModelProfile() {
    try {
      const modelProfileConfig = config.get<string>('modelProfile', 'auto');
      const resolved = await modelResolver.resolve(model, modelProfileConfig);
      client.setActiveModel(resolved);
      console.log(`[Extension] Perfil do Modelo Resolvido: ${resolved.profile.family} (Source: ${resolved.source})`);
    } catch (err) {
      console.error('[Extension] Erro ao resolver perfil do modelo:', err);
    }
  }

  // Executar a resolução inicial
  updateActiveModelProfile();

  // Criar item da Barra de Status
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'ai-autocomplete-vscode.toggle';
  context.subscriptions.push(statusBarItem);
  updateStatusBar(enabled);

  async function performHealthCheck() {
    if (isCheckingConnection) {
      return;
    }
    isCheckingConnection = true;
    try {
      const active = await client.checkConnection();
      const wasConnected = isConnected;
      isConnected = active;
      updateStatusBar(enabled);

      if (!isConnected && wasConnected) {
        vscode.window.showWarningMessage(
          'Kuben: Não foi possível conectar ao Ollama local.',
          'Verificar Configurações',
          'Tentar Novamente'
        ).then(selection => {
          if (selection === 'Verificar Configurações') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'aiAutocomplete');
          } else if (selection === 'Tentar Novamente') {
            performHealthCheck();
          }
        });
      }
    } catch (e) {
      console.error('[HealthCheck] Error checking Ollama connection:', e);
      isConnected = false;
      updateStatusBar(enabled);
    } finally {
      isCheckingConnection = false;
    }
  }

  // Iniciar checagem periódica a cada 20 segundos
  const healthCheckInterval = setInterval(performHealthCheck, 20000);
  context.subscriptions.push({
    dispose: () => clearInterval(healthCheckInterval)
  });

  // Executar imediatamente na ativação
  performHealthCheck();

  // Helper de debounce que aceita um delay dinâmico
  function createDebounced<T extends any[], R>(
    fn: (...args: T) => Promise<R>
  ) {
    let timeout: NodeJS.Timeout | null = null;
    let pendingResolve: ((value: R | undefined) => void) | null = null;

    return (delay: number, ...args: T): Promise<R | undefined> => {
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
        }, delay);
      });
    };
  }

  // Instanciar a chamada do autocomplete debounced com status bar update
  const debouncedGenerate = createDebounced(
    async (prefix: string, suffix: string, tokens: number, opts?: { temperature: number; repeatPenalty: number }) => {
      if (!isConnected) {
        // Tentar re-conectar se estiver desconectado
        const active = await client.checkConnection();
        isConnected = active;
        if (!isConnected) {
          updateStatusBar(enabled);
          return undefined;
        }
      }
      updateStatusBar(enabled, 'generating');
      try {
        const result = await client.generateWithFIM(prefix, suffix, tokens, opts ? {
          maxTokens: tokens,
          temperature: opts.temperature,
          repeatPenalty: opts.repeatPenalty,
        } : undefined);
        updateStatusBar(enabled);
        return result;
      } catch (err) {
        updateStatusBar(enabled, 'error');
        return undefined;
      }
    }
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
        async provideInlineCompletionItems(document, position, inlineContext, token) {
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

          // Enriquecer o prefixo com contexto de dependências (Graph RAG Light + Open Tabs Jaccard)
          let enrichedPrefix = prefix;
          const contextStart = Date.now();
          if (enableGraphRag) {
            // Contexto das dependências
            enrichedPrefix = ContextManager.getInstance().getContextualPrefix(
              document, position, prefix
            );

            // Contexto de abas abertas
            try {
              const tabSnippets = OpenTabsAgent.getInstance().getRelevantSnippets(document, prefix, 3);
              if (tabSnippets.length > 0) {
                const commentChar = ['python', 'ruby', 'shellscript'].includes(document.languageId) ? '#' : '//';
                let tabContextComment = `\n${commentChar} Contexto Adicional de Abas Abertas (Jaccard RAG):\n`;
                for (const snippet of tabSnippets) {
                  tabContextComment += `${commentChar} Do arquivo aberto "${snippet.filePath}":\n`;
                  tabContextComment += snippet.content.split('\n').map(l => `${commentChar} ${l}`).join('\n') + '\n';
                }
                enrichedPrefix = tabContextComment + enrichedPrefix;
              }
            } catch (err) {
              console.error('[OpenTabsContext] Erro ao buscar snippets de abas abertas:', err);
            }
          }
          const contextMs = Date.now() - contextStart;

          // Otimizar parâmetros de inferência com base no nó AST sob o cursor
          const fullCode = document.getText();
          const inferenceParams = InferenceOptimizer.resolve(
            document.languageId, fullCode,
            lineNumber, charPos, maxTokens
          );

          // Verificar se precisamos de completação de bloco inteiro (manual Invoke ou AST indicando bloco vazio)
          const isManualInvoke = inlineContext.triggerKind === vscode.InlineCompletionTriggerKind.Invoke;
          const isFunctionBlockEmpty = InferenceOptimizer.isBlockEmpty(document.languageId, fullCode, lineNumber, charPos);

          if (isManualInvoke || isFunctionBlockEmpty) {
            const activeProfile = client.getActiveModel()?.profile;
            inferenceParams.maxTokens = activeProfile?.capabilities.recommendedNumPredictBlock || 128;
            inferenceParams.temperature = 0.2;
          }

          // Pega mais linhas após a linha atual para servir como sufixo FIM se for completação de bloco
          const suffixLinesCount = (isManualInvoke || isFunctionBlockEmpty) ? 20 : 5;
          const endLine = Math.min(document.lineCount - 1, lineNumber + suffixLinesCount);
          const suffix = document.getText(
            new vscode.Range(lineNumber, charPos, endLine, 0)
          );

          try {
            // Executa a chamada debounced com parâmetros otimizados e delay dinâmico
            const delay = isManualInvoke ? 50 : debounceDelay;
            const inferenceStart = Date.now();
            const completion = await debouncedGenerate(
              delay,
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
              AcceptanceTracker.getInstance().registerShown(completion, document, position);
              const item = new vscode.InlineCompletionItem(completion);
              item.command = {
                command: 'ai-autocomplete-vscode.onAccept',
                title: 'On Completion Accepted',
                arguments: [document.uri, position, completion]
              };
              return [item];
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
    const stats = AcceptanceTracker.getInstance().getSessionStats();
    const statsSummary = `\n\n📈 Telemetria de Aceitação:\n  Mostrados: ${stats.shown}\n  Aceitos: ${stats.accepted}\n  Taxa de Aceite: ${stats.acceptanceRate}%`;
    vscode.window.showInformationMessage(summary + statsSummary, { modal: true });
  });
  context.subscriptions.push(latencyCommand);

  // Registrar comando ao aceitar sugestão (auto-healing)
  const onAcceptCommand = vscode.commands.registerCommand('ai-autocomplete-vscode.onAccept', async (uri: vscode.Uri, position: vscode.Position, completionText: string) => {
    console.log(`[Extension] Sugestão aceita. Iniciando processamento em ${uri.fsPath}`);
    
    const acceptConfig = vscode.workspace.getConfiguration('aiAutocomplete');
    const formatOnAccept = acceptConfig.get<boolean>('formatOnAccept', true);
    const correctErrorsOnAccept = acceptConfig.get<boolean>('correctErrorsOnAccept', true);
    const rangeLines = acceptConfig.get<number>('autoCorrectionLinesRange', 5);

    try {
      const document = await vscode.workspace.openTextDocument(uri);
      
      // Esperar breve momento para o VS Code atualizar o documento com o texto aceito
      await new Promise(resolve => setTimeout(resolve, 150));

      const completionLinesCount = completionText.split('\n').length;
      const startLine = Math.max(0, position.line - rangeLines);
      const endLine = Math.min(document.lineCount - 1, position.line + completionLinesCount + rangeLines);
      
      const affectedRange = new vscode.Range(
        startLine, 0,
        endLine, document.lineAt(endLine).text.length
      );

      // 1. Executar Formatação (se ativada)
      if (formatOnAccept) {
        console.log(`[Extension] Formatando range: linhas ${startLine + 1} a ${endLine + 1}`);
        const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
          'vscode.executeFormatRangeProvider',
          uri,
          affectedRange,
          {
            tabSize: vscode.window.activeTextEditor?.options.tabSize || 4,
            insertSpaces: vscode.window.activeTextEditor?.options.insertSpaces || true
          }
        );
        if (edits && edits.length > 0) {
          const workspaceEdit = new vscode.WorkspaceEdit();
          workspaceEdit.set(uri, edits);
          await vscode.workspace.applyEdit(workspaceEdit);
        }
      }

      // 2. Executar Correção Automática (se ativada)
      if (correctErrorsOnAccept) {
        // Aguardar o editor de diagnósticos atualizar os problemas
        await new Promise(resolve => setTimeout(resolve, 800));

        const diagnostics = vscode.languages.getDiagnostics(uri);
        const rangeErrors = diagnostics.filter(d => {
          const isError = d.severity === vscode.DiagnosticSeverity.Error;
          const overlaps = d.range.intersection(affectedRange) !== undefined;
          return isError && overlaps;
        });

        if (rangeErrors.length > 0) {
          console.log(`[Extension] Erros sintáticos/compilação detectados: ${rangeErrors.length}. Chamando auto-correção...`);
          
          updateStatusBar(enabled, 'generating');
          statusBarItem.text = '$(sync~spin) Kuben (Corrigindo Código...)';
          statusBarItem.tooltip = 'Kuben Autocomplete: Corrigindo erros sintáticos no bloco circundante...';

          const codeBlock = document.getText(affectedRange);
          const diagMessages = rangeErrors.map(e => `- Linha ${e.range.start.line + 1}: ${e.message}`).join('\n');

          const prompt = `Você é um motor de auto-correção sintática e linting inteligente. O usuário aceitou um autocomplete de IA que introduziu pequenos desalinhamentos ou erros de digitação nas linhas circundantes.
Analise o seguinte bloco de código da linguagem de programação "${document.languageId}":

\`\`\`${document.languageId}
${codeBlock}
\`\`\`

Diagnósticos de erro relatados pelo VS Code nas linhas afetadas:
${diagMessages}

Sua tarefa:
Corrija APENAS os problemas/erros apontados nos diagnósticos acima, garantindo que o código fique syntactically correto e bem estruturado.
NÃO altere a lógica de negócios nem a funcionalidade principal do código.
Retorne estritamente o código corrigido na íntegra para substituir todo o bloco analisado.
NÃO use markdown fences (\`\`\`), NÃO inclua prosa explicativa, comentários extras ou introduções. Retorne exclusivamente o código corrigido bruto.`;

          const corrected = await client.generateInstruction(prompt);

          if (corrected && corrected.trim() && corrected !== codeBlock) {
            let isValid = true;
            if (useASTEngine) {
              const tree = ASTManager.getInstance().parse(document.languageId, corrected);
              if (tree) {
                const hasErrorNode = (node: any): boolean => {
                  if (node.type === 'ERROR' || node.isMissing()) return true;
                  for (let i = 0; i < node.childCount; i++) {
                    if (hasErrorNode(node.child(i))) return true;
                  }
                  return false;
                };
                if (hasErrorNode(tree.rootNode)) {
                  console.warn('[Extension] Correção automática descartada devido a erro de parsing AST na resposta.');
                  isValid = false;
                }
              }
            }

            if (isValid) {
              const editor = vscode.window.activeTextEditor;
              if (editor && editor.document.uri.toString() === uri.toString()) {
                await editor.edit(editBuilder => {
                  editBuilder.replace(affectedRange, corrected);
                });
                console.log('[Extension] Código auto-corrigido com sucesso!');
                vscode.window.setStatusBarMessage('Kuben: Código auto-corrigido com sucesso!', 3000);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('[Extension] Erro no fluxo onAccept:', err);
    } finally {
      updateStatusBar(enabled);
    }
  });
  context.subscriptions.push(onAcceptCommand);

  // Registrar canal de saída para as respostas de IA
  const kubenOutputChannel = vscode.window.createOutputChannel("Kuben AI Output");
  context.subscriptions.push(kubenOutputChannel);

  async function runStreamCommand(prompt: string, title: string) {
    kubenOutputChannel.show(true);
    kubenOutputChannel.clear();
    kubenOutputChannel.appendLine(`Kuben [IA]: ${title}...`);
    kubenOutputChannel.appendLine(`===============================================\n`);

    try {
      for await (const chunk of client.generateStream(prompt)) {
        kubenOutputChannel.append(chunk);
      }
      kubenOutputChannel.appendLine(`\n\n===============================================`);
      kubenOutputChannel.appendLine(`Fim da resposta.`);
    } catch (err) {
      kubenOutputChannel.appendLine(`\n[Erro] Falha ao gerar resposta: ${err}`);
    }
  }

  // 1. Comando Explicar Seleção
  const explainCommand = vscode.commands.registerCommand('ai-autocomplete-vscode.explainSelection', async (docArg?: vscode.TextDocument, rangeArg?: vscode.Range) => {
    const editor = vscode.window.activeTextEditor;
    const document = docArg || editor?.document;
    const range = rangeArg || editor?.selection;
    if (!document || !range || range.isEmpty) {
      vscode.window.showWarningMessage('Nenhum código selecionado.');
      return;
    }
    const code = document.getText(range);
    const prompt = `Explique em português o seguinte código e descreva o que ele faz de forma clara e objetiva:\n\n\`\`\`${document.languageId}\n${code}\n\`\`\``;
    await runStreamCommand(prompt, "Explicando código selecionado");
  });
  context.subscriptions.push(explainCommand);

  // 2. Comando Gerar Testes Unitários
  const generateTestsCommand = vscode.commands.registerCommand('ai-autocomplete-vscode.generateTests', async (docArg?: vscode.TextDocument, rangeArg?: vscode.Range) => {
    const editor = vscode.window.activeTextEditor;
    const document = docArg || editor?.document;
    const range = rangeArg || editor?.selection;
    if (!document || !range || range.isEmpty) {
      vscode.window.showWarningMessage('Nenhum código selecionado.');
      return;
    }
    const code = document.getText(range);
    const prompt = `Gere testes unitários completos e bem estruturados para o seguinte código. Use frameworks apropriados para a linguagem ${document.languageId}:\n\n\`\`\`${document.languageId}\n${code}\n\`\`\``;
    await runStreamCommand(prompt, "Gerando testes unitários");
  });
  context.subscriptions.push(generateTestsCommand);

  // 3. Comando Corrigir Problema
  const fixDiagnosticCommand = vscode.commands.registerCommand('ai-autocomplete-vscode.fixDiagnostic', async (docArg?: vscode.TextDocument, rangeArg?: vscode.Range, diagnostics?: vscode.Diagnostic[]) => {
    const editor = vscode.window.activeTextEditor;
    const document = docArg || editor?.document;
    const range = rangeArg || editor?.selection;
    if (!document || !range) {
      vscode.window.showWarningMessage('Nenhum código selecionado.');
      return;
    }
    const code = range.isEmpty ? document.lineAt(range.start.line).text : document.getText(range);
    const diags = diagnostics || vscode.languages.getDiagnostics(document.uri).filter(d => d.range.start.line === range.start.line);
    const diagMessages = diags.map(d => `- ${d.message}`).join('\n');
    const prompt = `Corrija o seguinte código que apresenta os seguintes problemas:\n${diagMessages}\n\nCódigo original:\n\`\`\`${document.languageId}\n${code}\n\`\`\`\n\nRetorne o código corrigido e explique brevemente a alteração feita.`;
    await runStreamCommand(prompt, "Corrigindo problema detectado");
  });
  context.subscriptions.push(fixDiagnosticCommand);

  // Registrar o Code Action Provider
  const codeActionProviderDisposable = vscode.languages.registerCodeActionsProvider(
    { pattern: '**/*' },
    new KubenCodeActionProvider(),
    {
      providedCodeActionKinds: KubenCodeActionProvider.providedCodeActionKinds
    }
  );
  context.subscriptions.push(codeActionProviderDisposable);

  // Registrar o Webview View Provider do Chat
  const chatViewProvider = new ChatViewProvider(context.extensionUri, client);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider)
  );

  // Listener para telemetria de aceitação/rejeição
  const textChangeDisposable = vscode.workspace.onDidChangeTextDocument((e) => {
    AcceptanceTracker.getInstance().evaluateChange(e);
  });
  context.subscriptions.push(textChangeDisposable);

  // Escutar mudanças de configuração para atualizar o estado sem precisar recarregar a extensão
  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('aiAutocomplete')) {
      config = vscode.workspace.getConfiguration('aiAutocomplete');
      enabled = config.get<boolean>('enabled', true);
      endpoint = config.get<string>('endpoint', 'http://localhost:11434');
      model = config.get<string>('model', 'qwen2.5-coder:1.5b-base');
      chatModel = config.get<string>('chatModel', 'qwen2.5-coder:1.5b-instruct');
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

      modelResolver = new ModelResolver(endpoint);
      client.updateConfig(endpoint, model, chatModel);
      updateActiveModelProfile();
      updateStatusBar(enabled);
      registerProvider();
    }
  });
  context.subscriptions.push(configListener);

  // Listeners para indexação incremental de arquivos
  const saveListener = vscode.workspace.onDidSaveTextDocument(async (document) => {
    const ext = path.extname(document.fileName);
    if (['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs'].includes(ext)) {
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
      if (['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs'].includes(ext)) {
        await SymbolIndexer.getInstance().indexFile(fileUri);
      }
    }
  });
  context.subscriptions.push(createListener);
}

function updateStatusBar(enabled: boolean, stateOverride?: 'generating' | 'error') {
  if (!enabled) {
    statusBarItem.text = '$(circle-slash) Kuben';
    statusBarItem.tooltip = 'Kuben Autocomplete: Desabilitado';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else if (!isConnected) {
    statusBarItem.text = '$(circle-outline) Kuben';
    statusBarItem.tooltip = 'Kuben Autocomplete: Ollama Offline / Desconectado';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  } else if (stateOverride === 'generating') {
    statusBarItem.text = '$(sync~spin) Kuben';
    statusBarItem.tooltip = 'Kuben Autocomplete: Gerando sugestão...';
    statusBarItem.backgroundColor = undefined;
  } else if (stateOverride === 'error') {
    statusBarItem.text = '$(warning) Kuben';
    statusBarItem.tooltip = 'Kuben Autocomplete: Erro na última requisição';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    statusBarItem.text = '$(sparkle) Kuben';
    statusBarItem.tooltip = 'Kuben Autocomplete: Pronto (Ollama Conectado)';
    statusBarItem.backgroundColor = undefined;
  }
  statusBarItem.show();
}

export function deactivate() {
  if (providerDisposable) {
    providerDisposable.dispose();
  }
}
