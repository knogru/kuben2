import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { OllamaClient, ChatMessage } from '../ollamaClient';
import { OpenTabsAgent } from '../infrastructure/openTabsAgent';
import { DiagnosticsTool } from '../infrastructure/tools/diagnosticsTool';
import { ContextOptimizer } from '../infrastructure/contextOptimizer';
import { ASTManager } from '../ast/astManager';
import { MCPManager } from '../infrastructure/mcpManager';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'kuben.chat';
  private _view?: vscode.WebviewView;
  private history: ChatMessage[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly client: OllamaClient
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Ouvir mensagens enviadas pela UI do Webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'chat': {
          await this.handleChatQuery(data.text, data.mode);
          break;
        }
        case 'shortcut': {
          await this.handleShortcut(data.command);
          break;
        }
        case 'getSettings': {
          const config = vscode.workspace.getConfiguration('aiAutocomplete');
          webviewView.webview.postMessage({
            type: 'initSettings',
            config: {
              provider: config.get<string>('provider', 'ollama'),
              endpoint: config.get<string>('endpoint', 'http://localhost:11434'),
              apiKey: config.get<string>('apiKey', ''),
              model: config.get<string>('model', 'qwen2.5-coder:1.5b-base'),
              chatModel: config.get<string>('chatModel', 'qwen2.5-coder:1.5b-instruct')
            }
          });
          break;
        }
        case 'fetchModels': {
          try {
            let models: string[] = [];
            const headers: any = { 'Content-Type': 'application/json' };
            if (data.apiKey) headers['Authorization'] = `Bearer ${data.apiKey}`;
            
            if (data.provider === 'openai') {
              const res = await fetch(`${data.url}/models`, { headers });
              if (!res.ok) throw new Error(`Status ${res.status}`);
              const json = await res.json() as any;
              models = (json.data || []).map((m: any) => m.id);
            } else {
              const res = await fetch(`${data.url}/api/tags`);
              if (!res.ok) throw new Error(`Status ${res.status}`);
              const json = await res.json() as any;
              models = (json.models || []).map((m: any) => m.name);
            }
            webviewView.webview.postMessage({ type: 'modelsLoaded', models });
          } catch (err: any) {
            webviewView.webview.postMessage({ type: 'modelsError', error: err.message || String(err) });
          }
          break;
        }
        case 'saveSettings': {
          const config = vscode.workspace.getConfiguration('aiAutocomplete');
          await config.update('provider', data.provider, vscode.ConfigurationTarget.Global);
          await config.update('endpoint', data.url, vscode.ConfigurationTarget.Global);
          await config.update('apiKey', data.apiKey, vscode.ConfigurationTarget.Global);
          if (data.model) await config.update('model', data.model, vscode.ConfigurationTarget.Global);
          if (data.chatModel) await config.update('chatModel', data.chatModel, vscode.ConfigurationTarget.Global);
          webviewView.webview.postMessage({ type: 'settingsSaved' });
          break;
        }
      }
    });
  }

  private async handleChatQuery(text: string, mode: string = 'chat') {
    if (!this._view) return;

    // Inicializar servidores MCP silenciosamente (se ainda não estiverem)
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const mcpManager = MCPManager.getInstance();
    if (workspaceFolders && workspaceFolders.length > 0) {
      await mcpManager.startDefaultServers(workspaceFolders[0].uri.fsPath);
    }

    if (text.trim() === '/clear') {
      this.history = [];
      this._view.webview.postMessage({ type: 'clear' });
      this._view.webview.postMessage({ type: 'chunk', text: 'Histórico de chat limpo com sucesso!' });
      this._view.webview.postMessage({ type: 'done' });
      return;
    }

    // Compilar contexto: seleção ativa + arquivo aberto inteiro (se não houver seleção)
    const editor = vscode.window.activeTextEditor;
    let contextStr = '';
    let lang = 'javascript';
    
    if (editor) {
      lang = editor.document.languageId;
      const selection = editor.selection;
      if (!selection.isEmpty) {
        const rawCode = editor.document.getText(selection);
        contextStr += `Código Selecionado no Editor:\n\`\`\`${lang}\n${ContextOptimizer.minifyCode(rawCode)}\n\`\`\`\n\n`;
      } else {
        const docText = editor.document.getText();
        const minifiedText = ContextOptimizer.minifyCode(docText);
        const maxChars = 12000;
        
        const astManager = ASTManager.getInstance();
        if (minifiedText.length > maxChars && astManager.isReady()) {
          const symbols = astManager.getLocalSymbols(lang, docText);
          const skeleton = symbols.map(s => `// ${s.kind}: ${s.name}\n${s.signature} { ... }`).join('\n\n');
          contextStr += `Esqueleto do Arquivo Aberto (${path.basename(editor.document.fileName)}):\n\`\`\`${lang}\n${skeleton}\n\`\`\`\n\n`;
        } else {
          const truncatedText = minifiedText.length > maxChars ? minifiedText.substring(0, maxChars) + '\n... [Conteúdo Truncado]' : minifiedText;
          contextStr += `Código do Arquivo Aberto (${path.basename(editor.document.fileName)}):\n\`\`\`${lang}\n${truncatedText}\n\`\`\`\n\n`;
        }
      }
      
      // Snippets Jaccard (apenas se houver texto de pergunta)
      if (text) {
        try {
          const snippets = OpenTabsAgent.getInstance().getRelevantSnippets(editor.document, text, 2);
          if (snippets.length > 0) {
            contextStr += `Contexto Adicional de Outros Arquivos:\n`;
            for (const s of snippets) {
              contextStr += `- Do arquivo "${s.filePath}":\n\`\`\`\n${s.content}\n\`\`\`\n\n`;
            }
          }
        } catch (err) {
          console.error('[ChatViewProvider] Falha ao coletar contexto Jaccard:', err);
        }
      }
    }

    // Definir os system prompts ricos baseados nas habilidades desejadas
    let mcpToolsStr = '';
    if (mcpManager.isReady('filesystem')) {
      mcpToolsStr += `,
{
  "name": "read_file",
  "description": "Lê o conteúdo de um arquivo no disco local.",
  "arguments": { "path": "caminho absoluto do arquivo" }
}`;
    }
    if (mcpManager.isReady('memory')) {
      mcpToolsStr += `,
{
  "name": "create_entities",
  "description": "Cria entidades no Grafo de Memória para lembrar fatos ou conceitos importantes.",
  "arguments": {
    "entities": [{ "name": "nome", "entityType": "tipo", "observations": ["fatos sobre a entidade"] }]
  }
}`;
    }
    if (mcpManager.isReady('thinking')) {
      mcpToolsStr += `,
{
  "name": "sequentialthinking",
  "description": "Ferramenta para raciocínio profundo passo a passo antes de responder o usuário.",
  "arguments": { "thought": "Seu raciocínio atual", "thoughtNumber": 1, "totalThoughts": 3, "nextThoughtNeeded": true }
}`;
    }

    const BASE_SYSTEM_PROMPT = `Você é o Kuben, um motor de IA estritamente focado em código.
REGRAS OBRIGATÓRIAS:
<rules>
1. Seja absolutamente direto. NUNCA use formalidades ou divagações (ex: "Aqui está o código...", "Claro!").
2. Sempre use blocos de código em markdown (ex: \`\`\`javascript).
3. Seja conciso e retorne APENAS a solução técnica solicitada.
4. Para modificar arquivos, acione a ferramenta aplicar_modificacao emitindo JSON na tag <tool_call>.
</rules>

<tools>
{
  "name": "aplicar_modificacao",
  "description": "Substitui um bloco de código existente por um novo bloco no editor ativo.",
  "arguments": {
    "oldBlock": "o código antigo exatamente como está no arquivo",
    "newBlock": "o código modificado"
  }
}${mcpToolsStr}
</tools>

Para usar ferramentas, responda APENAS com:
<tool_call>
{
  "name": "nome_da_ferramenta",
  "arguments": { ... }
}
</tool_call>`;
    
    let systemPrompt = BASE_SYSTEM_PROMPT;
    let prompt = '';

    if (mode === '/explain') {
      systemPrompt += "\nSua missão é explicar o código fornecido de forma direta, técnica e detalhada.";
      prompt = `${contextStr}${text ? `Dúvida ou detalhes adicionais do usuário: ${text}\n\n` : ''}Por favor, explique detalhadamente o código acima.`;
    } else if (mode === '/fix') {
      systemPrompt += "\nSua missão é atuar como um especialista sênior em depuração (debugging). Identifique e corrija os erros de forma cirúrgica e objetiva.";
      prompt = `${contextStr}${text ? `Problema específico apontado pelo usuário: ${text}\n\n` : ''}Analise o código acima, identifique problemas e forneça a versão corrigida e melhorada.`;
    } else if (mode === '/test') {
      systemPrompt += "\nSua missão é gerar testes unitários robustos e diretos para o código fornecido.";
      prompt = `${contextStr}${text ? `Especificações ou requisitos de teste do usuário: ${text}\n\n` : ''}Por favor, gere os testes unitários correspondentes para o código acima.`;
    } else if (mode === '/doc') {
      systemPrompt += "\nSua missão é adicionar comentários de documentação de alto padrão sem modificar a lógica.";
      prompt = `${contextStr}${text ? `Diretrizes específicas de documentação do usuário: ${text}\n\n` : ''}Por favor, adicione comentários de documentação detalhados e formate o código acima.`;
    } else if (mode === '/diagnose') {
      systemPrompt += "\nSua missão é atuar como um especialista sênior em resolução de problemas, analisando os erros do LSP relatados e fornecendo a correção cirúrgica.";
      
      let diagnosticsStr = "Nenhum arquivo ativo para diagnosticar.";
      if (editor) {
         diagnosticsStr = DiagnosticsTool.getDiagnosticsForDocument(editor.document);
      }
      
      prompt = `${contextStr}\nRELATÓRIO DO COMPILADOR/LSP:\n\`\`\`text\n${diagnosticsStr}\n\`\`\`\n\n${text ? `Comentário do desenvolvedor: ${text}\n\n` : ''}Por favor, explique o motivo do(s) erro(s) e gere o código corrigido.`;
    } else {
      prompt = `${contextStr}Pergunta do Desenvolvedor: ${text}`;
    }

    if (this.history.length === 0) {
      this.history.push({
        role: 'system',
        content: systemPrompt
      });
    } else {
      // Atualizar o prompt do sistema no histórico se mudarmos de modo
      this.history[0] = { role: 'system', content: systemPrompt };
    }

    this.history.push({ role: 'user', content: prompt });

    let reply = '';
    try {
      this.history = ContextOptimizer.compressHistory(this.history, 5); // Otimiza a memória
      
      for await (const chunk of this.client.generateChatStream(this.history)) {
        reply += chunk;
        this._view.webview.postMessage({ type: 'chunk', text: chunk });
      }
      this.history.push({ role: 'assistant', content: reply });

      // --- Início do Loop ReAct ---
      if (reply.includes('<tool_call>')) {
        const toolCallStr = reply.split('<tool_call>')[1].replace('</tool_call>', '').trim();
        try {
          const toolData = JSON.parse(toolCallStr);
          if (toolData.name === 'aplicar_modificacao') {
            this._view.webview.postMessage({ type: 'chunk', text: '\n\n*[⚙️ Executando aplicar_modificacao...]*\n' });
            
            const { EditorTool } = require('../infrastructure/tools/editorTool');
            const editor = vscode.window.activeTextEditor;
            
            if (editor) {
              const success = await EditorTool.applyBlockEdit(editor.document, toolData.arguments.oldBlock, toolData.arguments.newBlock);
              const toolResult = success 
                ? "SUCESSO: O bloco foi substituído no editor." 
                : "FALHA: O `oldBlock` não foi encontrado. Certifique-se de copiar exatamente como está no arquivo, incluindo indentação.";
              
              // Injeta o resultado da ferramenta de volta no histórico como se fosse o sistema/ambiente
              this.history.push({ role: 'user', content: `[Resultado da Ferramenta]: ${toolResult}\nConclua a sua resposta ao usuário.` });
              
              let followUp = '';
              for await (const chunk of this.client.generateChatStream(this.history)) {
                followUp += chunk;
                this._view.webview.postMessage({ type: 'chunk', text: chunk });
              }
              this.history.push({ role: 'assistant', content: followUp });
            } else {
              this._view.webview.postMessage({ type: 'chunk', text: '\n\n*[❌ Erro: Nenhum editor ativo]*\n' });
            }
          } else {
            // Qualquer outra ferramenta é tratada como uma chamada MCP nativa (read_file, sequentialthinking, create_entities)
            this._view.webview.postMessage({ type: 'chunk', text: `\n\n*[⚙️ Executando MCP: ${toolData.name}...]*\n` });
            const result = await mcpManager.executeTool(toolData.name, toolData.arguments);
            
            let toolResultStr = '';
            if (result.isError) {
              toolResultStr = `Falha na ferramenta MCP: ${result.content[0].text}`;
            } else {
              // Limitar tamanho para não estourar contexto do 1.5B
              const textContent = result.content.map((c: any) => c.text || JSON.stringify(c)).join('\n');
              const safeText = textContent.length > 5000 ? textContent.substring(0, 5000) + '\n...[Truncado]' : textContent;
              toolResultStr = `Resultado MCP:\n${safeText}`;
            }

            this.history.push({ role: 'user', content: `[Resultado da Ferramenta]: ${toolResultStr}\nResponda ao usuário com base no resultado ou continue usando ferramentas se precisar.` });
            
            let followUp = '';
            for await (const chunk of this.client.generateChatStream(this.history)) {
              followUp += chunk;
              this._view.webview.postMessage({ type: 'chunk', text: chunk });
            }
            this.history.push({ role: 'assistant', content: followUp });
          }
        } catch (e) {
          console.error('[Kuben] Erro no parsing da Tool:', e);
          this._view.webview.postMessage({ type: 'chunk', text: '\n\n*[❌ Falha ao processar a ferramenta gerada pela IA]*\n' });
        }
      }
      // --- Fim do Loop ReAct ---
      this._view.webview.postMessage({ type: 'done' });
    } catch (err: any) {
      this._view.webview.postMessage({ type: 'error', text: err.message || String(err) });
    }
  }

  private async handleShortcut(command: string) {
    if (!this._view) return;

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      this._view.webview.postMessage({ type: 'error', text: 'Nenhum editor de texto ativo.' });
      return;
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
      this._view.webview.postMessage({ type: 'error', text: 'Por favor, selecione um bloco de código no editor antes de executar este atalho.' });
      return;
    }

    const selectedText = editor.document.getText(selection);
    const lang = editor.document.languageId;

    let prompt = '';
    if (command === '/explain') {
      prompt = `Explique em detalhes o seguinte código e o que ele faz:\n\`\`\`${lang}\n${selectedText}\n\`\`\``;
    } else if (command === '/fix') {
      prompt = `Encontre possíveis erros/bugs ou gargalos no seguinte código e forneça a versão corrigida:\n\`\`\`${lang}\n${selectedText}\n\`\`\``;
    } else if (command === '/test') {
      prompt = `Crie testes unitários abrangentes para o seguinte código:\n\`\`\`${lang}\n${selectedText}\n\`\`\``;
    } else if (command === '/doc') {
      prompt = `Adicione comentários de documentação detalhados (ex: JSDoc ou docstring) para o seguinte código:\n\`\`\`${lang}\n${selectedText}\n\`\`\``;
    }

    if (this.history.length === 0) {
      this.history.push({
        role: 'system',
        content: `Você é o Kuben, um motor de IA estritamente focado em código.
REGRAS OBRIGATÓRIAS:
<rules>
1. Seja absolutamente direto. NUNCA use formalidades ou divagações (ex: "Aqui está o código...", "Claro!").
2. Sempre use blocos de código em markdown (ex: \`\`\`javascript).
3. Seja conciso e retorne APENAS a solução técnica solicitada.
4. Para chamar ferramentas do sistema, use ESTRITAMENTE a sintaxe <tool_call>nome_ferramenta</tool_call>.
</rules>`
      });
    }

    this.history.push({ role: 'user', content: prompt });

    let reply = '';
    try {
      this.history = ContextOptimizer.compressHistory(this.history, 5); // Otimiza a memória

      for await (const chunk of this.client.generateChatStream(this.history)) {
        reply += chunk;
        this._view.webview.postMessage({ type: 'chunk', text: chunk });
      }
      this.history.push({ role: 'assistant', content: reply });
      this._view.webview.postMessage({ type: 'done' });
    } catch (err: any) {
      this._view.webview.postMessage({ type: 'error', text: err.message || String(err) });
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const htmlPath = path.join(this.extensionUri.fsPath, 'src', 'webview', 'chat.html');
    try {
      let html = fs.readFileSync(htmlPath, 'utf8');
      const nonce = this.getNonce();
      // Substituir os placeholders no HTML
      html = html.replace(/\${nonce}/g, nonce);
      html = html.replace(/\${cspSource}/g, webview.cspSource);
      return html;
    } catch (err) {
      return `<html><body><h3>Erro ao carregar o chat: ${err}</h3></body></html>`;
    }
  }

  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
