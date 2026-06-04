# 🚀 Kuben AI: Autocomplete & Chat Local Inteligente

Uma extensão de alta performance e totalmente local para o VS Code que fornece **sugestões de código inline (autocomplete)**, **chat inteligente** e **reparação automática de código (Auto-Healing)** usando modelos locais da IA via **Ollama**.

Desenvolvida com foco em privacidade absoluta e consumo eficiente de recursos, a Kuben se adapta de forma inteligente a ambientes de hardware restritos (como notebooks sem GPU dedicada), priorizando modelos leves e rápidos.

---

## 📖 Índice
1. [Recursos Principais](#-recursos-principais)
2. [Instalação e Configuração Rápida](#-instalação-e-configuração-rápida)
3. [Como Usar: Passo a Passo](#-como-usar-passo-a-passo)
4. [Guia de Configuração do Ollama](#-guia-de-configuração-do-ollama)
5. [Modelos Recomendados e Requisitos de Hardware](#-modelos-recomendados-e-requisitos-de-hardware)
6. [Configurações do VS Code](#-configurações-do-vs-code)
7. [Segurança e Privacidade](#-segurança-e-privacidade)
8. [Desenvolvimento Local](#-desenvolvimento-local)

---

## ✨ Recursos Principais

*   **Sugestão de Código Inline (FIM)**: Utiliza a técnica *Fill-in-the-Middle* nativa de modelos avançados de codificação para sugerir código exatamente onde seu cursor está, considerando o contexto anterior e posterior.
*   **Auto-Healing (Formatação e Correção Sintática ao Aceitar)**: Ao aceitar uma sugestão pressionando `Tab`, a extensão varre as linhas acima e abaixo automaticamente para:
    1.  **Formatar o código circundante** usando o formatador ativo do VS Code.
    2.  **Identificar erros sintáticos e alertas de linting**, acionando o modelo local para corrigi-los automaticamente em segundo plano.
*   **Chat Integrado na Barra Lateral**: Um painel interativo para conversar com a IA local, enviar trechos de código e usar comandos rápidos como `/explain`, `/fix`, `/test` e `/doc`.
*   **Ações de Código Rápidas (Menu de Contexto)**: Selecione qualquer bloco de código no editor, clique com o botão direito e execute comandos instantâneos de IA.
*   **Telemetria de Desempenho e Aceitação**: Monitore a latência das requisições e a taxa de aceitação das sugestões em tempo real.
*   **Controles Rápidos na Barra de Status**: Ícone interativo na barra de status que reflete o estado do Ollama e permite pausar/retomar o autocomplete com um único clique.

---

## 🚀 Instalação e Configuração Rápida

1.  Certifique-se de que o **Ollama** está instalado e rodando em seu computador (consulte o [Guia do Ollama](#-guia-de-configuração-do-ollama)).
2.  Instale o pacote `.vsix` da Kuben ou procure por **Kuben AI** no Marketplace de Extensões do VS Code.
3.  Abra qualquer arquivo de código suportado (ex: `.ts`, `.py`, `.go`) e comece a digitar. A barra de status mostrará um ícone de faísca `$(sparkle)` se a conexão estiver ativa.

---

## 💻 Como Usar: Passo a Passo

### 1. Autocomplete Inline (Geração Automática)
*   **Como disparar**: Conforme você digita seu código, a Kuben detecta pausas na digitação (debounce de 300ms por padrão) e solicita uma sugestão ao Ollama.
*   **Como aceitar**: Quando uma sugestão cinza (fantasma) aparecer no editor, pressione a tecla **`Tab`**.
*   **Auto-Healing**: No momento em que você aceitar com `Tab`, a Kuben executará um escaneamento rápido nas linhas vizinhas para formatar e auto-corrigir erros gerados por desalinhamentos de parênteses, chaves ou sintaxe quebrada.
*   **Navegar por sugestões**: Caso o modelo retorne mais de uma opção, navegue usando **`Alt + [`** (anterior) e **`Alt + ]`** (próxima).

### 2. Chat Lateral com IA
*   **Acesso**: Clique no ícone de faísca `$(sparkle)` na Barra de Atividades lateral do VS Code.
*   **Como funciona**: Digite qualquer pergunta no campo inferior e pressione **`Ctrl + Enter`** ou clique em **Enviar**.
*   **Contexto Automático**: Se você tiver um bloco de código selecionado no editor de texto ativo ao fazer uma pergunta, o chat enviará automaticamente essa seleção como contexto para que a resposta seja precisa.
*   **Comandos de Atalho Rápidos (Botões)**:
    *   `/explain`: Explica detalhadamente o código selecionado.
    *   `/fix`: Encontra e sugere correção para bugs/alertas na seleção.
    *   `/test`: Cria testes unitários estruturados para a função selecionada.
    *   `/doc`: Escreve comentários de documentação estruturados (ex: JSDoc).

### 3. Menu de Contexto (Botão Direito)
Selecione um bloco de código e clique com o botão direito. Sob o menu, você verá as opções rápidas:
*   **Kuben AI: Explicar Código Selecionado**
*   **Kuben AI: Gerar Testes Unitários**
*   **Kuben AI: Corrigir Problema Detectado** (Aparece ao passar o mouse ou focar linhas que possuem diagnósticos de erro ativos).

### 4. Telemetria e Barra de Status
*   **Ligar/Desligar**: Clique no ícone `$(sparkle) Kuben` na barra de status no canto inferior direito para habilitar ou desabilitar o autocomplete a qualquer momento.
*   **Métricas**: Abra a paleta de comandos (`Ctrl + Shift + P`) e execute: `AI Autocomplete: Exibir Telemetria de Latência`. Isso abrirá um sumário exibindo:
    *   Latência média de processamento local.
    *   Quantidade de tokens gerados por segundo.
    *   Estatísticas de aceitação (sugestões exibidas vs sugestões aceitas).

---

## 🛠️ Guia de Configuração do Ollama

A Kuben necessita do Ollama rodando localmente no seu computador.

### Passos para Configuração:
1.  **Download**: Baixe e instale o instalador para seu sistema operacional em [ollama.com](https://ollama.com).
2.  **Iniciar Servidor**: O instalador geralmente inicia o servidor em segundo plano automaticamente. Você pode verificar se está rodando acessando `http://localhost:11434` no navegador.
3.  **Baixar Modelo**: Baixe o modelo recomendado no seu terminal usando o comando abaixo (exemplo com o modelo padrão leve):
    ```bash
    ollama run qwen2.5-coder:1.5b-base
    ```
4.  **Configurações Especiais de Origem (OLLAMA_ORIGINS)**:
    Se você estiver rodando em uma porta customizada ou utilizando a extensão a partir de contêineres de desenvolvimento (DevContainers) ou WSL, configure a variável de ambiente no seu sistema operacional antes de iniciar o Ollama:
    *   **Windows (PowerShell)**: `$env:OLLAMA_ORIGINS="*"`
    *   **macOS/Linux (Terminal)**: `export OLLAMA_ORIGINS="*"`

---

## 📊 Modelos Recomendados e Requisitos de Hardware

Dependendo do seu hardware (memória RAM livre e GPU de vídeo), escolha o modelo mais adequado nas configurações da extensão para garantir a melhor latência:

| Recomendação | Nome do Modelo | Tamanho (Parâmetros) | Requisito Mínimo de RAM | Desempenho em CPU | Suporte FIM |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Livre/CPU Fraca** | `qwen2.5-coder:1.5b-base` | 1.5 Bilhões | 8 GB RAM | **Excelente** (< 200ms) | Sim |
| **Equilibrado** | `qwen2.5-coder:3b` | 3 Bilhões | 16 GB RAM | **Bom** (~400ms) | Sim |
| **Alternativo** | `codegemma:2b-code` | 2 Bilhões | 16 GB RAM | **Bom** (~300ms) | Sim |
| **GPU Dedicada / Forte** | `qwen2.5-coder:7b` | 7 Bilhões | 24 GB RAM / 8GB VRAM | **Médio** (Requer GPU) | Sim |
| **Avançado / GPU** | `deepseek-coder:6.7b` | 6.7 Bilhões | 24 GB RAM / 8GB VRAM | **Médio** (Requer GPU) | Sim |

> [!TIP]
> Modelos do tipo `-base` (como `qwen2.5-coder:1.5b-base`) são otimizados especificamente para preenchimento de código inline (FIM), sendo muito mais eficientes no editor do que os modelos focados em chat (`-instruct`).

---

## ⚙️ Configurações do VS Code

Ajuste o comportamento da extensão em suas Configurações (`Ctrl + ,` ou `Cmd + ,` buscando por `Kuben AI`):

*   `aiAutocomplete.enabled`: Ativa/desativa o autocomplete inline globalmente.
*   `aiAutocomplete.endpoint`: Endereço HTTP do Ollama (`http://localhost:11434` por padrão).
*   `aiAutocomplete.model`: Nome exato do modelo baixado no Ollama (ex: `qwen2.5-coder:1.5b-base`).
*   `aiAutocomplete.debounceDelay`: Tempo em milissegundos a esperar após você parar de digitar antes de gerar a sugestão (padrão: `300`).
*   `aiAutocomplete.languages`: Lista de IDs de linguagens ativas no autocomplete.
*   `aiAutocomplete.formatOnAccept`: Executa auto-formatação nas linhas afetadas ao aceitar sugestões (padrão: `true`).
*   `aiAutocomplete.correctErrorsOnAccept`: Corrige erros sintáticos circundantes usando o Ollama em segundo plano após o aceite (padrão: `true`).
*   `aiAutocomplete.autoCorrectionLinesRange`: Janela de linhas acima e abaixo do cursor analisadas durante o auto-healing (padrão: `5`).

---

## 🔒 Segurança e Privacidade

A Kuben foi desenvolvida para ser totalmente privada:
*   **Sem telemetria externa**: Seus dados de código não são enviados para nenhum servidor na nuvem. Toda a geração é processada estritamente no seu localhost.
*   **Content Security Policy (CSP)**: O painel de chat utiliza políticas de segurança rigorosas (CSP com `nonces` aleatórios gerados a cada inicialização) para impedir injeção de scripts arbitrários (XSS).
*   **Validação AST**: A auto-correção só aplica substituições se o código resultante passar na validação de parsing do motor sintático interno (`web-tree-sitter`), eliminando o risco de o modelo introduzir erros de sintaxe graves.

---

## 💻 Desenvolvimento Local

Se você deseja modificar a extensão ou colaborar com o projeto:

1.  Clone o repositório.
2.  Instale as dependências:
    ```bash
    npm install
    ```
3.  Inicie a compilação contínua (Watch):
    ```bash
    npm run watch
    ```
4.  Pressione **`F5`** no VS Code para abrir a janela `[Extension Development Host]` de depuração.

---

## 📝 Licença
[MIT](LICENSE)
