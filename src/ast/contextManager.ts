import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SymbolIndexer } from './symbolIndexer';

export interface DependencyContext {
  filePath: string;
  symbolName: string;
  kind: string;
  signature: string;
}

export class ContextManager {
  private static instance: ContextManager | null = null;

  private constructor() {}

  public static getInstance(): ContextManager {
    if (!ContextManager.instance) {
      ContextManager.instance = new ContextManager();
    }
    return ContextManager.instance;
  }

  /**
   * Resolve o contexto de dependências do documento atual e monta o prefixo cirúrgico.
   */
  public getContextualPrefix(
    document: vscode.TextDocument,
    _position: vscode.Position,
    originalPrefix: string
  ): string {
    // 1. Extrair os imports do arquivo ativo
    const imports = this.extractImports(document);
    if (imports.length === 0) {
      return originalPrefix;
    }

    // 2. Resolver as assinaturas de símbolos importados
    const resolvedDeps = this.resolveDependencies(document.fileName, imports);
    if (resolvedDeps.length === 0) {
      return originalPrefix;
    }

    // 3. Formatar o bloco de comentários de contexto de acordo com a linguagem
    const commentBlock = this.formatCommentBlock(document.languageId, resolvedDeps);
    if (!commentBlock) {
      return originalPrefix;
    }

    // 4. Injetar o bloco de comentários no topo do prefixo original
    return commentBlock + '\n' + originalPrefix;
  }

  /**
   * Varre o cabeçalho do arquivo em busca de declarações de imports/requires.
   */
  private extractImports(document: vscode.TextDocument): { symbols: string[]; modulePath: string }[] {
    const imports: { symbols: string[]; modulePath: string }[] = [];
    
    // Ler apenas as primeiras 100 linhas para evitar overhead em arquivos gigantescos
    const scanLimit = Math.min(document.lineCount, 100);
    
    // Regex para ES Imports: import { A, B } from './path' ou import A from './path'
    const esImportRegex = /import\s+(?:([\w*,{}\s]+)\s+from\s+)?['"]([^'"]+)['"]/i;
    
    // Regex para CommonJS Require: const { A, B } = require('./path') ou const A = require('./path')
    const requireRegex = /(?:const|let|var)\s+([\w*,{}\s]+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/i;

    for (let i = 0; i < scanLimit; i++) {
      const line = document.lineAt(i).text.trim();
      
      // Pular linhas de comentários no início
      if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*') || line.startsWith('#')) {
        continue;
      }

      // Parar a varredura se encontrarmos lógica real de código (classe/função no root)
      // para poupar processamento se o arquivo não tiver imports no início
      if (line !== '' && !line.includes('import') && !line.includes('require')) {
        // Se a linha começar com palavras-chave de lógica, encerra
        if (/^(export\s+)?(class|function|const|let|var|function\*|async)\s/i.test(line)) {
          // Mas continua a varredura caso seja apenas uma declaração de variável isolada. 
          // Geralmente, os imports vêm todos no topo do arquivo.
        }
      }

      let match = line.match(esImportRegex);
      if (!match) {
        match = line.match(requireRegex);
      }

      if (match) {
        const rawSymbols = match[1];
        const modulePath = match[2];

        if (modulePath) {
          const symbols = this.parseSymbolString(rawSymbols);
          imports.push({ symbols, modulePath });
        }
      }
    }

    return imports;
  }

