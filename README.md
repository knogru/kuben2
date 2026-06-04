# AI Autocomplete (Local)

Uma extensão leve e eficiente para o VS Code que fornece sugestões de código inline (autocomplete) usando modelos locais da IA via **Ollama**.

Desenvolvida com foco em ambientes com restrição de hardware (ex: CPUs sem GPU dedicada), priorizando modelos com menos de 3 bilhões de parâmetros, como `qwen2.5-coder:1.5b`.

---

## 🚀 Funcionalidades

- **Sugestão de Código Inline (FIM):** Utiliza a técnica de Fill-in-the-Middle nativa de modelos como Qwen2.5-Coder e CodeGemma.
- **Cancelamento Rápido com AbortController:** Cancela requisições passadas imediatamente caso o usuário continue digitando, evitando gargalos e lentidão.
- **Debounce Configurável:** Aguarda um intervalo de silêncio na digitação antes de enviar a requisição ao modelo local.
- **Barra de Status Interativa:** Mostra se o autocomplete está ativo, exibe um spinner animado `$(sync~spin)` durante a geração e permite desativar/ativar com um clique.
- **Suporte Dinâmico a Múltiplas Linguagens:** Funciona por padrão em `javascript`, `typescript`, `python`, `go`, `rust`, `c`, `cpp`, `html`, `css` (e mais, via configuração).
- **Limpeza Inteligente de Prosa:** Filtra respostas de modelos pequenos para evitar que explicações em linguagem natural ou marcações markdown entrem no seu arquivo.

---

## 🛠️ Requisitos e Configuração do Ollama

1. Instale o [Ollama](https://ollama.com/) no seu sistema.
2. Baixe o modelo recomendado para testes (leve e rápido em CPU):
   ```bash
   ollama run qwen2.5-coder:1.5b
   ```
3. Garanta que o servidor Ollama está de pé em `http://localhost:11434`. Você pode testar no terminal:
   ```bash
   curl http://localhost:11434/api/tags
   ```

---

## ⚙️ Configurações da Extensão

Você pode configurar a extensão abrindo as Configurações do VS Code (`Ctrl+,` ou `Cmd+,`) e procurando por `AI Autocomplete`:

| Configuração | Tipo | Valor Padrão | Descrição |
|--------------|------|--------------|-----------|
| `aiAutocomplete.enabled` | Boolean | `true` | Habilita/Desabilita o autocomplete. |
| `aiAutocomplete.endpoint` | String | `http://localhost:11434` | URL do servidor Ollama. |
| `aiAutocomplete.model` | String | `qwen2.5-coder:1.5b` | Nome do modelo instalado no Ollama. |
| `aiAutocomplete.maxTokens` | Integer | `20` | Quantidade máxima de tokens gerados por sugestão. |
| `aiAutocomplete.debounceDelay` | Integer | `300` | Delay do debounce em milissegundos. |
| `aiAutocomplete.maxContextLines` | Integer | `30` | Quantidade de linhas acima do cursor enviadas como contexto. |
| `aiAutocomplete.languages` | Array | `["javascript", "typescript", ...]` | Linguagens ativas. |

---

## 💻 Desenvolvimento e Depuração

Para rodar e testar a extensão localmente em modo de desenvolvimento:

1. Abra a pasta do projeto no VS Code.
2. Certifique-se de que as dependências do Node.js estão instaladas:
   ```bash
   npm install
   ```
3. Pressione **`F5`** (ou selecione a aba Run and Debug e clique em **"Run Extension"**).
4. Uma nova janela do VS Code ("[Extension Development Host]") se abrirá. nela, abra qualquer arquivo compatível (ex: um arquivo `.js` ou `.ts`) e comece a digitar para ver as sugestões inline.

---

## 📦 Empacotamento

Se desejar empacotar a extensão em um arquivo `.vsix` para instalar manualmente ou compartilhar:

1. Instale a ferramenta CLI do VS Code:
   ```bash
   npm install -g @vscode/vsce
   ```
2. Execute o comando de empacotamento:
   ```bash
   vsce package
   ```
3. Instale o arquivo `.vsix` gerado arrastando-o para a barra lateral de extensões do VS Code ou usando o comando:
   ```bash
   code --install-extension ai-autocomplete-vscode-0.1.0.vsix
   ```

---

## 📝 Licença

[MIT](LICENSE)
