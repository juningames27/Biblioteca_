const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("MongoDB conectado!"))
    .catch(err => console.error("Erro MongoDB:", err));

const bookSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    title: String,
    author: String,
    status: { type: String, default: "Disponível" }
});

const loanSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    studentName: String,
    phone: String,
    school: String,
    grade: String,
    turma: String,
    bookId: String,
    bookTitle: String,
    rentalDate: String,
    returnDate: String,
    status: { type: String, default: "Ativo" },
    deliveredAt: { type: String, default: null },
    renewCount: { type: Number, default: 0 },
    renewalHistory: { type: Array, default: [] }
});

const Book = mongoose.model("Book", bookSchema);
const Loan = mongoose.model("Loan", loanSchema);

function formatDateBR(date) {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

function parseBRDate(brDate) {
    const [day, month, year] = String(brDate).split("/");
    return new Date(Number(year), Number(month) - 1, Number(day));
}

function normalizeBaseId(id) {
    return String(id || "").replace(/\s+ed\.\s*ex\.\d+$/i, "").trim();
}

function sortBooks(books) {
    return books.sort((a, b) => {
        const titleCompare = String(a.title || "").localeCompare(String(b.title || ""), "pt-BR", { sensitivity: "base" });
        if (titleCompare !== 0) return titleCompare;
        const matchA = String(a.id).match(/ed\.\s*ex\.(\d+)$/i);
        const matchB = String(b.id).match(/ed\.\s*ex\.(\d+)$/i);
        return (matchA ? Number(matchA[1]) : 0) - (matchB ? Number(matchB[1]) : 0);
    });
}

async function getNextExemplarNumber(baseId) {
    const normalized = normalizeBaseId(baseId);
    const books = await Book.find({});
    let max = 0;
    for (const book of books) {
        const match = String(book.id).match(/^(.*)\s+ed\.\s*ex\.(\d+)$/i);
        if (!match) continue;
        if (normalizeBaseId(match[1]) === normalized && Number(match[2]) > max) {
            max = Number(match[2]);
        }
    }
    return max + 1;
}

app.get("/", (req, res) => res.send("Servidor Biblioteca NTE Online!"));

app.get("/api/books", async (req, res) => {
    try {
        const books = await Book.find({}).lean();
        res.json(sortBooks(books));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/api/books", async (req, res) => {
    try {
        const baseId = normalizeBaseId(req.body.id).toUpperCase();
        const title = String(req.body.title || "").trim().toUpperCase();
        const author = String(req.body.author || "").trim().toUpperCase();
        const quantity = Number(req.body.quantity || 1);

        if (!baseId) return res.status(400).json({ error: "ID é obrigatório." });
        if (!title) return res.status(400).json({ error: "Título é obrigatório." });
        if (!author) return res.status(400).json({ error: "Autor/Editora é obrigatório." });
        if (!Number.isInteger(quantity) || quantity < 1) return res.status(400).json({ error: "Quantidade inválida." });

        let nextNumber = await getNextExemplarNumber(baseId);
        const newBooks = [];

        for (let i = 0; i < quantity; i++) {
            const newBook = await Book.create({
                id: `${baseId} ed. ex.${nextNumber}`,
                title, author, status: "Disponível"
            });
            newBooks.push(newBook);
            nextNumber++;
        }

        res.json({ message: `${newBooks.length} exemplar(es) cadastrado(s).`, books: newBooks });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put("/api/books/:id", async (req, res) => {
    try {
        const book = await Book.findOne({ id: req.params.id });
        if (!book) return res.status(404).json({ error: "Livro não encontrado." });

        const newTitle = String(req.body.title || "").trim().toUpperCase();
        const newAuthor = String(req.body.author || "").trim().toUpperCase();
        if (!newTitle) return res.status(400).json({ error: "Título é obrigatório." });
        if (!newAuthor) return res.status(400).json({ error: "Autor/Editora é obrigatório." });

        book.title = newTitle;
        book.author = newAuthor;
        await book.save();

        await Loan.updateMany({ bookId: req.params.id }, { bookTitle: newTitle });

        res.json(book);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete("/api/books/:id", async (req, res) => {
    try {
        const book = await Book.findOne({ id: req.params.id });
        if (!book) return res.status(404).json({ error: "Livro não encontrado." });
        if (book.status === "Alugado") return res.status(400).json({ error: "Não é possível remover um livro alugado!" });

        await Book.deleteOne({ id: req.params.id });
        res.json({ message: "Livro removido!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/api/loans", async (req, res) => {
    try {
        const loans = await Loan.find({ status: "Ativo" }).lean();
        res.json(loans);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/api/loans/all", async (req, res) => {
    try {
        const loans = await Loan.find({}).lean();
        res.json(loans);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/api/loans", async (req, res) => {
    try {
        const { studentName, phone, school, grade, turma, bookId, rentalDate: rentalDateValue } = req.body;

        if (!studentName) return res.status(400).json({ error: "Nome do aluno é obrigatório." });
        if (!school) return res.status(400).json({ error: "Escola é obrigatória." });
        if (!grade) return res.status(400).json({ error: "Série é obrigatória." });
        if (!bookId) return res.status(400).json({ error: "Livro é obrigatório." });
        if (!rentalDateValue) return res.status(400).json({ error: "Data do empréstimo é obrigatória." });

        const rentalDate = new Date(rentalDateValue);
        if (isNaN(rentalDate.getTime())) return res.status(400).json({ error: "Data inválida." });

        const book = await Book.findOne({ id: bookId.trim() });
        if (!book) return res.status(404).json({ error: "Livro não encontrado." });
        if (book.status !== "Disponível") return res.status(400).json({ error: "Livro indisponível." });

        const returnDate = new Date(rentalDate);
        returnDate.setMonth(returnDate.getMonth() + 1);

        const newLoan = await Loan.create({
            id: Date.now().toString(),
            studentName, phone, school, grade, turma,
            bookId: book.id, bookTitle: book.title,
            rentalDate: rentalDateValue,
            returnDate: formatDateBR(returnDate),
            status: "Ativo", deliveredAt: null,
            renewCount: 0, renewalHistory: []
        });

        book.status = "Alugado";
        await book.save();

        res.json(newLoan);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put("/api/loans/:id", async (req, res) => {
    try {
        const loan = await Loan.findOne({ id: req.params.id });
        if (!loan) return res.status(404).json({ error: "Empréstimo não encontrado." });

        const fields = ["studentName", "phone", "school", "grade", "turma"];
        fields.forEach(f => { if (req.body[f] !== undefined) loan[f] = req.body[f]; });
        await loan.save();
        res.json(loan);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch("/api/loans/:id/renew", async (req, res) => {
    try {
        const loan = await Loan.findOne({ id: req.params.id });
        if (!loan) return res.status(404).json({ error: "Empréstimo não encontrado." });
        if (loan.status !== "Ativo") return res.status(400).json({ error: "Só é possível renovar empréstimos ativos." });

        const currentReturnDate = parseBRDate(loan.returnDate);
        currentReturnDate.setMonth(currentReturnDate.getMonth() + 1);
        loan.returnDate = formatDateBR(currentReturnDate);
        loan.renewCount = Number(loan.renewCount || 0) + 1;
        loan.renewalHistory = [...(loan.renewalHistory || []), {
            renewedAt: new Date().toISOString(),
            newReturnDate: loan.returnDate
        }];
        await loan.save();

        res.json({ message: "Empréstimo renovado por mais 1 mês.", loan });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch("/api/loans/:id/return", async (req, res) => {
    try {
        const loan = await Loan.findOne({ id: req.params.id });
        if (!loan) return res.status(404).json({ error: "Empréstimo não encontrado." });
        if (loan.status === "Concluído") return res.status(400).json({ error: "Este empréstimo já foi finalizado." });

        const book = await Book.findOne({ id: loan.bookId });
        if (book) { book.status = "Disponível"; await book.save(); }

        loan.status = "Concluído";
        loan.deliveredAt = new Date().toISOString();
        await loan.save();

        res.json({ message: "Entrega confirmada com sucesso.", loan });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete("/api/loans/:id", async (req, res) => {
    try {
        const loan = await Loan.findOne({ id: req.params.id });
        if (!loan) return res.status(404).json({ error: "Empréstimo não encontrado." });

        const book = await Book.findOne({ id: loan.bookId });
        if (book) { book.status = "Disponível"; await book.save(); }

        await Loan.deleteOne({ id: req.params.id });
        res.json({ message: "Empréstimo removido do banco de dados." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/api/dashboard", async (req, res) => {
    try {
        const books = await Book.find({}).lean();
        const loans = await Loan.find({}).lean();

        const totalBooks = books.length;
        const rentedBooks = books.filter(b => b.status === "Alugado").length;
        const today = new Date().setHours(0, 0, 0, 0);

        const lateLoans = loans.filter(l => {
            if (l.status !== "Ativo") return false;
            return parseBRDate(l.returnDate).setHours(0, 0, 0, 0) < today;
        }).length;

        const monthlyData = new Array(12).fill(0);
        loans.forEach(loan => {
            const rental = new Date(loan.rentalDate);
            if (!isNaN(rental.getTime())) monthlyData[rental.getMonth()]++;
            if (Array.isArray(loan.renewalHistory)) {
                loan.renewalHistory.forEach(r => {
                    const rd = new Date(r.renewedAt);
                    if (!isNaN(rd.getTime())) monthlyData[rd.getMonth()]++;
                });
            }
        });

        res.json({ totalBooks, rentedBooks, availableBooks: totalBooks - rentedBooks, lateLoans, monthlyData });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.get("/api/importar-livros", async (req, res) => {
    const books = [
{"id":"8951T999A1 ed. ex.1","title":"A ARTE DA GUERRA","author":"SUNTZU","status":"Disponível"},
{"id":"028.5R484A1 ed. ex.1","title":"A ÁRVORE DOS MEUS QUINTAIS","author":"JONAS RIBEIRO","status":"Disponível"},
{"id":"028.5R484A1 ed. ex.2","title":"A ÁRVORE DOS MEUS QUINTAIS","author":"JONAS RIBEIRO","status":"Disponível"},
{"id":"028.5R484A1 ed. ex.3","title":"A ÁRVORE DOS MEUS QUINTAIS","author":"JONAS RIBEIRO","status":"Disponível"},
{"id":"028.5C578B1 ed. ex.1","title":"A BELA E A FERA","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"028.5C578B1 ed. ex.2","title":"A BELA E A FERA","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"028.5C578B1 ed. ex.3","title":"A BELA E A FERA","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"028.5C578B1 ed. ex.4","title":"A BELA E A FERA","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"028.5C578B1 ed. ex.5","title":"A BELA E A FERA","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"028.5C578B1 ed. ex.6","title":"A BELA E A FERA","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"028.5P579B2 ed. ex.1","title":"A BORBOLETA VIOLETA","author":"MARI PIAIA","status":"Disponível"},
{"id":"8917P987D1 ed. ex.1","title":"A DAMA DE ESPADAS","author":"ALEXANDRE PUSHKIN","status":"Disponível"},
{"id":"8917P987D1 ed. ex.2","title":"A DAMA DE ESPADAS","author":"ALEXANDRE PUSHKIN","status":"Disponível"},
{"id":"8917P987D1 ed. ex.3","title":"A DAMA DE ESPADAS","author":"ALEXANDRE PUSHKIN","status":"Disponível"},
{"id":"IR820W671D1 ed. ex.1","title":"A DECADÊNCIA DA MENTIRA","author":"OSCAR WILDE","status":"Disponível"},
{"id":"IR820W671D1 ed. ex.2","title":"A DECADÊNCIA DA MENTIRA","author":"OSCAR WILDE","status":"Disponível"},
{"id":"IR820W671D1 ed. ex.3","title":"A DECADÊNCIA DA MENTIRA","author":"OSCAR WILDE","status":"Disponível"},
{"id":"851A411D1 ed. ex.1","title":"A DIVINA COMÉDIA - PARAÍSO","author":"DANTE ALICHIERI","status":"Disponível"},
{"id":"851A411D1 ed. ex.2","title":"A DIVINA COMÉDIA - PARAÍSO","author":"DANTE ALICHIERI","status":"Disponível"},
{"id":"851A411D1 ed. ex.3","title":"A DIVINA COMÉDIA - PARAÍSO","author":"DANTE ALICHIERI","status":"Disponível"},
{"id":"B8693G963E1 ed. ex.1","title":"A ESCRAVA ISAURA","author":"BERNARDO GUIMARÃES","status":"Disponível"},
{"id":"B8693G963E1 ed. ex.2","title":"A ESCRAVA ISAURA","author":"BERNARDO GUIMARÃES","status":"Disponível"},
{"id":"B8693G963E1 ed. ex.3","title":"A ESCRAVA ISAURA","author":"BERNARDO GUIMARÃES","status":"Disponível"},
{"id":"B8693A447F1 ed. ex.1","title":"A FALÊNCIA","author":"JULIA LOPES DE ALMEIDA","status":"Disponível"},
{"id":"B8693A447F1 ed. ex.2","title":"A FALÊNCIA","author":"JULIA LOPES DE ALMEIDA","status":"Disponível"},
{"id":"B8693A447F1 ed. ex.3","title":"A FALÊNCIA","author":"JULIA LOPES DE ALMEIDA","status":"Disponível"},
{"id":"B8693S848M1 ed. ex.1","title":"A MÃO E A LUVA","author":"MACHADO DE ASSIS","status":"Disponível"},
{"id":"833K11M1 ed. ex.1","title":"A METAMORFOSE","author":"FRANZ KAFKA","status":"Disponível"},
{"id":"028.5G936M ed. ex.1","title":"A MORENA DA RENDA VERMELHA","author":"FABIANA GUIMARÃES","status":"Disponível"},
{"id":"028.5G936M ed. ex.2","title":"A MORENA DA RENDA VERMELHA","author":"FABIANA GUIMARÃES","status":"Disponível"},
{"id":"028.5G936M ed. ex.3","title":"A MORENA DA RENDA VERMELHA","author":"FABIANA GUIMARÃES","status":"Disponível"},
{"id":"833H766O1 ed. ex.1","title":"A ODISSEIA","author":"HOMERO","status":"Disponível"},
{"id":"028.5C578P1 ed. ex.1","title":"A PEQUENA SEREIA","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"028.5C578P1 ed. ex.2","title":"A PEQUENA SEREIA","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"028.5C578P1 ed. ex.3","title":"A PEQUENA SEREIA","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"028.5C578P1 ed. ex.4","title":"A PEQUENA SEREIA","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"028.5C578P1 ed. ex.5","title":"A PEQUENA SEREIA","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"028.5C578P1 ed. ex.6","title":"A PEQUENA SEREIA","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"8693Q3R2 ed. ex.1","title":"A RELÍQUIA","author":"EÇA DE QUEIRÓS","status":"Disponível"},
{"id":"8693Q3R2 ed. ex.2","title":"A RELÍQUIA","author":"EÇA DE QUEIRÓS","status":"Disponível"},
{"id":"8693Q3R2 ed. ex.3","title":"A RELÍQUIA","author":"EÇA DE QUEIRÓS","status":"Disponível"},
{"id":"155.4J13T1 ed. ex.1","title":"A TIMIDEZ NÃO É UM PROBLEMA","author":"J. S. JACKSON","status":"Disponível"},
{"id":"155.4J13T1 ed. ex.2","title":"A TIMIDEZ NÃO É UM PROBLEMA","author":"J. S. JACKSON","status":"Disponível"},
{"id":"155.4J13T1 ed. ex.3","title":"A TIMIDEZ NÃO É UM PROBLEMA","author":"J. S. JACKSON","status":"Disponível"},
{"id":"180S475V1 ed. ex.1","title":"A VIDA FELIZ","author":"SÊNECA","status":"Disponível"},
{"id":"028.5M386A1 ed. ex.1","title":"ABAIXO A DITADURA","author":"CLÁUDIO MARTINS","status":"Disponível"},
{"id":"028.5M386A1 ed. ex.2","title":"ABAIXO A DITADURA","author":"CLÁUDIO MARTINS","status":"Disponível"},
{"id":"028.5M386A1 ed. ex.3","title":"ABAIXO A DITADURA","author":"CLÁUDIO MARTINS","status":"Disponível"},
{"id":"028.5C842A1 ed. ex.1","title":"ABECEDÁRIO AFRO DE POESIA","author":"SILVIO COSTTA","status":"Disponível"},
{"id":"028.5C842A1 ed. ex.2","title":"ABECEDÁRIO AFRO DE POESIA","author":"SILVIO COSTTA","status":"Disponível"},
{"id":"028.5C842A1 ed. ex.3","title":"ABECEDÁRIO AFRO DE POESIA","author":"SILVIO COSTTA","status":"Disponível"},
{"id":"028.5F853A1 ed. ex.1","title":"ACADEMIA DOS ABRAÇOS","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"028.5C578A1 ed. ex.4","title":"ADA LOVELACE","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"028.5C578A1 ed. ex.5","title":"ADA LOVELACE","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"028.5C578A1 ed. ex.6","title":"ADA LOVELACE","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"028.5P349A1 ed. ex.4","title":"AJUDAR","author":"PÉ DA LETRA","status":"Disponível"},
{"id":"028.5P349A1 ed. ex.5","title":"AJUDAR","author":"PÉ DA LETRA","status":"Disponível"},
{"id":"028.5P349A1 ed. ex.6","title":"AJUDAR","author":"PÉ DA LETRA","status":"Disponível"},
{"id":"028.5C578A1 ed. ex.1","title":"ALICE NO PAÍS DAS MARAVILHAS","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"028.5C578A1 ed. ex.2","title":"ALICE NO PAÍS DAS MARAVILHAS","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"028.5C578A1 ed. ex.3","title":"ALICE NO PAÍS DAS MARAVILHAS","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"B8693A554A1 ed. ex.1","title":"AMAR, VERBO INTRANSITIVO","author":"MARIO DE ANDRADE","status":"Disponível"},
{"id":"B8693A554A1 ed. ex.2","title":"AMAR, VERBO INTRANSITIVO","author":"MARIO DE ANDRADE","status":"Disponível"},
{"id":"B8693A554A1 ed. ex.3","title":"AMAR, VERBO INTRANSITIVO","author":"MARIO DE ANDRADE","status":"Disponível"},
{"id":"028.5P349A1 ed. ex.1","title":"AMIGOS","author":"PÉ DA LETRA","status":"Disponível"},
{"id":"028.5P349A1 ed. ex.2","title":"AMIGOS","author":"PÉ DA LETRA","status":"Disponível"},
{"id":"028.5P349A1 ed. ex.3","title":"AMIGOS","author":"PÉ DA LETRA","status":"Disponível"},
{"id":"028.5C578A1 ed. ex.7","title":"AMIGOS DO ESPAÇO","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"028.5C578A1 ed. ex.8","title":"AMIGOS DO ESPAÇO","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"028.5C578A1 ed. ex.9","title":"ANIMAIS","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"028.5C578A1 ed. ex.10","title":"ANIMAIS","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"028.5C578A1 ed. ex.11","title":"ANIMAIS","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"813T969A1 ed. ex.1","title":"AS AVENTURAS DE TOM SAWYER","author":"MARK TWAIN","status":"Disponível"},
{"id":"813T969A1 ed. ex.2","title":"AS AVENTURAS DE TOM SAWYER","author":"MARK TWAIN","status":"Disponível"},
{"id":"813T969A1 ed. ex.3","title":"AS AVENTURAS DE TOM SAWYER","author":"MARK TWAIN","status":"Disponível"},
{"id":"IR820L433C1 ed. ex.1","title":"CARMILLA A VAMPIRA DE KARNSTEIN","author":"JOSEPH SHERIDAN","status":"Disponível"},
{"id":"IR820L433C1 ed. ex.2","title":"CARMILLA A VAMPIRA DE KARNSTEIN","author":"JOSEPH SHERIDAN","status":"Disponível"},
{"id":"IR820L433C1 ed. ex.3","title":"CARMILLA A VAMPIRA DE KARNSTEIN","author":"JOSEPH SHERIDAN","status":"Disponível"},
{"id":"187E64C1 ed. ex.1","title":"CARTA A MENECEU SOBRE A FELICIDADE E OUTRAS CARTASS","author":"EPICURO","status":"Disponível"},
{"id":"187E64C1 ed. ex.2","title":"CARTA A MENECEU SOBRE A FELICIDADE E OUTRAS CARTASS","author":"EPICURO","status":"Disponível"},
{"id":"187E64C1 ed. ex.3","title":"CARTA A MENECEU SOBRE A FELICIDADE E OUTRAS CARTASS","author":"EPICURO","status":"Disponível"},
{"id":"B8693L796C1 ed. ex.1","title":"CIDADES MORTAS E OUTROS CONTOS","author":"MONTEIRO LOBATO","status":"Disponível"},
{"id":"B8693L796C1 ed. ex.2","title":"CIDADES MORTAS E OUTROS CONTOS","author":"MONTEIRO LOBATO","status":"Disponível"},
{"id":"B8693L796C1 ed. ex.3","title":"CIDADES MORTAS E OUTROS CONTOS","author":"MONTEIRO LOBATO","status":"Disponível"},
{"id":"240A275C1 ed. ex.1","title":"CONFISSÕES","author":"AGASTINHO","status":"Disponível"},
{"id":"240A275C1 ed. ex.2","title":"CONFISSÕES","author":"AGASTINHO","status":"Disponível"},
{"id":"240A275C1 ed. ex.3","title":"CONFISSÕES","author":"AGASTINHO","status":"Disponível"},
{"id":"B8693A55C1 ed. ex.1","title":"CONTOS NOVOS","author":"MÁRIO ANDRADE","status":"Disponível"},
{"id":"B8693A55C1 ed. ex.2","title":"CONTOS NOVOS","author":"MÁRIO ANDRADE","status":"Disponível"},
{"id":"B8693A55C1 ed. ex.3","title":"CONTOS NOVOS","author":"MÁRIO ANDRADE","status":"Disponível"},
{"id":"89173T654D1 ed. ex.1","title":"DE QUANTA TERRA PRECISA UM HOMEM","author":"LIEV TOLSTÓI","status":"Disponível"},
{"id":"89173T654D1 ed. ex.2","title":"DE QUANTA TERRA PRECISA UM HOMEM","author":"LIEV TOLSTÓI","status":"Disponível"},
{"id":"89173T654D1 ed. ex.3","title":"DE QUANTA TERRA PRECISA UM HOMEM","author":"LIEV TOLSTÓI","status":"Disponível"},
{"id":"823O79D1 ed. ex.1","title":"DENTRO DA BALELA E OUTROS ENSAIOS","author":"GEORGE ORWELL","status":"Disponível"},
{"id":"823O79D1 ed. ex.2","title":"DENTRO DA BALELA E OUTROS ENSAIOS","author":"GEORGE ORWELL","status":"Disponível"},
{"id":"823O79D1 ed. ex.3","title":"DENTRO DA BALELA E OUTROS ENSAIOS","author":"GEORGE ORWELL","status":"Disponível"},
{"id":"200.71E57D1 ed. ex.1","title":"DEUS É MEU AMIGO","author":"LISA O. ENGELHARDT","status":"Disponível"},
{"id":"200.71E57D1 ed. ex.2","title":"DEUS É MEU AMIGO","author":"LISA O. ENGELHARDT","status":"Disponível"},
{"id":"200.71E57D1 ed. ex.3","title":"DEUS É MEU AMIGO","author":"LISA O. ENGELHARDT","status":"Disponível"},
{"id":"413071C578D1 ed. ex.1","title":"DICIONARIO ESCOLAR","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"413071C578D1 ed. ex.2","title":"DICIONARIO ESCOLAR","author":"CIRANDA CULTURAL","status":"Disponível"},
{"id":"B8693A368D1 ed. ex.1","title":"DIVA","author":"JOSÉ DE ALENCAR","status":"Disponível"},
{"id":"B8693A368D1 ed. ex.2","title":"DIVA","author":"JOSÉ DE ALENCAR","status":"Disponível"},
{"id":"B8693A368D1 ed. ex.3","title":"DIVA","author":"JOSÉ DE ALENCAR","status":"Disponível"},
{"id":"851411D1 ed. ex.1","title":"DIVINA COMÉDIA - PURGATÓRIO","author":"DANTE ALICHIERI","status":"Disponível"},
{"id":"851411D1 ed. ex.2","title":"DIVINA COMÉDIA - PURGATÓRIO","author":"DANTE ALICHIERI","status":"Disponível"},
{"id":"851411D1 ed. ex.3","title":"DIVINA COMÉDIA - PURGATÓRIO","author":"DANTE ALICHIERI","status":"Disponível"},
{"id":"320R864D1 ed. ex.1","title":"DO CONTRATO SOCIAL","author":"JEAN-JACQUES ROUSSEAU","status":"Disponível"},
{"id":"320R864D1 ed. ex.2","title":"DO CONTRATO SOCIAL","author":"JEAN-JACQUES ROUSSEAU","status":"Disponível"},
{"id":"320R864D1 ed. ex.3","title":"DO CONTRATO SOCIAL","author":"JEAN-JACQUES ROUSSEAU","status":"Disponível"},
{"id":"B8693A848D1 ed. ex.1","title":"DOM CASMURRO","author":"MACHADO DE ASSIS","status":"Disponível"},
{"id":"B8691A474E1 ed. ex.1","title":"ESPUMAS FLUTUANTES","author":"CASTRO ALVES","status":"Disponível"},
{"id":"B8691A474E1 ed. ex.2","title":"ESPUMAS FLUTUANTES","author":"CASTRO ALVES","status":"Disponível"},
{"id":"B8691A474E1 ed. ex.3","title":"ESPUMAS FLUTUANTES","author":"CASTRO ALVES","status":"Disponível"},
{"id":"100A717E1 ed. ex.1","title":"ÉTICA A NICÔMACO","author":"ARISTÓTALES","status":"Disponível"},
{"id":"100A717E1 ed. ex.2","title":"ÉTICA A NICÔMACO","author":"ARISTÓTALES","status":"Disponível"},
{"id":"B8693A662C1 ed. ex.1","title":"GRAÇA ARANHA CANAÃ","author":"PRINCIPIS","status":"Disponível"},
{"id":"B8693A662C1 ed. ex.2","title":"GRAÇA ARANHA CANAÃ","author":"PRINCIPIS","status":"Disponível"},
{"id":"B8693A662C1 ed. ex.3","title":"GRAÇA ARANHA CANAÃ","author":"PRINCIPIS","status":"Disponível"},
{"id":"0285R27RI1 ed. ex.1","title":"ÍRIS E ISAQUE","author":"CATHERINE RAYNER","status":"Disponível"},
{"id":"0285R27RI1 ed. ex.2","title":"ÍRIS E ISAQUE","author":"CATHERINE RAYNER","status":"Disponível"},
{"id":"0285R27RI1 ed. ex.3","title":"ÍRIS E ISAQUE","author":"CATHERINE RAYNER","status":"Disponível"},
{"id":"155.4G313M1 ed. ex.1","title":"MEU CORPO É ESPECIAL","author":"CYNTHIA G","status":"Disponível"},
{"id":"B8693A848A3 ed. ex.1","title":"O ALIENISTA","author":"MACHADO DE ASSIS","status":"Disponível"},
{"id":"B8693A848A3 ed. ex.2","title":"O ALIENISTA","author":"MACHADO DE ASSIS","status":"Disponível"},
{"id":"B8693A848A3 ed. ex.3","title":"O ALIENISTA","author":"MACHADO DE ASSIS","status":"Disponível"},
{"id":"184P716B1 ed. ex.1","title":"O BANQUETE","author":"PLATÃO","status":"Disponível"},
{"id":"184P716B1 ed. ex.2","title":"O BANQUETE","author":"PLATÃO","status":"Disponível"},
{"id":"184P716B1 ed. ex.3","title":"O BANQUETE","author":"PLATÃO","status":"Disponível"},
{"id":"833K11C1 ed. ex.1","title":"O CASTELO","author":"FRANZ KAFKA","status":"Disponível"},
{"id":"833K11C1 ed. ex.2","title":"O CASTELO","author":"FRANZ KAFKA","status":"Disponível"},
{"id":"833K11C1 ed. ex.3","title":"O CASTELO","author":"FRANZ KAFKA","status":"Disponível"},
{"id":"813P743C1 ed. ex.1","title":"O CORVO","author":"EDGAR ALLAN","status":"Disponível"},
{"id":"813P743C1 ed. ex.2","title":"O CORVO","author":"EDGAR ALLAN","status":"Disponível"},
{"id":"813C549D1 ed. ex.1","title":"O DESPERTAR","author":"KATE CHOPIN","status":"Disponível"},
{"id":"813C549D1 ed. ex.2","title":"O DESPERTAR","author":"KATE CHOPIN","status":"Disponível"},
{"id":"89173D724E1 ed. ex.1","title":"O ETERNO MARIDO","author":"FIÓDOR DOSTOIÉVSKI","status":"Disponível"},
{"id":"89173D724E1 ed. ex.2","title":"O ETERNO MARIDO","author":"FIÓDOR DOSTOIÉVSKI","status":"Disponível"},
{"id":"IR820W671F1 ed. ex.1","title":"O FANTASMA DE CANTERVILLE","author":"OSCAR WILDE","status":"Disponível"},
{"id":"840D886B1 ed. ex.1","title":"OS BÓRGIAS","author":"ALEXANDRE DUMAS","status":"Disponível"},
{"id":"840D886B1 ed. ex.2","title":"OS BÓRGIAS","author":"ALEXANDRE DUMAS","status":"Disponível"},
{"id":"840D886B1 ed. ex.3","title":"OS BÓRGIAS","author":"ALEXANDRE DUMAS","status":"Disponível"},
{"id":"B8693B273B1 ed. ex.1","title":"OS BRUZUNDANGAS","author":"LIMA BARRETO","status":"Disponível"},
{"id":"B8693B273B1 ed. ex.2","title":"OS BRUZUNDANGAS","author":"LIMA BARRETO","status":"Disponível"},
{"id":"823A933R1 ed. ex.1","title":"RAZÃO E SENSIBILIDADE","author":"JANE AUSTEN","status":"Disponível"},
{"id":"2995T999T1ED ed. ex.1","title":"TAO TE CHING - O LIVRO DO CAMINHO E DA VIRTUDE","author":"LAO TZU","status":"Disponível"},
{"id":"2995T999T1ED ed. ex.2","title":"TAO TE CHING - O LIVRO DO CAMINHO E DA VIRTUDE","author":"LAO TZU","status":"Disponível"},
{"id":"2995T999T1ED ed. ex.3","title":"TAO TE CHING - O LIVRO DO CAMINHO E DA VIRTUDE","author":"LAO TZU","status":"Disponível"},
{"id":"B8693A368T3 ed. ex.1","title":"TIL","author":"JOSÉ DE ALENCAR","status":"Disponível"},
{"id":"B8693A368T3 ed. ex.2","title":"TIL","author":"JOSÉ DE ALENCAR","status":"Disponível"},
{"id":"B8693A368T3 ed. ex.3","title":"TIL","author":"JOSÉ DE ALENCAR","status":"Disponível"},
{"id":"823D548C1 ed. ex.1","title":"UM CONTO DE DUAS CIDADES","author":"CHARLES DICKENS","status":"Disponível"},
{"id":"823D548C1 ed. ex.2","title":"UM CONTO DE DUAS CIDADES","author":"CHARLES DICKENS","status":"Disponível"},
{"id":"823D548C1 ed. ex.3","title":"UM CONTO DE DUAS CIDADES","author":"CHARLES DICKENS","status":"Disponível"},
{"id":"B8693L796U1 ed. ex.1","title":"URUPÊS","author":"MONTEIRO LOBATO","status":"Disponível"},
{"id":"B8693L796U1 ed. ex.2","title":"URUPÊS","author":"MONTEIRO LOBATO","status":"Disponível"},
{"id":"B8693L796U1 ed. ex.3","title":"URUPÊS","author":"MONTEIRO LOBATO","status":"Disponível"}
    ];

    let inseridos = 0;
    let ignorados = 0;
    for (const book of books) {
        try {
            await Book.create(book);
            inseridos++;
        } catch (e) {
            ignorados++;
        }
    }
    res.json({ message: `✅ ${inseridos} inseridos, ${ignorados} ignorados.` });
});
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
