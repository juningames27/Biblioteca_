const fs = require('fs');

const DB_FILE = 'db.json';
const CSV_FILE = 'livros.csv';

// 1. Ler o Banco de Dados atual
const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));

// 2. Ler o arquivo CSV
const csvData = fs.readFileSync(CSV_FILE, 'utf-8');

// 3. Processar as linhas (pula a primeira linha se for o cabeçalho)
const linhas = csvData.split('\n');

let contador = 0;

linhas.forEach((linha, index) => {
    if (index === 0 || linha.trim() === '') return; // Pula cabeçalho e linhas vazias

    // Divide a linha por vírgulas (ajuste para ';' se seu Excel usar ponto e vírgula)
    const colunas = linha.split(','); 

    if (colunas.length >= 3) {
        const novoLivro = {
            id: colunas[0].trim(),
            title: colunas[1].trim(),
            author: colunas[2].trim(),
            status: 'Disponível'
        };

        // Verifica se o livro já existe para não duplicar
        const existe = db.books.find(b => b.id === novoLivro.id);
        if (!existe) {
            db.books.push(novoLivro);
            contador++;
        }
    }
});

// 4. Salvar de volta no db.json
fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

console.log(`✅ Sucesso! ${contador} novos livros foram importados para o sistema.`);