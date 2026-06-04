import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { OllamaClient, ChatMessage } from '../ollamaClient';
import { OpenTabsAgent } from '../infrastructure/openTabsAgent';

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
      }
    });
  }

  private async handleChatQuery(text: string, mode: string = 'chat') {
    if (!this._view) return;

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
        contextStr += `Código Selecionado no Editor:\n\`\`\`${lang}\n${editor.document.getText(selection)}\n\`\`\`\n\n`;
      } else {
        const docText = editor.document.getText();
        const maxChars = 8000;
        const truncatedText = docText.length > maxChars ? docText.substring(0, maxChars) + '\n... [Conteúdo Truncado]' : docText;
        contextStr += `Código do Arquivo Aberto (${path.basename(editor.document.fileName)}):\n\`\`\`${lang}\n${truncatedText}\n\`\`\`\n\n`;
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
    let systemPrompt = "Você é o Kuben, um assistente de IA extremamente especializado em programação. Ajude o usuário respondendo suas dúvidas de desenvolvimento. Forneça respostas diretas, estruturadas e em português brasileiro. Quando fornecer blocos de código, use o formato markdown apropriado com a linguagem indicada (ex: ```javascript).";
    let prompt = '';

    if (mode === '/explain') {
      systemPrompt = "Você é o Kuben, um especialista em engenharia reversa e análise de código. Sua missão é explicar o código fornecido linha por linha ou bloco por bloco de forma pedagógica, clara e detalhada. Explique a complexidade de tempo/espaço (Big O) se relevante e o fluxo lógico do código. Responda em português brasileiro.";
      prompt = `${contextStr}${text ? `Dúvida ou detalhes adicionais do usuário: ${text}\n\n` : ''}Por favor, explique detalhadamente o código acima.`;
    } else if (mode === '/fix') {
      systemPrompt = "Você é o Kuben, um especialista sênior em depuração (debugging) de software. Sua missão é identificar erros de lógica, vulnerabilidades de segurança, problemas de concorrência, vazamentos de memória ou bugs sintáticos no código fornecido. Apresente o código corrigido e explique detalhadamente as correções aplicadas. Responda em português brasileiro.";
      prompt = `${contextStr}${text ? `Problema específico apontado pelo usuário: ${text}\n\n` : ''}Analise o código acima, identifique problemas e forneça a versão corrigida e melhorada.`;
    } else if (mode === '/test') {
      systemPrompt = "Você é o Kuben, um engenheiro especialista em QA e Testes Automatizados. Sua missão é gerar testes unitários robustos e de alta cobertura (edge cases, caminhos alternativos e erros) para o código fornecido. Use os frameworks mais populares da linguagem em questão. Responda em português brasileiro.";
      prompt = `${contextStr}${text ? `Especificações ou requisitos de teste do usuário: ${text}\n\n` : ''}Por favor, gere os testes unitários correspondentes para o código acima.`;
    } else if (mode === '/doc') {
      systemPrompt = "Você é o Kuben, especialista em escrita técnica e documentação de código. Sua missão é enriquecer o código fornecido com comentários de documentação de alto padrão (ex: JSDoc para JS/TS, Docstrings PEP 257 para Python, godoc para Go). Garanta que os parâmetros, retornos de função e comportamentos complexos sejam documentados de forma clara e limpa. Retorne o código documentado. Responda em português brasileiro.";
      prompt = `${contextStr}${text ? `Diretrizes específicas de documentação do usuário: ${text}\n\n` : ''}Por favor, adicione comentários de documentação detalhados e formate o código acima.`;
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
        content: "Você é o Kuben, um assistente de IA extremamente especializado em programação. Ajude o usuário respondendo suas dúvidas de desenvolvimento. Forneça respostas diretas, estruturadas e em português brasileiro. Quando fornecer blocos de código, use o formato markdown apropriado com a linguagem indicada."
      });
    }

    this.history.push({ role: 'user', content: prompt });

    let reply = '';
    try {
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
