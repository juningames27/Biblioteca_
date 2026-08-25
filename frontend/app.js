/* ═══════════════════════════════════════════════════════════
   BIBLIOTECA NTE · app.js (v3.0)
   Compatível com o backend atual: usa /books e /loans/all e
   calcula o painel no cliente. Sem quebrar dados existentes.
   ═══════════════════════════════════════════════════════════ */

const API_URL = "https://biblioteca-vsbz.onrender.com/api";
const PAGE_SIZE = 25;

let allBooks = [];      // todos os exemplares
let allLoans = [];      // todos os empréstimos (ativos + concluídos)
let booksPage = 1;
let historyPage = 1;
let statusChart, monthlyChart;
let ctxBookId = null;   // exemplar em edição
let ctxLoanId = null;   // empréstimo em foco

let currentRoute = localStorage.getItem("nte.route") || "dashboard";

/* ─── HELPERS ─────────────────────────────────────────────── */
const $  = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");

function parseBR(d) {
    const [dd, mm, yy] = String(d).split("/");
    return new Date(Number(yy), Number(mm) - 1, Number(dd));
}
function fmtBR(date) {
    const p = (n) => String(n).padStart(2, "0");
    return `${p(date.getDate())}/${p(date.getMonth() + 1)}/${date.getFullYear()}`;
}
function daysDiff(target) {
    const t = new Date().setHours(0, 0, 0, 0);
    const d = new Date(target).setHours(0, 0, 0, 0);
    return Math.round((d - t) / 86400000);
}
function onlyDigits(s) { return String(s || "").replace(/\D/g, ""); }

async function request(url, options = {}) {
    const res = await fetch(url, options);
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) throw new Error(data?.error || "Não foi possível concluir a operação.");
    return data;
}

function setConn(state) {
    const el = $("conn"), label = $("conn-label");
    if (!el) return;
    el.classList.remove("online", "offline");
    if (state === "online") { el.classList.add("online"); label.textContent = "Conectado"; }
    else if (state === "offline") { el.classList.add("offline"); label.textContent = "Modo demonstração"; }
    else { label.textContent = "Conectando…"; }
}

/* ─── TOASTS ──────────────────────────────────────────────── */
function toast(msg, type = "info", title = null) {
    const wrap = $("toasts");
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    const icons = {
        ok: '<path d="M20 6 9 17l-5-5"/>',
        err: '<path d="M18 6 6 18M6 6l12 12"/>',
        info: '<path d="M12 8v5M12 16h.01"/><circle cx="12" cy="12" r="9"/>'
    };
    el.innerHTML = `
        <svg class="toast-ico" viewBox="0 0 24 24">${icons[type] || icons.info}</svg>
        <div class="toast-body">${title ? `<b>${esc(title)}</b>` : ""}<small>${esc(msg)}</small></div>`;
    wrap.appendChild(el);
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 300); }, 3600);
}

/* ─── CONFIRM estilizado ──────────────────────────────────── */
let confirmResolver = null;
function askConfirm({ title = "Confirmar", text = "", okLabel = "Confirmar", danger = true }) {
    return new Promise((resolve) => {
        confirmResolver = resolve;
        $("confirm-title").textContent = title;
        $("confirm-text").textContent = text;
        const ok = $("confirm-ok");
        ok.textContent = okLabel;
        ok.className = danger ? "btn btn-danger" : "btn btn-success";
        $("confirm-icon").innerHTML = danger
            ? '<svg viewBox="0 0 24 24"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>'
            : '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>';
        $("confirm-icon").style.background = danger ? "rgba(239,83,80,.13)" : "rgba(47,191,113,.13)";
        $("confirm-icon").style.color = danger ? "var(--red)" : "var(--green)";
        openModal("modal-confirm");
    });
}
function resolveConfirm(val) {
    closeModal("modal-confirm");
    if (confirmResolver) { confirmResolver(val); confirmResolver = null; }
}

/* ─── MODAIS ──────────────────────────────────────────────── */
function openModal(id) { $(id).classList.add("show"); document.body.style.overflow = "hidden"; }
function closeModal(id) {
    $(id).classList.remove("show");
    if (!document.querySelector(".modal.show")) document.body.style.overflow = "";
}
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") document.querySelectorAll(".modal.show").forEach((m) => closeModal(m.id));
});

