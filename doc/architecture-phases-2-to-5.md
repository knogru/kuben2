# Arquitetura de Agente Local: Implementação das Fases 2 a 5

Este documento sumariza a engenharia aplicada para transformar a extensão Kuben de um simples Autocomplete/Chat em um **Agente de Código Autônomo Nível 3**, otimizado para rodar localmente com LLMs de baixo custo (1.5B a 3B parâmetros) como Qwen2.5-Coder e DeepSeek-Coder.

## Fase 2: Integração com o Ambiente e Ferramentas Físicas (O Corpo)
O objetivo desta fase foi dar ao modelo a capacidade de ver os erros do compilador e de alterar fisicamente o código sem exigir que o usuário copie e cole respostas.

- **`DiagnosticsTool` (`src/infrastructure/tools/diagnosticsTool.ts`)**: Inspeciona a API `vscode.languages.getDiagnostics()` e converte o payload complexo do LSP em strings limpas e legíveis. Acionado sob demanda via o comando oculto `/diagnose`.
- **`EditorTool` (`src/infrastructure/tools/editorTool.ts`)**: Implementa buscas e substituições cirúrgicas utilizando `vscode.WorkspaceEdit`. O modelo envia um `oldBlock` e `newBlock`, e a ferramenta faz o *replace* exato, preservando indentação e poupando milhares de tokens gerados.
- **Loop ReAct Autônomo**: O `chatViewProvider.ts` foi modificado para interceptar requisições em *streaming*. Quando a tag `<tool_call>` é detectada, o fluxo é pausado, a ferramenta é executada nativamente em Node.js e o `[Resultado da Ferramenta]` é injetado silenciosamente no histórico da IA, forçando-a a reagir à própria ação.

## Fase 3: Otimização Extrema de Tokens e Contexto (O Cérebro)
Modelos de 1.5B "alucinam" ou travam quando o contexto ultrapassa 4.000 tokens. Esta fase blindou a memória.

- **Compressão e Minificação (`ContextOptimizer.ts`)**: 
  - Arquivos ativos são minificados: espaços duplos, múltiplas quebras de linha e `console.log` são removidos via Regex antes de tocar na IA, permitindo expandir a janela de leitura de 8.000 para 12.000 caracteres reais.
  - A *Sliding Window* limita o histórico aos últimos 5 turnos vitais, expurgando payloads JSON de uso de ferramentas passadas que não importam mais para a conversa atual.
- **Esqueletização via AST**: Arquivos que excedem o limite seguro (12.000+ chars) não são mais truncados "cegamente". A extensão utiliza o `ASTManager` (web-tree-sitter) para dissecar o arquivo em milissegundos e entregar para a IA apenas as assinaturas, interfaces, classes e métodos, ocultando a lógica interna (`{ ... }`).

## Fase 4 e 5: Escalando Habilidades com MCP e Raciocínio (A Consciência)
Em vez de reinventar a roda criando ferramentas locais para tudo, o agente foi conectado ao **Model Context Protocol (MCP)**, o padrão aberto da Anthropic.

- **`MCPManager` (`src/infrastructure/mcpManager.ts`)**: Um roteador de servidores stdi/o.
- Servidores levantados em *background* via `npx`:
  1. **`server-filesystem` (Exploração)**: Expõe a ferramenta `read_file` dinamicamente no System Prompt. O modelo local pode agora navegar livremente pelos arquivos do disco sem depender de um servidor RAG pesado indexando tudo no boot.
  2. **`server-sequential-thinking` (Raciocínio Profundo)**: Introduz a ferramenta `sequentialthinking`. Permite ao agente iterar logicamente (`thoughtNumber: 1, 2, 3...`) antes de cuspir o código final. Essencial para contornar a falta de profundidade inata dos modelos pequenos.
  3. **`server-memory` (Memória Longa)**: Adiciona o `create_entities` ao arsenal, permitindo que a IA registre num grafo de conhecimento local as preferências do desenvolvedor ou decisões arquiteturais.
- **Roteamento Universal**: O Loop ReAct no `chatViewProvider.ts` tornou-se um *proxy* genérico. Qualquer ferramenta que o modelo usar e que não for estritamente local (como a `aplicar_modificacao`), é disparada para o `MCPManager`, que descobre qual servidor deve processá-la.
