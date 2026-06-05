import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export class MCPManager {
  private static instance: MCPManager | null = null;
  private clients: Map<string, Client> = new Map();

  private constructor() {}

  public static getInstance(): MCPManager {
    if (!MCPManager.instance) {
      MCPManager.instance = new MCPManager();
    }
    return MCPManager.instance;
  }

  public async startServer(id: string, command: string, args: string[]) {
    if (this.clients.has(id)) return;

    try {
      console.log(`[MCP] Iniciando servidor ${id} via ${command} ${args.join(' ')}`);
      const transport = new StdioClientTransport({
        command: process.platform === 'win32' && command === 'npx' ? 'npx.cmd' : command,
        args
      });

      const client = new Client({
        name: `kuben-${id}`,
        version: '1.0.0'
      }, {
        capabilities: { tools: {} }
      });

      await client.connect(transport);
      this.clients.set(id, client);
      console.log(`[MCP] Servidor ${id} conectado!`);
    } catch (e) {
      console.error(`[MCP] Falha ao iniciar servidor ${id}:`, e);
    }
  }

  public async startDefaultServers(workspaceRoot: string) {
    await this.startServer('filesystem', 'npx', ['-y', '@modelcontextprotocol/server-filesystem', workspaceRoot]);
    // Fase 5: Memória e Pensamento Sequencial
    await this.startServer('thinking', 'npx', ['-y', '@modelcontextprotocol/server-sequential-thinking']);
    await this.startServer('memory', 'npx', ['-y', '@modelcontextprotocol/server-memory']);
  }

  public isReady(id: string = 'filesystem'): boolean {
    return this.clients.has(id);
  }

  /**
   * Tenta executar a ferramenta no primeiro servidor que a possuir.
   */
  public async executeTool(name: string, args: any): Promise<any> {
    for (const [id, client] of this.clients.entries()) {
      try {
        const result = await client.callTool({ name, arguments: args });
        return result;
      } catch (e: any) {
        // Se a ferramenta não for deste servidor, o SDK lança erro MethodNotFound.
        // Ignoramos e tentamos no próximo, a menos que o erro seja de execução
        if (!e.message?.includes('Method not found') && !e.message?.includes('Unknown tool')) {
          return { isError: true, content: [{ type: 'text', text: `[${id}] Erro: ` + (e.message || String(e)) }] };
        }
      }
    }
    return { isError: true, content: [{ type: 'text', text: `Ferramenta '${name}' não encontrada em nenhum servidor MCP.` }] };
  }
}

