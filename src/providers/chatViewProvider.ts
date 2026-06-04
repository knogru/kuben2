import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { OllamaClient } from '../ollamaClient';
import { OpenTabsAgent } from '../infrastructure/openTabsAgent';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'kuben.chat';
  private _view?: vscode.WebviewView;

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

    webviewView.webview.html = this._getHtmlForWebview();

    // Ouvir mensagens enviadas pela UI do Webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'chat': {
          await this.handleChatQuery(data.text);
          break;
        }
        case 'shortcut': {
          await this.handleShortcut(data.command);
          break;
        }
      }
    });
  }

  private async handleChatQuery(text: string) {
    if (!this._view) return;

    // Compilar contexto: seleção ativa + snippets Jaccard de abas abertas
    const editor = vscode.window.activeTextEditor;
    let contextStr = '';
    
    if (editor) {
      const selection = editor.selection;
      if (!selection.isEmpty) {
        contextStr += `Código Selecionado no Editor:\n\`\`\`${editor.document.languageId}\n${editor.document.getText(selection)}\n\`\`\`\n\n`;
      }
      
      // Snippets Jaccard
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

    const fullPrompt = `${contextStr}Pergunta do Desenvolvedor: ${text}`;
    const systemPrompt = "Você é o Kuben, um assistente de IA extremamente especializado em programação. Ajude o usuário respondendo suas dúvidas de desenvolvimento. Forneça respostas diretas, estruturadas e em português. Quando fornecer blocos de código, use o formato markdown apropriado com a linguagem indicada (ex: ```javascript).";

    try {
      for await (const chunk of this.client.generateStream(fullPrompt, systemPrompt)) {
        this._view.webview.postMessage({ type: 'chunk', text: chunk });
      }
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
    let systemPrompt = "Você é o Kuben, um assistente de IA especializado em programação. Responda em português brasileiro.";

    if (command === '/explain') {
      prompt = `Explique em detalhes o seguinte código e o que ele faz:\n\`\`\`${lang}\n${selectedText}\n\`\`\``;
    } else if (command === '/fix') {
      prompt = `Encontre possíveis erros/bugs ou gargalos no seguinte código e forneça a versão corrigida:\n\`\`\`${lang}\n${selectedText}\n\`\`\``;
    } else if (command === '/test') {
      prompt = `Crie testes unitários abrangentes para o seguinte código:\n\`\`\`${lang}\n${selectedText}\n\`\`\``;
    } else if (command === '/doc') {
      prompt = `Adicione comentários de documentação detalhados (ex: JSDoc ou docstring) para o seguinte código:\n\`\`\`${lang}\n${selectedText}\n\`\`\``;
    }

    try {
      for await (const chunk of this.client.generateStream(prompt, systemPrompt)) {
        this._view.webview.postMessage({ type: 'chunk', text: chunk });
      }
      this._view.webview.postMessage({ type: 'done' });
    } catch (err: any) {
      this._view.webview.postMessage({ type: 'error', text: err.message || String(err) });
    }
  }

  private _getHtmlForWebview(): string {
    const htmlPath = path.join(this.extensionUri.fsPath, 'src', 'webview', 'chat.html');
    try {
      return fs.readFileSync(htmlPath, 'utf8');
    } catch (err) {
      return `<html><body><h3>Erro ao carregar o chat: ${err}</h3></body></html>`;
    }
  }
}
