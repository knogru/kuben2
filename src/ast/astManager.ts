import * as vscode from 'vscode';
import * as TreeSitter from 'web-tree-sitter';

export class ASTManager {
  private static instance: ASTManager | null = null;
  private parser: TreeSitter.Parser | null = null;
  private languages: Map<string, TreeSitter.Language> = new Map();
  private isInitialized = false;

  private constructor() {}

  public static getInstance(): ASTManager {
    if (!ASTManager.instance) {
      ASTManager.instance = new ASTManager();
    }
    return ASTManager.instance;
  }

  /**
   * Inicializa o motor web-tree-sitter e carrega as gramáticas WASM.
   */
  public async initialize(extensionUri: vscode.Uri): Promise<boolean> {
    if (this.isInitialized) {
      return true;
    }

    try {
      console.log('[ASTManager] Inicializando Web-Tree-Sitter...');
      
      const wasmPath = vscode.Uri.joinPath(extensionUri, 'parsers', 'tree-sitter.wasm').fsPath;
      
      // Inicializar o motor principal
      await TreeSitter.Parser.init({
        locateFile: () => wasmPath
      });

      this.parser = new TreeSitter.Parser();

      // Carregar gramáticas de linguagem
      const languagesToLoad = [
        { id: 'typescript', file: 'tree-sitter-typescript.wasm' },
        { id: 'typescriptreact', file: 'tree-sitter-tsx.wasm' },
        { id: 'javascript', file: 'tree-sitter-javascript.wasm' },
        { id: 'javascriptreact', file: 'tree-sitter-javascript.wasm' }
      ];

      for (const lang of languagesToLoad) {
        const langPath = vscode.Uri.joinPath(extensionUri, 'parsers', lang.file).fsPath;
        try {
          const loadedLanguage = await TreeSitter.Language.load(langPath);
          this.languages.set(lang.id, loadedLanguage);
          console.log(`[ASTManager] Gramática para '${lang.id}' carregada com sucesso.`);
        } catch (langErr) {
          console.error(`[ASTManager] Falha ao carregar gramática para '${lang.id}':`, langErr);
        }
      }

      // Só marcar como inicializado se pelo menos uma gramática carregou
      if (this.languages.size === 0) {
        console.error('[ASTManager] Nenhuma gramática carregou. Motor AST desativado.');
        this.isInitialized = false;
        this.parser = null;
        return false;
      }

      this.isInitialized = true;
      console.log(`[ASTManager] Motor AST inicializado com ${this.languages.size} gramática(s).`);
      return true;
    } catch (err) {
      console.error('[ASTManager] Erro fatal na inicialização do Web-Tree-Sitter:', err);
      this.isInitialized = false;
      this.parser = null;
      return false;
    }
  }

  /**
   * Retorna se o motor de AST está ativo e carregado.
   */
  public isReady(): boolean {
    return this.isInitialized && this.parser !== null;
  }

  /**
   * Parseia uma string de código para a linguagem especificada.
   * Retorna a árvore sintática (Tree) ou null caso falhe.
   */
  public parse(languageId: string, code: string): TreeSitter.Tree | null {
    if (!this.isReady() || !this.parser) {
      return null;
    }

    const language = this.languages.get(languageId);
    if (!language) {
      // Linguagem não suportada pelo tree-sitter
      return null;
    }

    try {
      this.parser.setLanguage(language);
      return this.parser.parse(code);
    } catch (err) {
      console.error(`[ASTManager] Erro ao parsear código para '${languageId}':`, err);
      return null;
    }
  }

  /**
   * Obtém a assinatura dos símbolos locais no documento usando a AST do Tree-Sitter.
   * Se falhar ou não estiver inicializado, o chamador deve usar o fallback.
   */
  public getLocalSymbols(languageId: string, code: string): { name: string; kind: string; signature: string }[] {
    const tree = this.parse(languageId, code);
    if (!tree) {
      return [];
    }

    const symbols: { name: string; kind: string; signature: string }[] = [];
    const rootNode = tree.rootNode;

    // Função recursiva simples para varrer a árvore AST em busca de declarações
    const traverse = (node: TreeSitter.Node) => {
      // Declaração de função
      if (node.type === 'function_declaration' || node.type === 'generator_function_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const name = nameNode.text;
          const signature = node.text.split('{')[0].trim(); // Extrai até a abertura de chaves
          symbols.push({ name, kind: 'Function', signature });
        }
      } 
      // Declaração de classe
      else if (node.type === 'class_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const name = nameNode.text;
          // Pega apenas a assinatura da classe (ex: class MyClass extends Base)
          const signature = node.text.split('{')[0].trim();
          symbols.push({ name, kind: 'Class', signature });
        }
      }
      // Declaração de método dentro de classe/objeto
      else if (node.type === 'method_definition') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const name = nameNode.text;
          const signature = node.text.split('{')[0].trim();
          symbols.push({ name, kind: 'Method', signature });
        }
      }

      // Continuar recursão para filhos
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    };

    traverse(rootNode);
    return symbols;
  }
}
