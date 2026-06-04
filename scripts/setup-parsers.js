const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const destDir = path.join(projectRoot, 'parsers');

// Garantir que o diretório parsers existe
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

// Arquivos a serem copiados
const filesToCopy = [
  {
    src: path.join(projectRoot, 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm'),
    dest: path.join(destDir, 'tree-sitter.wasm')
  },
  {
    src: path.join(projectRoot, 'node_modules', 'tree-sitter-wasms', 'out', 'tree-sitter-typescript.wasm'),
    dest: path.join(destDir, 'tree-sitter-typescript.wasm')
  },
  {
    src: path.join(projectRoot, 'node_modules', 'tree-sitter-wasms', 'out', 'tree-sitter-tsx.wasm'),
    dest: path.join(destDir, 'tree-sitter-tsx.wasm')
  },
  {
    src: path.join(projectRoot, 'node_modules', 'tree-sitter-wasms', 'out', 'tree-sitter-javascript.wasm'),
    dest: path.join(destDir, 'tree-sitter-javascript.wasm')
  },
  {
    src: path.join(projectRoot, 'node_modules', 'tree-sitter-wasms', 'out', 'tree-sitter-python.wasm'),
    dest: path.join(destDir, 'tree-sitter-python.wasm')
  },
  {
    src: path.join(projectRoot, 'node_modules', 'tree-sitter-wasms', 'out', 'tree-sitter-go.wasm'),
    dest: path.join(destDir, 'tree-sitter-go.wasm')
  },
  {
    src: path.join(projectRoot, 'node_modules', 'tree-sitter-wasms', 'out', 'tree-sitter-rust.wasm'),
    dest: path.join(destDir, 'tree-sitter-rust.wasm')
  }
];

console.log('Iniciando cópia dos arquivos WASM...');

for (const item of filesToCopy) {
  try {
    if (fs.existsSync(item.src)) {
      fs.copyFileSync(item.src, item.dest);
      console.log(`Copiado com sucesso: ${path.basename(item.dest)}`);
    } else {
      console.error(`Erro: Arquivo de origem não encontrado em ${item.src}`);
    }
  } catch (err) {
    console.error(`Falha ao copiar ${path.basename(item.dest)}:`, err);
  }
}

console.log('Setup dos parsers concluído.');
