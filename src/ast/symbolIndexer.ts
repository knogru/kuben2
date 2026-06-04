import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ASTManager } from './astManager';

export interface SymbolDefinition {
  name: string;
  kind: string;
  signature: string;
}

export class SymbolIndexer {
  private static instance: SymbolIndexer | null = null;
  private index: Map<string, SymbolDefinition[]> = new Map();
  private isScanning = false;

  private constructor() {}

  public static getInstance(): SymbolIndexer {
    if (!SymbolIndexer.instance) {
      SymbolIndexer.instance = new SymbolIndexer();
    }
    return SymbolIndexer.instance;
  }

  /**
   * Varre o workspace e indexa os arquivos JS/TS em segundo plano.
   */
  public async scanWorkspace(): Promise<void> {
    if (this.isScanning) {
      return;
    }

    this.isScanning = true;
    console.log('[SymbolIndexer] Iniciando indexação do workspace em background...');

    try {
      // Procurar arquivos TypeScript e JavaScript relevantes
      // Excluir node_modules, pastas de build/out, etc.
      let files = await vscode.workspace.findFiles(
        '**/*.{ts,js,tsx,jsx}',
        '**/{node_modules,out,dist,bin,build,.git,parsers}/**'
      );

      // Se não encontrou arquivos, aguardar o workspace carregar e tentar novamente
      if (files.length === 0) {
        console.log('[SymbolIndexer] 0 arquivos encontrados. Aguardando workspace carregar (2s)...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        files = await vscode.workspace.findFiles(
          '**/*.{ts,js,tsx,jsx}',
          '**/{node_modules,out,dist,bin,build,.git,parsers}/**'
        );
      }

      console.log(`[SymbolIndexer] Encontrados ${files.length} arquivos para indexar.`);

      // Processar em chunks pequenos com pequenos delays para não travar a CPU/Event Loop
      const chunkSize = 5;
      for (let i = 0; i < files.length; i += chunkSize) {
        const chunk = files.slice(i, i + chunkSize);
        await Promise.all(chunk.map(uri => this.indexFile(uri)));
        
        // Ceder o controle da thread para não congelar o VSCode
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      console.log(`[SymbolIndexer] Varredura do workspace concluída. ${this.index.size} arquivos no cache.`);
    } catch (err) {
      console.error('[SymbolIndexer] Erro durante a varredura do workspace:', err);
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Indexa um único arquivo e atualiza o cache em memória.
   */
  public async indexFile(uri: vscode.Uri): Promise<void> {
    const fsPath = uri.fsPath;
    
    // Normalizar caminhos para evitar inconsistências de barra invertida no Windows
    const normalizedPath = path.normalize(fsPath).replace(/\\/g, '/');

    try {
      const astManager = ASTManager.getInstance();
      
      if (astManager.isReady()) {
        // Ler conteúdo de forma não-bloqueante
        const content = await fs.promises.readFile(fsPath, 'utf8');
        
        // Obter o ID da linguagem
        const ext = path.extname(normalizedPath);
        let languageId = 'javascript';
        if (ext === '.ts') {
          languageId = 'typescript';
        } else if (ext === '.tsx') {
          languageId = 'typescriptreact';
        } else if (ext === '.jsx') {
          languageId = 'javascriptreact';
        }

        const symbols = astManager.getLocalSymbols(languageId, content);
        this.index.set(normalizedPath, symbols);
      } else {
        // Fallback seguro usando DocumentSymbol nativo se o ASTManager não estiver pronto
        const symbols = await this.getLocalSymbolsFallback(uri);
        if (symbols.length > 0) {
          this.index.set(normalizedPath, symbols);
        } else {
          this.index.delete(normalizedPath);
        }
      }
    } catch (err) {
      console.error(`[SymbolIndexer] Falha ao indexar arquivo ${normalizedPath}:`, err);
      this.index.delete(normalizedPath);
    }
  }

  /**
   * Fallback seguro usando DocumentSymbol nativo do VSCode se o parser WASM não estiver carregado.
   */
  private async getLocalSymbolsFallback(uri: vscode.Uri): Promise<SymbolDefinition[]> {
    try {
      const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider',
        uri
      );

      if (!symbols) {
        return [];
      }

      const definitions: SymbolDefinition[] = [];
      
      const traverseSymbols = (syms: vscode.DocumentSymbol[]) => {
        for (const sym of syms) {
          if (
            sym.kind === vscode.SymbolKind.Function ||
            sym.kind === vscode.SymbolKind.Class ||
            sym.kind === vscode.SymbolKind.Method ||
            sym.kind === vscode.SymbolKind.Interface
          ) {
            const kindName = vscode.SymbolKind[sym.kind];
            definitions.push({
              name: sym.name,
              kind: kindName,
              signature: `// ${kindName.toLowerCase()} ${sym.name}` // Assinatura aproximada
            });
          }
          if (sym.children && sym.children.length > 0) {
            traverseSymbols(sym.children);
          }
        }
      };

      traverseSymbols(symbols);
      return definitions;
    } catch (err) {
      // Silenciar erro se o editor ainda estiver iniciando
      return [];
    }
  }

  /**
   * Remove um arquivo do index.
   */
  public removeFile(uri: vscode.Uri): void {
    const normalizedPath = path.normalize(uri.fsPath).replace(/\\/g, '/');
    this.index.delete(normalizedPath);
    console.log(`[SymbolIndexer] Removido arquivo do index: ${normalizedPath}`);
  }

  /**
   * Busca todos os símbolos indexados para um determinado arquivo.
   */
  public getSymbolsForFile(fileFsPath: string): SymbolDefinition[] {
    const normalizedPath = path.normalize(fileFsPath).replace(/\\/g, '/');
    return this.index.get(normalizedPath) || [];
  }

  /**
   * Busca um símbolo específico exportado por um arquivo específico.
   */
  public getSymbol(fileFsPath: string, symbolName: string): SymbolDefinition | null {
    const normalizedPath = path.normalize(fileFsPath).replace(/\\/g, '/');
    const symbols = this.index.get(normalizedPath);
    if (!symbols) {
      return null;
    }
    return symbols.find(s => s.name === symbolName) || null;
  }

  /**
   * Retorna a quantidade total de arquivos indexados.
   */
  public getIndexedFilesCount(): number {
    return this.index.size;
  }
}
