const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());

// Conexão MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("MongoDB conectado!"))
    .catch(err => console.error("Erro MongoDB:", err));

// Schemas
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

// Helpers
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

// LIVROS
app.get("/api/books", async (req, res) => {
    const books = await Book.find({}).lean();
    res.json(sortBooks(books));
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

// EMPRÉSTIMOS
app.get("/api/loans", async (req, res) => {
    const loans = await Loan.find({ status: "Ativo" }).lean();
    res.json(loans);
});

app.get("/api/loans/all", async (req, res) => {
    const loans = await Loan.find({}).lean();
    res.json(loans);
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

// DASHBOARD
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
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