/* ─── NAVEGAÇÃO ───────────────────────────────────────────── */
function go(route, btn = null) {
    currentRoute = route;
    localStorage.setItem("nte.route", route);
    document.querySelectorAll(".route").forEach((r) => r.classList.remove("is-active"));
    $(`route-${route}`)?.classList.add("is-active");
    document.querySelectorAll(".nav-item, .tab").forEach((b) => b.classList.remove("is-active"));
    document.querySelectorAll(`[data-route="${route}"]`).forEach((b) => b.classList.add("is-active"));
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (route === "dashboard") renderDashboard();
    if (route === "books") { booksPage = 1; renderBooks(); }
    if (route === "loans") renderLoans();
    if (route === "history") { historyPage = 1; renderHistory(); }
}

/* ─── CACHE LOCAL (pinta na hora, atualiza depois) ────────── */
const CACHE_KEY = "nte.cache.v1";
function saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ books: allBooks, loans: allLoans, at: Date.now() })); } catch {}
}
function loadCache() {
    try {
        const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
        if (!c || !Array.isArray(c.books) || !c.books.length) return false;
        allBooks = c.books;
        allLoans = Array.isArray(c.loans) ? c.loans : [];
        return true;
    } catch { return false; }
}

/* ─── CARGA DE DADOS ──────────────────────────────────────── */
async function loadState({ silent = false } = {}) {
    try {
        const [books, loans] = await Promise.all([
            request(`${API_URL}/books`),
            request(`${API_URL}/loans/all`)
        ]);
        allBooks = Array.isArray(books) ? books : [];
        allLoans = Array.isArray(loans) ? loans : [];
        setConn("online");
        saveCache();
    } catch (err) {
        if (!allBooks.length) { allBooks = DEMO_BOOKS; allLoans = DEMO_LOANS; }
        setConn("offline");
        if (!silent) toast("Sem conexão com o servidor. Exibindo dados de demonstração.", "info", "Modo offline");
    }
    updateCounts();
}

/* Refresh leve: só empréstimos (0,6s) + ajuste local do exemplar afetado.
   Usado após ações — evita rebaixar os 232 KB do acervo. */
async function refreshLoans() {
    try {
        const loans = await request(`${API_URL}/loans/all`);
        if (Array.isArray(loans)) allLoans = loans;
        setConn("online");
        saveCache();
    } catch { /* mantém o estado atual em silêncio */ }
    updateCounts();
}
function setBookStatus(bookId, status) {
    const b = allBooks.find((x) => String(x.id) === String(bookId));
    if (b) b.status = status;
}
function renderCurrent() {
    if (currentRoute === "dashboard") renderDashboard();
    else if (currentRoute === "books") renderBooks();
    else if (currentRoute === "loans") renderLoans();
    else if (currentRoute === "history") renderHistory();
}

function updateCounts() {
    $("nav-count-books").textContent = allBooks.length;
    $("nav-count-loans").textContent = activeLoans().length;
}

const activeLoans = () => allLoans.filter((l) => l.status === "Ativo");
const doneLoans = () => allLoans.filter((l) => l.status === "Concluído");

/* ─── PAINEL ──────────────────────────────────────────────── */
function renderDashboard() {
    const total = allBooks.length;
    const out = allBooks.filter((b) => b.status !== "Disponível").length;
    const avail = total - out;
    const late = activeLoans().filter((l) => daysDiff(parseBR(l.returnDate)) < 0).length;
    const pct = total ? Math.round((avail / total) * 100) : 0;

    $("s-total").textContent = total;
    $("s-total-foot").textContent = `${new Set(allBooks.map((b) => b.title)).size} títulos distintos`;
    $("s-avail").textContent = avail;
    $("s-avail-meter").style.width = pct + "%";
    $("s-avail-pct").textContent = pct + "%";
    $("s-out").textContent = out;
    $("s-out-foot").textContent = out === 1 ? "livro com um aluno" : "livros com alunos agora";
    $("s-late").textContent = late;
    $("s-late-foot").textContent = late === 1 ? "devolução vencida" : "devoluções vencidas";
    $("route-dashboard").querySelector(".stat-alert").classList.toggle("has-late", late > 0);

    renderCharts(avail, out);
}