  /**
   * Limpa e separa a string de símbolos importados.
   * Ex: "{ OllamaClient, ASTManager }" -> ["OllamaClient", "ASTManager"]
   */
  private parseSymbolString(symbolStr: string | undefined): string[] {
    if (!symbolStr) {
      return [];
    }

    // Se for um import wildcard (* as ns), pegamos o alias
    if (symbolStr.includes('* as')) {
      const parts = symbolStr.split(/\s+/);
      const aliasIndex = parts.indexOf('as');
      if (aliasIndex !== -1 && parts[aliasIndex + 1]) {
        return [parts[aliasIndex + 1].trim()];
      }
    }

    // Limpar chaves, vírgulas e quebras de linha
    const cleanStr = symbolStr.replace(/[{}]/g, '');
    return cleanStr
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.includes('default'));
  }

  /**
   * Resolve caminhos relativos de imports contra o sistema de arquivos e busca suas assinaturas.
   */
  private resolveDependencies(
    activeFileFsPath: string,
    imports: { symbols: string[]; modulePath: string }[]
  ): DependencyContext[] {
    const activeDir = path.dirname(activeFileFsPath);
    const resolvedDeps: DependencyContext[] = [];
    const indexer = SymbolIndexer.getInstance();

    const extensions = ['.ts', '.tsx', '.js', '.jsx'];

    for (const imp of imports) {
      // Ignorar imports globais/node_modules (começam sem ponto e não são absolutos)
      if (!imp.modulePath.startsWith('.') && !path.isAbsolute(imp.modulePath)) {
        continue;
      }

      // Resolver o caminho absoluto do módulo
      const absoluteBase = path.resolve(activeDir, imp.modulePath);
      let targetFile: string | null = null;

      // Tentar encontrar o arquivo físico no disco acrescentando extensões comuns
      for (const ext of extensions) {
        const testPath = absoluteBase + ext;
        if (fs.existsSync(testPath)) {
          targetFile = testPath;
          break;
        }
      }

      // Se não encontrou, testar se é um diretório index (ex: ./myFolder -> ./myFolder/index.ts)
      if (!targetFile && fs.existsSync(absoluteBase) && fs.statSync(absoluteBase).isDirectory()) {
        for (const ext of extensions) {
          const testPath = path.join(absoluteBase, 'index' + ext);
          if (fs.existsSync(testPath)) {
            targetFile = testPath;
            break;
          }
        }
      }

      if (targetFile) {
        // Normalizar o caminho absoluto
        const normalizedTarget = path.normalize(targetFile).replace(/\\/g, '/');

        // Para cada símbolo importado, buscar a assinatura no Indexador
        for (const symName of imp.symbols) {
          const symDef = indexer.getSymbol(normalizedTarget, symName);
          if (symDef) {
            // Caminho relativo ao workspace para o cabeçalho do comentário ficar curto e limpo
            const relativePath = vscode.workspace.asRelativePath(normalizedTarget);
            resolvedDeps.push({
              filePath: relativePath,
              symbolName: symDef.name,
              kind: symDef.kind,
              signature: symDef.signature
            });
          }
        }
      }
    }

    return resolvedDeps;
  }

  /**
   * Formata as dependências encontradas como um bloco de comentários.
   */
  private formatCommentBlock(languageId: string, dependencies: DependencyContext[]): string | null {
    if (dependencies.length === 0) {
      return null;
    }

    // Identificar o estilo de comentário da linguagem
    let commentPrefix = '//';
    if (['python', 'ruby', 'perl', 'shellscript', 'dockerfile'].includes(languageId)) {
      commentPrefix = '#';
    } else if (['html', 'xml'].includes(languageId)) {
      // Tags HTML não suportam injeção de comentários estruturados de forma tão simples,
      // mas podemos usar o bloco <!-- ... -->. No entanto, para simplificar e evitar
      // confundir o FIM em HTML, evitamos ou usamos o padrão.
      return null;
    } else if (['css', 'less', 'scss'].includes(languageId)) {
      commentPrefix = '//'; // SCSS/Less aceitam //, css puro será traduzido em /* */
      if (languageId === 'css') {
        const block = dependencies
          .map(dep => ` * Dependency: ${dep.symbolName} (${dep.kind}) in ${dep.filePath}\n * Signature: ${dep.signature}`)
          .join('\n');
        return `/*\n${block}\n */`;
      }
    }

    // Formatar as dependências
    const lines = [`${commentPrefix} Contexto de Dependências Locais (Graph RAG Light):`];
    for (const dep of dependencies) {
      lines.push(`${commentPrefix} - Do arquivo "${dep.filePath}": ${dep.signature}`);
    }

    return lines.join('\n') + '\n';
  }
}
