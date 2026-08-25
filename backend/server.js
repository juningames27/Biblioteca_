/* ═══════════════════════════════════════════════════════════
   BIBLIOTECA NTE · API (Express + MongoDB)
   Compatível com o frontend v3.0 e com os dados já existentes.
   ═══════════════════════════════════════════════════════════ */

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());

/* ─── Conexão ─────────────────────────────────────────────── */
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✔ MongoDB conectado"))
    .catch((err) => console.error("�‼ Erro MongoDB:", err.message));

/* ─── Modelos ─────────────────────────────────────────────── */
const bookSchema = new mongoose.Schema({
    id:     { type: String, required: true, unique: true },
    title:  String,
    author: String,
    status: { type: String, default: "Disponível" }
});

const loanSchema = new mongoose.Schema({
    id:          { type: String, required: true, unique: true },
    studentName: String,
    phone:       String,
    school:      String,
    grade:       String,
    turma:       String,
    bookId:      String,
    bookTitle:   String,
    rentalDate:  String,
    returnDate:  String,
    status:      { type: String, default: "Ativo" },
    deliveredAt: { type: String, default: null },
    renewCount:  { type: Number, default: 0 },
    renewalHistory: { type: Array, default: [] }
});

const Book = mongoose.model("Book", bookSchema);
const Loan = mongoose.model("Loan", loanSchema);

/* ─── Utilitários ─────────────────────────────────────────── */
const fmtBR = (date) => {
    const p = (n) => String(n).padStart(2, "0");
    return `${p(date.getDate())}/${p(date.getMonth() + 1)}/${date.getFullYear()}`;
};
const parseBR = (br) => {
    const [d, m, y] = String(br).split("/");
    return new Date(Number(y), Number(m) - 1, Number(d));
};
const normalizeBaseId = (id) => String(id || "").replace(/\s+ed\.\s*ex\.\d+$/i, "").trim();

function sortBooks(books) {
    return books.sort((a, b) => {
        const t = String(a.title || "").localeCompare(String(b.title || ""), "pt-BR", { sensitivity: "base" });
        if (t !== 0) return t;
        const na = String(a.id).match(/ed\.\s*ex\.(\d+)$/i);
        const nb = String(b.id).match(/ed\.\s*ex\.(\d+)$/i);
        return (na ? Number(na[1]) : 0) - (nb ? Number(nb[1]) : 0);
    });
}

async function nextExemplar(baseId) {
    const norm = normalizeBaseId(baseId);
    const books = await Book.find({});
    let max = 0;
    for (const b of books) {
        const m = String(b.id).match(/^(.*)\s+ed\.\s*ex\.(\d+)$/i);
        if (m && normalizeBaseId(m[1]) === norm && Number(m[2]) > max) max = Number(m[2]);
    }
    return max + 1;
}

const ok = (res, data) => res.json(data);
const fail = (res, code, msg) => res.status(code).json({ error: msg });
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => fail(res, 500, e.message));

/* ─── Saúde ───────────────────────────────────────────────── */
app.get("/", (req, res) => res.send("Servidor Biblioteca NTE online!"));
app.get("/api/health", (req, res) => res.json({ status: "ok", db: mongoose.connection.readyState === 1 ? "up" : "down" }));

/* ─── LIVROS ──────────────────────────────────────────────── */
app.get("/api/books", wrap(async (req, res) => {
    const books = await Book.find({}).lean();
    ok(res, sortBooks(books));
}));

app.post("/api/books", wrap(async (req, res) => {
    const baseId = normalizeBaseId(req.body.id).toUpperCase();
    const title = String(req.body.title || "").trim().toUpperCase();
    const author = String(req.body.author || "").trim().toUpperCase();
    const quantity = Number(req.body.quantity || 1);

    if (!baseId) return fail(res, 400, "Código é obrigatório.");
    if (!title) return fail(res, 400, "Título é obrigatório.");
    if (!author) return fail(res, 400, "Autor/Editora é obrigatório.");
    if (!Number.isInteger(quantity) || quantity < 1) return fail(res, 400, "Quantidade inválida.");

    let n = await nextExemplar(baseId);
    const created = [];
    for (let i = 0; i < quantity; i++) {
        created.push(await Book.create({ id: `${baseId} ed. ex.${n}`, title, author, status: "Disponível" }));
        n++;
    }
    ok(res, { message: `${created.length} exemplar(es) cadastrado(s).`, books: created });
}));

app.put("/api/books/:id", wrap(async (req, res) => {
    const book = await Book.findOne({ id: req.params.id });
    if (!book) return fail(res, 404, "Livro não encontrado.");
    const title = String(req.body.title || "").trim().toUpperCase();
    const author = String(req.body.author || "").trim().toUpperCase();
    if (!title) return fail(res, 400, "Título é obrigatório.");
    if (!author) return fail(res, 400, "Autor/Editora é obrigatório.");
    book.title = title; book.author = author;
    await book.save();
    await Loan.updateMany({ bookId: req.params.id }, { bookTitle: title });
    ok(res, book);
}));

