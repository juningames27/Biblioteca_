const API_URL = "http://localhost:3000/api";
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

const DB_FILE = path.join(__dirname, "db.json");

if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ books: [], loans: [] }, null, 2));
}

function readDB() {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

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

function getNextExemplarNumber(books, baseId) {
    const normalizedBaseId = normalizeBaseId(baseId);

    let max = 0;

    for (const book of books) {
        const bookId = String(book.id || "").trim();
        const match = bookId.match(/^(.*)\s+ed\.\s*ex\.(\d+)$/i);

        if (!match) continue;

        const currentBaseId = normalizeBaseId(match[1]);
        const exemplarNumber = Number(match[2]);

        if (currentBaseId === normalizedBaseId && exemplarNumber > max) {
            max = exemplarNumber;
        }
    }

    return max + 1;
}

function sortBooks(books) {
    books.sort((a, b) => {
        const titleCompare = String(a.title || "").localeCompare(String(b.title || ""), "pt-BR", {
            sensitivity: "base"
        });

        if (titleCompare !== 0) return titleCompare;

        const baseA = normalizeBaseId(a.id);
        const baseB = normalizeBaseId(b.id);

        const baseCompare = baseA.localeCompare(baseB, "pt-BR", { sensitivity: "base" });
        if (baseCompare !== 0) return baseCompare;

        const matchA = String(a.id).match(/ed\.\s*ex\.(\d+)$/i);
        const matchB = String(b.id).match(/ed\.\s*ex\.(\d+)$/i);

        const numA = matchA ? Number(matchA[1]) : 0;
        const numB = matchB ? Number(matchB[1]) : 0;

        return numA - numB;
    });
}

app.get("/", (req, res) => {
    res.send("Servidor Biblioteca NTE Online!");
});

/* LIVROS */

app.get("/api/books", (req, res) => {
    const db = readDB();
    sortBooks(db.books);
    res.json(db.books);
});

app.post("/api/books", (req, res) => {
    const db = readDB();

    const baseId = normalizeBaseId(req.body.id);
    const title = String(req.body.title || "").trim();
    const author = String(req.body.author || "").trim();
    const quantity = Number(req.body.quantity || 1);

    if (!baseId) {
        return res.status(400).json({ error: "ID é obrigatório." });
    }

    if (!title) {
        return res.status(400).json({ error: "Título é obrigatório." });
    }

    if (!author) {
        return res.status(400).json({ error: "Autor é obrigatório." });
    }


    app.post("/api/books", (req, res) => {
        const db = readDB();

        const baseId = String(req.body.id || "").trim();
        const title = String(req.body.title || "").trim();
        const author = String(req.body.author || "").trim();
        const quantity = Number(req.body.quantity || 1);

        if (!baseId) {
            return res.status(400).json({ error: "ID é obrigatório." });
        }

        if (!title) {
            return res.status(400).json({ error: "Título é obrigatório." });
        }

        if (!author) {
            return res.status(400).json({ error: "Autor é obrigatório." });
        }

        if (quantity < 1) {
            return res.status(400).json({ error: "Quantidade inválida." });
        }

        const newBooks = [];

        for (let i = 1; i <= quantity; i++) {
            const newId = `${baseId} ed. ex.${i}`;

            const exists = db.books.find((b) => String(b.id) === newId);
            if (exists) {
                continue; // evita duplicado
            }

            const newBook = {
                id: newId,
                title,
                author,
                status: "Disponível",
            };

            db.books.push(newBook);
            newBooks.push(newBook);
        }

        writeDB(db);

        res.json({
            message: `${newBooks.length} exemplares cadastrados.`,
            books: newBooks
        });
    });

    if (!Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({ error: "Quantidade inválida." });
    }


    const newBooks = [];
    let nextNumber = getNextExemplarNumber(db.books, baseId);

    for (let i = 0; i < quantity; i++) {
        const newId = `${baseId} ed. ex.${nextNumber}`;

        const newBook = {
            id: newId,
            title,
            author,
            status: "Disponível"
        };

        db.books.push(newBook);
        newBooks.push(newBook);
        nextNumber++;
    }

    sortBooks(db.books);
    writeDB(db);

    res.json({
        message: `${newBooks.length} exemplar(es) cadastrado(s).`,
        books: newBooks
    });
});

app.put("/api/books/:id", (req, res) => {
    const db = readDB();
    const bookId = String(req.params.id);
    const bookIndex = db.books.findIndex((b) => String(b.id) === bookId);

    if (bookIndex === -1) {
        return res.status(404).json({ error: "Livro não encontrado." });
    }

    const newTitle = String(req.body.title || "").trim();
    const newAuthor = String(req.body.author || "").trim();

    if (!newTitle) {
        return res.status(400).json({ error: "Título é obrigatório." });
    }

    if (!newAuthor) {
        return res.status(400).json({ error: "Autor é obrigatório." });
    }

    db.books[bookIndex].title = newTitle;
    db.books[bookIndex].author = newAuthor;

    db.loans.forEach((loan) => {
        if (String(loan.bookId) === bookId) {
            loan.bookTitle = newTitle;
        }
    });

    sortBooks(db.books);
    writeDB(db);
    res.json(db.books[bookIndex]);
});

app.delete("/api/books/:id", (req, res) => {
    const db = readDB();
    const bookIndex = db.books.findIndex((b) => String(b.id) === String(req.params.id));

    if (bookIndex === -1) {
        return res.status(404).json({ error: "Livro não encontrado." });
    }

    if (db.books[bookIndex].status === "Alugado") {
        return res.status(400).json({ error: "Não é possível remover um livro alugado!" });
    }

    db.books.splice(bookIndex, 1);
    sortBooks(db.books);
    writeDB(db);

    res.json({ message: "Livro removido!" });
});

/* EMPRÉSTIMOS */

app.get("/api/loans", (req, res) => {
    const db = readDB();
    res.json(db.loans.filter((l) => l.status === "Ativo"));
});

app.get("/api/loans/all", (req, res) => {
    const db = readDB();
    res.json(db.loans);
});

app.post("/api/loans", (req, res) => {
    const db = readDB();

    const studentName = String(req.body.studentName || "").trim();
    const phone = String(req.body.phone || "").trim();
    const school = String(req.body.school || "").trim();
    const grade = String(req.body.grade || "").trim();
    const bookId = String(req.body.bookId || "").trim();
    const rentalDateValue = String(req.body.rentalDate || "").trim();

    if (!studentName) {
        return res.status(400).json({ error: "Nome do aluno é obrigatório." });
    }

    if (!phone) {
        return res.status(400).json({ error: "Telefone é obrigatório." });
    }

    if (!school) {
        return res.status(400).json({ error: "Escola é obrigatória." });
    }

    if (!grade) {
        return res.status(400).json({ error: "Série é obrigatória." });
    }

    if (!bookId) {
        return res.status(400).json({ error: "Livro é obrigatório." });
    }

    if (!rentalDateValue) {
        return res.status(400).json({ error: "Data do empréstimo é obrigatória." });
    }

    const rentalDate = new Date(rentalDateValue);

    if (isNaN(rentalDate.getTime())) {
        return res.status(400).json({ error: "Data do empréstimo inválida." });
    }

    const book = db.books.find((b) => String(b.id).trim() === bookId);

    if (!book) {
        return res.status(404).json({ error: "Livro não encontrado." });
    }

    if (book.status !== "Disponível") {
        return res.status(400).json({ error: "Livro indisponível." });
    }

    const returnDate = new Date(rentalDate);
    returnDate.setDate(returnDate.getDate() + 7);

    const newLoan = {
        id: Date.now().toString(),
        studentName,
        phone,
        school,
        grade,
        bookId: book.id,
        bookTitle: book.title,
        rentalDate: rentalDateValue,
        returnDate: formatDateBR(returnDate),
        status: "Ativo",
        deliveredAt: null,
        renewCount: 0,
        renewalHistory: []
    };

    book.status = "Alugado";
    db.loans.push(newLoan);
    writeDB(db);

    res.json(newLoan);
});

app.put("/api/loans/:id", (req, res) => {
    const db = readDB();
    const idx = db.loans.findIndex((l) => String(l.id) === String(req.params.id));

    if (idx === -1) {
        return res.status(404).json({ error: "Empréstimo não encontrado." });
    }

    if (req.body.studentName !== undefined) db.loans[idx].studentName = req.body.studentName;
    if (req.body.phone !== undefined) db.loans[idx].phone = req.body.phone;
    if (req.body.school !== undefined) db.loans[idx].school = req.body.school;
    if (req.body.grade !== undefined) db.loans[idx].grade = req.body.grade;

    writeDB(db);
    res.json(db.loans[idx]);
});

app.patch("/api/loans/:id/renew", (req, res) => {
    const db = readDB();
    const loanIndex = db.loans.findIndex((l) => String(l.id) === String(req.params.id));

    if (loanIndex === -1) {
        return res.status(404).json({ error: "Empréstimo não encontrado." });
    }

    const loan = db.loans[loanIndex];

    if (loan.status !== "Ativo") {
        return res.status(400).json({ error: "Só é possível renovar empréstimos ativos." });
    }

    const currentReturnDate = parseBRDate(loan.returnDate);
    currentReturnDate.setDate(currentReturnDate.getDate() + 7);

    loan.returnDate = formatDateBR(currentReturnDate);
    loan.renewCount = Number(loan.renewCount || 0) + 1;

    if (!Array.isArray(loan.renewalHistory)) {
        loan.renewalHistory = [];
    }

    loan.renewalHistory.push({
        renewedAt: new Date().toISOString(),
        newReturnDate: loan.returnDate
    });

    writeDB(db);

    res.json({
        message: "Empréstimo renovado por mais 7 dias.",
        loan
    });
});

app.patch("/api/loans/:id/return", (req, res) => {
    const db = readDB();
    const loanIndex = db.loans.findIndex((l) => String(l.id) === String(req.params.id));

    if (loanIndex === -1) {
        return res.status(404).json({ error: "Empréstimo não encontrado." });
    }

    const loan = db.loans[loanIndex];

    if (loan.status === "Concluído") {
        return res.status(400).json({ error: "Este empréstimo já foi finalizado." });
    }

    const book = db.books.find((b) => String(b.id) === String(loan.bookId));

    if (book) {
        book.status = "Disponível";
    }

    loan.status = "Concluído";
    loan.deliveredAt = new Date().toISOString();

    writeDB(db);

    res.json({
        message: "Entrega confirmada com sucesso.",
        loan
    });
});

app.delete("/api/loans/:id", (req, res) => {
    const db = readDB();
    const loanIndex = db.loans.findIndex((l) => String(l.id) === String(req.params.id));

    if (loanIndex === -1) {
        return res.status(404).json({ error: "Empréstimo não encontrado." });
    }

    const loan = db.loans[loanIndex];

    if (loan.status === "Ativo") {
        const book = db.books.find((b) => String(b.id) === String(loan.bookId));
        if (book) {
            book.status = "Disponível";
        }
    }

    db.loans.splice(loanIndex, 1);
    writeDB(db);

    res.json({ message: "Empréstimo removido do banco de dados." });
});

/* DASHBOARD */

app.get("/api/dashboard", (req, res) => {
    const db = readDB();

    const totalBooks = db.books.length;
    const rentedBooks = db.books.filter((b) => b.status === "Alugado").length;

    const today = new Date().setHours(0, 0, 0, 0);

    const lateLoans = db.loans.filter((l) => {
        if (l.status !== "Ativo") return false;

        const dueDate = parseBRDate(l.returnDate).setHours(0, 0, 0, 0);
        return dueDate < today;
    }).length;

    const monthlyData = new Array(12).fill(0);

    db.loans.forEach((loan) => {
        const rental = new Date(loan.rentalDate);

        if (!isNaN(rental.getTime())) {
            monthlyData[rental.getMonth()]++;
        }

        if (Array.isArray(loan.renewalHistory)) {
            loan.renewalHistory.forEach((renewal) => {
                const rd = new Date(renewal.renewedAt);
                if (!isNaN(rd.getTime())) {
                    monthlyData[rd.getMonth()]++;
                }
            });
        }
    });

    res.json({
        totalBooks,
        rentedBooks,
        availableBooks: totalBooks - rentedBooks,
        lateLoans,
        monthlyData
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