function renderCharts(avail, out) {
    if (typeof Chart === "undefined") return; // CDN ainda carregando — evita quebrar o painel
    const dark = document.body.classList.contains("dark");
    const ink = dark ? "#a99fc4" : "#5f4d80";
    const grid = dark ? "rgba(157,107,240,.12)" : "rgba(64,0,138,.08)";
    const mobile = window.innerWidth <= 860;
    const year = new Date().getFullYear();
    $("chart-year").textContent = year;

    if (statusChart) statusChart.destroy();
    statusChart = new Chart($("chartStatus"), {
        type: "doughnut",
        data: {
            labels: ["Disponíveis", "Em circulação"],
            datasets: [{
                data: [avail, out],
                backgroundColor: ["#7c3aed", "#f7b500"],
                borderColor: dark ? "#141021" : "#fff",
                borderWidth: 3, hoverOffset: 6
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: "62%",
            plugins: { legend: { position: "bottom", labels: {
                color: ink, padding: 16, usePointStyle: true, pointStyle: "circle",
                font: { family: "Inter", size: mobile ? 11 : 12.5, weight: 600 }
            } } }
        }
    });

    const monthly = new Array(12).fill(0);
    allLoans.forEach((l) => {
        const r = new Date(l.rentalDate);
        if (!isNaN(r) && r.getFullYear() === year) monthly[r.getMonth()]++;
    });

    if (monthlyChart) monthlyChart.destroy();
    monthlyChart = new Chart($("chartMonthly"), {
        type: "bar",
        data: {
            labels: ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"],
            datasets: [{
                data: monthly, backgroundColor: "#7c3aed",
                borderRadius: 6, maxBarThickness: mobile ? 16 : 26
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, ticks: { color: ink, stepSize: 1, font: { family: "IBM Plex Mono", size: mobile ? 10 : 11 } }, grid: { color: grid } },
                x: { ticks: { color: ink, font: { family: "Inter", size: mobile ? 10 : 11, weight: 600 } }, grid: { display: false } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

/* ─── ACERVO ──────────────────────────────────────────────── */
function filteredBooks() {
    const term = ($("book-search")?.value || "").toLowerCase().trim();
    if (!term) return allBooks;
    return allBooks.filter((b) =>
        String(b.title).toLowerCase().includes(term) ||
        String(b.author).toLowerCase().includes(term) ||
        String(b.id).toLowerCase().includes(term));
}

function renderBooks() {
    const grouped = $("group-toggle")?.checked;
    const tbody = $("tb-books");
    const data = filteredBooks();

    if (grouped) return renderBooksGrouped(data);

    const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
    if (booksPage > totalPages) booksPage = 1;
    const slice = data.slice((booksPage - 1) * PAGE_SIZE, booksPage * PAGE_SIZE);

    if (!slice.length) {
        tbody.innerHTML = emptyRow(5, "Nenhum livro encontrado.");
        $("pager-books").innerHTML = "";
        return;
    }
    tbody.innerHTML = slice.map((b) => {
        const ok = b.status === "Disponível";
        return `<tr>
            <td data-label="Código" class="mono">${esc(b.id)}</td>
            <td data-label="Título" class="cell-title">${esc(b.title)}</td>
            <td data-label="Autor">${esc(b.author)}</td>
            <td data-label="Status"><span class="pill ${ok ? "pill-ok" : "pill-out"}">${ok ? "Disponível" : "Emprestado"}</span></td>
            <td data-label="Ações" class="ta-r">
                <div class="row-actions">
                    <button class="icon-btn" title="Editar" onclick="openBookEdit('${esc(b.id)}')"><svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
                    <button class="icon-btn danger" title="Remover" onclick="removeBook('${esc(b.id)}')"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/></svg></button>
                </div>
            </td>
        </tr>`;
    }).join("");
    renderPager("pager-books", data.length, totalPages, booksPage, "books");
}

function renderBooksGrouped(data) {
    const tbody = $("tb-books");
    const map = new Map();
    data.forEach((b) => {
        const key = b.title + "||" + b.author;
        if (!map.has(key)) map.set(key, { title: b.title, author: b.author, total: 0, avail: 0 });
        const g = map.get(key);
        g.total++; if (b.status === "Disponível") g.avail++;
    });
    const groups = [...map.values()].sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));

    if (!groups.length) { tbody.innerHTML = emptyRow(5, "Nenhum livro encontrado."); $("pager-books").innerHTML = ""; return; }

    tbody.innerHTML = groups.map((g) => {
        const pillCls = g.avail === 0 ? "pill-late" : g.avail < g.total ? "pill-out" : "pill-ok";
        return `<tr>
            <td data-label="Título" class="cell-title">${esc(g.title)}</td>
            <td data-label="Autor">${esc(g.author)}</td>
            <td data-label="Exemplares" class="mono">${g.total}</td>
            <td data-label="Disponíveis"><span class="pill ${pillCls}">${g.avail} de ${g.total} livres</span></td>
            <td class="ta-r"></td>
        </tr>`;
    }).join("");
    $("tb-books").closest("table").querySelector("thead").innerHTML =
        `<tr><th>Título</th><th>Autor / Editora</th><th>Exemplares</th><th>Disponibilidade</th><th></th></tr>`;
    $("pager-books").innerHTML = `<span class="pager-info"><b>${groups.length}</b> títulos distintos · <b>${data.length}</b> exemplares</span>`;
}

function restoreBooksHead() {
    $("tb-books").closest("table").querySelector("thead").innerHTML =
        `<tr><th>Código</th><th>Título</th><th>Autor / Editora</th><th>Status</th><th class="ta-r">Ações</th></tr>`;
}

/* Cadastro */
$("form-book").onsubmit = async (e) => {
    e.preventDefault();
    const body = {
        id: $("book-id").value.trim().toUpperCase(),
        title: $("book-title").value.trim().toUpperCase(),
        author: $("book-author").value.trim().toUpperCase(),
        quantity: Number($("book-qty").value)
    };
    try {
        const r = await request(`${API_URL}/books`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
        });
        e.target.reset(); $("book-qty").value = 1;
        await loadState({ silent: true });
        booksPage = 1; renderBooks();
        toast(r.message || "Livro cadastrado.", "ok", "Pronto");
    } catch (err) { toast(err.message, "err", "Erro no cadastro"); }
};

function openBookEdit(id) {
    const b = allBooks.find((x) => String(x.id) === String(id));
    if (!b) return;
    ctxBookId = id;
    $("edit-book-title").value = b.title;
    $("edit-book-author").value = b.author;
    openModal("modal-book");
}
async function saveBook() {
    const title = $("edit-book-title").value.trim().toUpperCase();
    const author = $("edit-book-author").value.trim().toUpperCase();
    try {
        await request(`${API_URL}/books/${encodeURIComponent(ctxBookId)}`, {
            method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, author })
        });
        const b = allBooks.find((x) => String(x.id) === String(ctxBookId));
        if (b) { b.title = title; b.author = author; }
        allLoans.forEach((l) => { if (l.bookId === ctxBookId) l.bookTitle = title; });
        closeModal("modal-book"); renderBooks();
        toast("Livro atualizado.", "ok", "Salvo");
    } catch (err) { toast(err.message, "err", "Erro"); }
}
async function removeBook(id) {
    const ok = await askConfirm({ title: "Remover livro", text: `Remover o exemplar ${id} do acervo? Essa ação não pode ser desfeita.`, okLabel: "Remover" });
    if (!ok) return;
    try {
        await request(`${API_URL}/books/${encodeURIComponent(id)}`, { method: "DELETE" });
        allBooks = allBooks.filter((b) => String(b.id) !== String(id));
        updateCounts(); renderBooks();
        toast("Livro removido do acervo.", "ok", "Removido");
    } catch (err) { toast(err.message, "err", "Não foi possível remover"); }
}

/* ─── PICKER de livro no empréstimo ───────────────────────── */
function availableBooks() { return allBooks.filter((b) => b.status === "Disponível"); }

function renderPicker(list) {
    const box = $("loan-book-results");
    if (!list.length) { box.innerHTML = `<div class="picker-empty">Nenhum livro disponível encontrado.</div>`; box.classList.add("show"); return; }
    box.innerHTML = list.map((b) => `
        <div class="picker-item" onclick="pickBook('${esc(b.id)}')">
            <div class="pi-title">${esc(b.title)}</div>
            <div class="pi-meta"><span>${esc(b.author)}</span><span class="mono">${esc(b.id)}</span></div>
        </div>`).join("");
    box.classList.add("show");
}
function setupPicker() {
    const input = $("loan-book-search");
    input.oninput = () => {
        $("loan-book-id").value = "";
        const term = input.value.toLowerCase().trim();
        const avail = availableBooks();
        const list = term
            ? avail.filter((b) => String(b.title).toLowerCase().includes(term) || String(b.author).toLowerCase().includes(term) || String(b.id).toLowerCase().includes(term)).slice(0, 25)
            : avail.slice(0, 8);
        renderPicker(list);
    };
    input.onfocus = () => renderPicker(availableBooks().slice(0, 8));
}
function pickBook(id) {
    const b = allBooks.find((x) => String(x.id) === String(id));
    if (!b) return;
    $("loan-book-search").value = b.title;
    $("loan-book-id").value = b.id;
    $("loan-book-results").classList.remove("show");
}
document.addEventListener("click", (e) => {
    const box = $("loan-book-results");
    if (box && !e.target.closest(".book-picker")) box.classList.remove("show");
});

/* ─── EMPRÉSTIMOS ─────────────────────────────────────────── */
function filteredLoans() {
    const term = ($("loan-search")?.value || "").toLowerCase().trim();
    let list = activeLoans();
    if (term) list = list.filter((l) =>
        String(l.studentName).toLowerCase().includes(term) ||
        String(l.bookTitle).toLowerCase().includes(term) ||
        String(l.school).toLowerCase().includes(term));
    return list.sort((a, b) => daysDiff(parseBR(a.returnDate)) - daysDiff(parseBR(b.returnDate)));
}

function renderLoans() {
    const tbody = $("tb-loans");
    const list = filteredLoans();
    if (!list.length) { tbody.innerHTML = emptyRow(6, "Nenhum empréstimo ativo."); return; }

    tbody.innerHTML = list.map((l) => {
        const d = daysDiff(parseBR(l.returnDate));
        const late = d < 0;
        const badge = late ? `<span class="pill pill-late">Atrasado</span>` : `<span class="pill pill-ok">Em dia</span>`;
        return `<tr>
            <td data-label="Aluno" class="cell-full"><div class="cell-title">${esc(l.studentName)}</div><div class="cell-sub">${esc(l.grade || "—")} · ${esc(l.phone || "sem telefone")}</div></td>
            <td data-label="Escola">${esc(l.school || "—")}</td>
            <td data-label="Turma">${esc(l.turma || "—")}</td>
            <td data-label="Livro">${esc(l.bookTitle)}</td>
            <td data-label="Devolução" class="cell-full"><span class="mono">${esc(l.returnDate)}</span> ${badge}</td>
            <td data-label="Ações" class="ta-r">
                <div class="row-actions">
                    ${l.phone ? `<button class="icon-btn wa" title="Lembrar no WhatsApp" onclick="whatsapp('${esc(l.id)}')"><svg viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.5L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5z"/></svg></button>` : ""}
                    <button class="icon-btn" title="Editar aluno" onclick="openLoanEdit('${esc(l.id)}')"><svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
                    <button class="btn-detail" onclick="openLoanDetail('${esc(l.id)}')"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>Ficha</button>
                </div>
            </td>
        </tr>`;
    }).join("");
}

$("form-loan").onsubmit = async (e) => {
    e.preventDefault();
    const bookId = $("loan-book-id").value.trim();
    if (!bookId) { toast("Selecione um livro na lista de busca.", "err", "Livro não escolhido"); return; }
    const body = {
        studentName: $("loan-student").value.trim(),
        phone: $("loan-phone").value.trim(),
        school: $("loan-school").value,
        grade: $("loan-grade").value,
        turma: $("loan-turma").value,
        bookId,
        rentalDate: $("loan-date").value
    };
    try {
        await request(`${API_URL}/loans`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
        });
        e.target.reset();
        $("loan-book-id").value = "";
        $("loan-date").valueAsDate = new Date();
        $("loan-book-results").classList.remove("show");
        setBookStatus(bookId, "Alugado");
        toast("Saída registrada. Devolução agendada para +1 mês.", "ok", "Empréstimo criado");
        await refreshLoans();
        renderLoans();
    } catch (err) { toast(err.message, "err", "Erro no empréstimo"); }
};

function openLoanEdit(id) {
    const l = allLoans.find((x) => String(x.id) === String(id));
    if (!l) return;
    ctxLoanId = id;
    $("edit-loan-student").value = l.studentName || "";
    $("edit-loan-phone").value = l.phone || "";
    $("edit-loan-school").value = l.school || "";
    $("edit-loan-grade").value = l.grade || "";
    $("edit-loan-turma").value = l.turma || "";
    openModal("modal-loan-edit");
}
async function saveLoan() {
    const body = {
        studentName: $("edit-loan-student").value.trim(),
        phone: $("edit-loan-phone").value.trim(),
        school: $("edit-loan-school").value,
        grade: $("edit-loan-grade").value,
        turma: $("edit-loan-turma").value
    };
    try {
        await request(`${API_URL}/loans/${encodeURIComponent(ctxLoanId)}`, {
            method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
        });
        const l = allLoans.find((x) => String(x.id) === String(ctxLoanId));
        if (l) Object.assign(l, body);
        closeModal("modal-loan-edit"); renderLoans();
        toast("Dados do aluno atualizados.", "ok", "Salvo");
    } catch (err) { toast(err.message, "err", "Erro"); }
}

/* Ficha / modal detalhe */
function openLoanDetail(id) {
    const l = allLoans.find((x) => String(x.id) === String(id));
    if (!l) return;
    ctxLoanId = id;
    const d = daysDiff(parseBR(l.returnDate));
    const badge = d < 0 ? `<span class="pill pill-late">${Math.abs(d)}d atrasado</span>` : `<span class="pill pill-ok">em dia</span>`;
    $("loan-details").innerHTML = `
        <div class="detail-row"><b>Aluno</b><span>${esc(l.studentName)}</span></div>
        <div class="detail-row"><b>Telefone</b><span>${esc(l.phone || "—")}</span></div>
        <div class="detail-row"><b>Escola</b><span>${esc(l.school || "—")}</span></div>
        <div class="detail-row"><b>Série · Turma</b><span>${esc(l.grade || "—")} · ${esc(l.turma || "—")}</span></div>
        <div class="detail-row"><b>Livro</b><span>${esc(l.bookTitle)}</span></div>
        <div class="detail-row"><b>Saída</b><span>${esc(new Date(l.rentalDate).toLocaleDateString("pt-BR"))}</span></div>
        <div class="detail-row"><b>Devolução</b><span>${esc(l.returnDate)} ${badge}</span></div>
        <div class="detail-row"><b>Renovações</b><span>${esc(l.renewCount || 0)}</span></div>`;
    $("btn-return").style.display = l.phone ? "" : "";
    openModal("modal-loan");
}

$("btn-return").onclick = async () => {
    const ok = await askConfirm({ title: "Confirmar devolução", text: "Marcar este livro como devolvido? Ele voltará a ficar disponível no acervo.", okLabel: "Confirmar devolução", danger: false });
    if (!ok) return;
    try {
        const lr = allLoans.find((x) => String(x.id) === String(ctxLoanId));
        await request(`${API_URL}/loans/${encodeURIComponent(ctxLoanId)}/return`, { method: "PATCH" });
        if (lr) setBookStatus(lr.bookId, "Disponível");
        closeModal("modal-loan");
        toast("Devolução confirmada.", "ok", "Livro na estante");
        await refreshLoans();
        renderLoans();
    } catch (err) { toast(err.message, "err", "Erro"); }
};
$("btn-renew").onclick = async () => {
    try {
        const r = await request(`${API_URL}/loans/${encodeURIComponent(ctxLoanId)}/renew`, { method: "PATCH" });
        closeModal("modal-loan");
        toast(r.message || "Prazo estendido por mais 1 mês.", "ok", "Renovado");
        await refreshLoans();
        renderLoans();
    } catch (err) { toast(err.message, "err", "Erro"); }
};
$("btn-delete-loan").onclick = async () => {
    const ok = await askConfirm({ title: "Remover registro", text: "Apagar este empréstimo do banco de dados? O livro voltará a ficar disponível.", okLabel: "Remover" });
    if (!ok) return;
    try {
        const ld = allLoans.find((x) => String(x.id) === String(ctxLoanId));
        await request(`${API_URL}/loans/${encodeURIComponent(ctxLoanId)}`, { method: "DELETE" });
        if (ld && ld.status === "Ativo") setBookStatus(ld.bookId, "Disponível");
        closeModal("modal-loan");
        toast("Registro removido.", "ok", "Removido");
        await refreshLoans();
        renderLoans();
    } catch (err) { toast(err.message, "err", "Erro"); }
};

/* WhatsApp */
function whatsapp(id) {
    const l = allLoans.find((x) => String(x.id) === String(id));
    if (!l || !l.phone) { toast("Este aluno não tem telefone cadastrado.", "err"); return; }
    const d = daysDiff(parseBR(l.returnDate));
    const situacao = d < 0
        ? `está *${Math.abs(d)} dia(s) atrasado* (venceu em ${l.returnDate})`
        : `vence em ${l.returnDate}`;
    const msg = `Olá! Aqui é da Biblioteca do NTE. 📚\n\nLembrete: o livro *${l.bookTitle}*, emprestado para ${l.studentName}, ${situacao}.\n\nPode devolver na biblioteca ou renovar o prazo. Obrigado!`;
    let num = onlyDigits(l.phone);
    if (num.length <= 11) num = "55" + num;
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, "_blank");
}

/* CSV */
function exportLoansCSV() {
    const list = activeLoans();
    if (!list.length) { toast("Não há empréstimos ativos para exportar.", "info"); return; }
    const head = ["Aluno", "Telefone", "Escola", "Serie", "Turma", "Livro", "Codigo", "Saida", "Devolucao", "Renovacoes"];
    const rows = list.map((l) => [
        l.studentName, l.phone || "", l.school || "", l.grade || "", l.turma || "",
        l.bookTitle, l.bookId, new Date(l.rentalDate).toLocaleDateString("pt-BR"), l.returnDate, l.renewCount || 0
    ].map((c) => `"${String(c).replaceAll('"', '""')}"`).join(","));
    const csv = "\uFEFF" + [head.join(","), ...rows].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `emprestimos-nte-${fmtBR(new Date()).replaceAll("/", "-")}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast(`${list.length} empréstimos exportados.`, "ok", "Planilha gerada");
}

/* ─── HISTÓRICO ───────────────────────────────────────────── */
function filteredHistory() {
    const term = ($("history-search")?.value || "").toLowerCase().trim();
    let list = doneLoans().sort((a, b) => new Date(b.deliveredAt || 0) - new Date(a.deliveredAt || 0));
    if (term) list = list.filter((l) =>
        String(l.studentName).toLowerCase().includes(term) ||
        String(l.bookTitle).toLowerCase().includes(term));
    return list;
}
function renderHistory() {
    const tbody = $("tb-history");
    const data = filteredHistory();
    const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
    if (historyPage > totalPages) historyPage = 1;
    const slice = data.slice((historyPage - 1) * PAGE_SIZE, historyPage * PAGE_SIZE);

    if (!slice.length) { tbody.innerHTML = emptyRow(5, "Nenhuma devolução registrada ainda."); $("pager-history").innerHTML = ""; return; }
    tbody.innerHTML = slice.map((l) => `
        <tr>
            <td data-label="Aluno" class="cell-title">${esc(l.studentName)}</td>
            <td data-label="Escola">${esc(l.school || "—")}</td>
            <td data-label="Livro">${esc(l.bookTitle)}</td>
            <td data-label="Saída" class="mono">${esc(new Date(l.rentalDate).toLocaleDateString("pt-BR"))}</td>
            <td data-label="Devolvido" class="mono">${esc(l.deliveredAt ? new Date(l.deliveredAt).toLocaleDateString("pt-BR") : "—")}</td>
        </tr>`).join("");
    renderPager("pager-history", data.length, totalPages, historyPage, "history");
}

/* ─── PAGER genérico ──────────────────────────────────────── */
function renderPager(elId, total, totalPages, page, kind) {
    const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
    const end = Math.min(page * PAGE_SIZE, total);
    $(elId).innerHTML = `
        <span class="pager-info">Mostrando <b>${start}–${end}</b> de <b>${total}</b></span>
        <div class="pager-ctrl">
            <button class="pg-btn" onclick="pageTo('${kind}',1)" ${page === 1 ? "disabled" : ""}>«</button>
            <button class="pg-btn" onclick="pageTo('${kind}',${page - 1})" ${page === 1 ? "disabled" : ""}>‹</button>
            <span class="pg-label">Pág <b>${page}</b> / <b>${totalPages}</b></span>
            <button class="pg-btn" onclick="pageTo('${kind}',${page + 1})" ${page === totalPages ? "disabled" : ""}>›</button>
            <button class="pg-btn" onclick="pageTo('${kind}',${totalPages})" ${page === totalPages ? "disabled" : ""}>»</button>
        </div>`;
}
function pageTo(kind, p) {
    if (kind === "books") { booksPage = Math.max(1, p); renderBooks(); document.querySelector("#route-books .table-wrap")?.scrollIntoView({ behavior: "smooth", block: "start" }); }
    else { historyPage = Math.max(1, p); renderHistory(); document.querySelector("#route-history .table-wrap")?.scrollIntoView({ behavior: "smooth", block: "start" }); }
}

function emptyRow(cols, msg) {
    return `<tr><td colspan="${cols}"><div class="empty">
        <svg viewBox="0 0 24 24"><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5.5A1.5 1.5 0 0 0 4 21z"/><path d="M4 19.5A1.5 1.5 0 0 1 5.5 18H20"/></svg>
        <p>${esc(msg)}</p></div></td></tr>`;
}

/* ─── BUSCA (listeners) ───────────────────────────────────── */
$("book-search").addEventListener("input", () => { booksPage = 1; if (!$("group-toggle").checked) restoreBooksHead(); renderBooks(); });
$("group-toggle").addEventListener("change", () => { if (!$("group-toggle").checked) restoreBooksHead(); });
$("loan-search").addEventListener("input", renderLoans);
$("history-search").addEventListener("input", () => { historyPage = 1; renderHistory(); });

/* ─── TEMA ────────────────────────────────────────────────── */
function toggleTheme() {
    const dark = document.body.classList.contains("dark");
    document.body.classList.add("theme-switching");
    document.body.classList.toggle("dark", !dark);
    document.body.classList.toggle("light", dark);
    setTimeout(() => document.body.classList.remove("theme-switching"), 60);
    localStorage.setItem("nte.theme", dark ? "light" : "dark");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#40008A" : "#25004f");
    if (currentRoute === "dashboard") renderDashboard();
}

/* ─── RESIZE (redesenha charts) ───────────────────────────── */
let rt;
window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (currentRoute === "dashboard") renderDashboard(); }, 250); });

/* ─── INIT ────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
    const theme = localStorage.getItem("nte.theme") || "dark";
    document.body.className = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#25004f" : "#40008A");
    $("loan-date").valueAsDate = new Date();

    setupPicker();

    // pinta imediatamente com o último estado salvo (se houver)…
    const painted = loadCache();
    if (painted) { updateCounts(); go(currentRoute); }

    // …e busca os dados frescos em seguida
    await loadState();
    if (painted) renderCurrent();   // rota/nav já configuradas: só repinta (sem pular o scroll)
    else go(currentRoute);          // primeira pintura: configura rota + renderiza
});

/* ─── DADOS DE DEMONSTRAÇÃO (fallback offline) ────────────── */
const DEMO_BOOKS = [
    { id: "8951T999A1 ed. ex.1", title: "A ARTE DA GUERRA", author: "SUN TZU", status: "Alugado" },
    { id: "028.5C578B1 ed. ex.1", title: "A BELA E A FERA", author: "CIRANDA CULTURAL", status: "Disponível" },
    { id: "028.5C578B1 ed. ex.2", title: "A BELA E A FERA", author: "CIRANDA CULTURAL", status: "Disponível" },
    { id: "833K11M1 ed. ex.1", title: "A METAMORFOSE", author: "FRANZ KAFKA", status: "Alugado" },
    { id: "833H766O1 ed. ex.1", title: "A ODISSEIA", author: "HOMERO", status: "Disponível" },
    { id: "B8693A848D1 ed. ex.1", title: "DOM CASMURRO", author: "MACHADO DE ASSIS", status: "Disponível" },
    { id: "813P743C1 ed. ex.1", title: "O CORVO", author: "EDGAR ALLAN POE", status: "Disponível" },
    { id: "184P716B1 ed. ex.1", title: "O BANQUETE", author: "PLATÃO", status: "Alugado" }
];
const today = new Date();
const plus = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return d; };
const DEMO_LOANS = [
    { id: "d1", studentName: "Ana Beatriz Souza", phone: "99991112222", school: "E.M Cléber Sampaio", grade: "8° Ano", turma: "A", bookId: "8951T999A1 ed. ex.1", bookTitle: "A ARTE DA GUERRA", rentalDate: new Date(today.getFullYear(), today.getMonth(), 2).toISOString(), returnDate: fmtBR(plus(-4)), status: "Ativo", renewCount: 1 },
    { id: "d2", studentName: "Carlos Eduardo Lima", phone: "", school: "E.M Moacyr Bacelar Nunes", grade: "9° Ano", turma: "B", bookId: "833K11M1 ed. ex.1", bookTitle: "A METAMORFOSE", rentalDate: new Date().toISOString(), returnDate: fmtBR(plus(2)), status: "Ativo", renewCount: 0 },
    { id: "d3", studentName: "Mariana Rocha", phone: "99993334444", school: "E.M José Barreto De Araújo", grade: "8° Ano", turma: "C", bookId: "184P716B1 ed. ex.1", bookTitle: "O BANQUETE", rentalDate: new Date().toISOString(), returnDate: fmtBR(plus(20)), status: "Ativo", renewCount: 0 },
    { id: "d4", studentName: "João Pedro Alves", phone: "99995556666", school: "E.M Cléber Sampaio", grade: "7° Ano", turma: "A", bookId: "813P743C1 ed. ex.1", bookTitle: "O CORVO", rentalDate: new Date(today.getFullYear(), today.getMonth() - 1, 5).toISOString(), returnDate: fmtBR(plus(-15)), status: "Concluído", deliveredAt: plus(-12).toISOString(), renewCount: 0 }
];