app.delete("/api/books/:id", wrap(async (req, res) => {
    const book = await Book.findOne({ id: req.params.id });
    if (!book) return fail(res, 404, "Livro não encontrado.");
    if (book.status === "Alugado") return fail(res, 400, "Não é possível remover um livro emprestado.");
    await Book.deleteOne({ id: req.params.id });
    ok(res, { message: "Livro removido." });
}));

/* ─── EMPRÉSTIMOS ─────────────────────────────────────────── */
app.get("/api/loans", wrap(async (req, res) => ok(res, await Loan.find({ status: "Ativo" }).lean())));
app.get("/api/loans/all", wrap(async (req, res) => ok(res, await Loan.find({}).lean())));

app.post("/api/loans", wrap(async (req, res) => {
    const { studentName, phone, school, grade, turma, bookId, rentalDate } = req.body;
    if (!studentName) return fail(res, 400, "Nome do aluno é obrigatório.");
    if (!school) return fail(res, 400, "Escola é obrigatória.");
    if (!grade) return fail(res, 400, "Série é obrigatória.");
    if (!bookId) return fail(res, 400, "Livro é obrigatório.");
    if (!rentalDate) return fail(res, 400, "Data do empréstimo é obrigatória.");

    const rental = new Date(rentalDate);
    if (isNaN(rental.getTime())) return fail(res, 400, "Data inválida.");

    const book = await Book.findOne({ id: String(bookId).trim() });
    if (!book) return fail(res, 404, "Livro não encontrado.");
    if (book.status !== "Disponível") return fail(res, 400, "Livro indisponível.");

    const due = new Date(rental);
    due.setMonth(due.getMonth() + 1);

    const loan = await Loan.create({
        id: Date.now().toString(),
        studentName, phone, school, grade, turma,
        bookId: book.id, bookTitle: book.title,
        rentalDate, returnDate: fmtBR(due),
        status: "Ativo", deliveredAt: null, renewCount: 0, renewalHistory: []
    });
    book.status = "Alugado";
    await book.save();
    ok(res, loan);
}));

app.put("/api/loans/:id", wrap(async (req, res) => {
    const loan = await Loan.findOne({ id: req.params.id });
    if (!loan) return fail(res, 404, "Empréstimo não encontrado.");
    ["studentName", "phone", "school", "grade", "turma"].forEach((f) => {
        if (req.body[f] !== undefined) loan[f] = req.body[f];
    });
    await loan.save();
    ok(res, loan);
}));

app.patch("/api/loans/:id/renew", wrap(async (req, res) => {
    const loan = await Loan.findOne({ id: req.params.id });
    if (!loan) return fail(res, 404, "Empréstimo não encontrado.");
    if (loan.status !== "Ativo") return fail(res, 400, "Só é possível renovar empréstimos ativos.");
    const due = parseBR(loan.returnDate);
    due.setMonth(due.getMonth() + 1);
    loan.returnDate = fmtBR(due);
    loan.renewCount = Number(loan.renewCount || 0) + 1;
    loan.renewalHistory = [...(loan.renewalHistory || []), { renewedAt: new Date().toISOString(), newReturnDate: loan.returnDate }];
    await loan.save();
    ok(res, { message: "Empréstimo renovado por mais 1 mês.", loan });
}));

app.patch("/api/loans/:id/return", wrap(async (req, res) => {
    const loan = await Loan.findOne({ id: req.params.id });
    if (!loan) return fail(res, 404, "Empréstimo não encontrado.");
    if (loan.status === "Concluído") return fail(res, 400, "Este empréstimo já foi finalizado.");
    const book = await Book.findOne({ id: loan.bookId });
    if (book) { book.status = "Disponível"; await book.save(); }
    loan.status = "Concluído";
    loan.deliveredAt = new Date().toISOString();
    await loan.save();
    ok(res, { message: "Entrega confirmada com sucesso.", loan });
}));

app.delete("/api/loans/:id", wrap(async (req, res) => {
    const loan = await Loan.findOne({ id: req.params.id });
    if (!loan) return fail(res, 404, "Empréstimo não encontrado.");
    const book = await Book.findOne({ id: loan.bookId });
    if (book) { book.status = "Disponível"; await book.save(); }
    await Loan.deleteOne({ id: req.params.id });
    ok(res, { message: "Empréstimo removido do banco de dados." });
}));

/* ─── Painel (opcional, o frontend também calcula sozinho) ── */
app.get("/api/dashboard", wrap(async (req, res) => {
    const books = await Book.find({}).lean();
    const loans = await Loan.find({}).lean();
    const totalBooks = books.length;
    const rentedBooks = books.filter((b) => b.status === "Alugado").length;
    const today = new Date().setHours(0, 0, 0, 0);
    const lateLoans = loans.filter((l) => l.status === "Ativo" && parseBR(l.returnDate).setHours(0, 0, 0, 0) < today).length;
    const monthlyData = new Array(12).fill(0);
    loans.forEach((l) => {
        const r = new Date(l.rentalDate);
        if (!isNaN(r.getTime())) monthlyData[r.getMonth()]++;
    });
    ok(res, { totalBooks, rentedBooks, availableBooks: totalBooks - rentedBooks, lateLoans, monthlyData });
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
