const API_URL = "https://biblioteca-vsbz.onrender.com/api";
let statusChart;
let monthlyChart;
let currentLoanId = null;
let currentBookId = null;
let allBooks = [];
let currentView = localStorage.getItem("currentView") || "view-dashboard";

// ─── PAGINAÇÃO ────────────────────────────────────────────
let currentPage = 1;
const PAGE_SIZE = 30;

async function request(url, options = {}) {
    const res = await fetch(url, options);

    let data = null;
    try {
        data = await res.json();
    } catch {
        data = null;
    }

    if (!res.ok) {
        throw new Error(data?.error || "Erro na requisição.");
    }

    return data;
}

function setCurrentView(viewId) {
    currentView = viewId;
    localStorage.setItem("currentView", viewId);
}

async function navigate(viewId, clickedButton = null, fallbackButtonId = null) {
    setCurrentView(viewId);

    // Troca a view ativa
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    const targetView = document.getElementById(viewId);
    if (targetView) targetView.classList.add("active");

    // Limpa active de todos os botões de navegação (sidebar + mobile bottom nav)
    document.querySelectorAll(".nav-btn, .mobile-nav-btn").forEach((b) => b.classList.remove("active"));

    // Ativa TODOS os botões (de ambas as barras) correspondentes à view
    document.querySelectorAll(`[data-view="${viewId}"]`).forEach((b) => b.classList.add("active"));

    // Fallback — caso algum botão específico tenha sido passado sem data-view
    if (clickedButton && !clickedButton.hasAttribute("data-view")) {
        clickedButton.classList.add("active");
    } else if (!clickedButton && fallbackButtonId) {
        document.getElementById(fallbackButtonId)?.classList.add("active");
    }

    // Rola para o topo ao trocar de tela (útil no celular)
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (viewId === "view-dashboard") {
        await loadDashboard();
    }

    if (viewId === "view-books") {
        await loadBooks();
    }

    if (viewId === "view-loans") {
        await loadBooks();
        await loadLoans();
    }
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
    return escapeHtml(value);
}

function parseBRDate(brDate) {
    const [day, month, year] = String(brDate).split("/");
    return new Date(Number(year), Number(month) - 1, Number(day));
}

// ─── DASHBOARD ────────────────────────────────────────────
async function loadDashboard() {
    try {
        const data = await request(`${API_URL}/dashboard`);

        document.getElementById("dash-total-books").textContent = data.totalBooks ?? 0;
        document.getElementById("dash-rented-books").textContent = data.rentedBooks ?? 0;
        document.getElementById("dash-late-loans").textContent = data.lateLoans ?? 0;

        const isDark = document.body.classList.contains("dark-theme");
        const color = isDark ? "#e4eaf8" : "#111827";
        const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
        const isMobile = window.innerWidth <= 768;

        if (statusChart) statusChart.destroy();
        statusChart = new Chart(document.getElementById("chartStatus"), {
            type: "doughnut",
            data: {
                labels: ["Livres", "Alugados"],
                datasets: [
                    {
                        data: [data.availableBooks ?? 0, data.rentedBooks ?? 0],
                        backgroundColor: ["#6ea8fe", "#f5a623"],
                        borderColor: "transparent",
                        borderWidth: 0,
                        hoverOffset: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "60%",
                layout: {
                    padding: { top: 4, bottom: 4 }
                },
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: {
                            color,
                            padding: isMobile ? 10 : 14,
                            font: { family: "Geist", size: isMobile ? 11 : 12 },
                            boxWidth: 10,
                            boxHeight: 10,
                            usePointStyle: true,
                            pointStyle: "circle"
                        }
                    }
                }
            }
        });

        if (monthlyChart) monthlyChart.destroy();
        monthlyChart = new Chart(document.getElementById("chartMonthly"), {
            type: "bar",
            data: {
                labels: ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"],
                datasets: [
                    {
                        label: "Empréstimos",
                        data: data.monthlyData ?? new Array(12).fill(0),
                        backgroundColor: "#6ea8fe",
                        borderRadius: 6,
                        maxBarThickness: isMobile ? 18 : 28
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: { top: 4, bottom: 0 }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { color, stepSize: 1, font: { family: "Geist", size: isMobile ? 10 : 11 } },
                        grid: { color: gridColor, drawBorder: false }
                    },
                    x: {
                        ticks: { color, font: { family: "Geist", size: isMobile ? 10 : 11 } },
                        grid: { display: false }
                    }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    } catch (error) {
        console.error("Erro ao carregar dashboard:", error);
    }
}

// ─── LIVROS ───────────────────────────────────────────────
async function loadBooks() {
    try {
        allBooks = await request(`${API_URL}/books`);
        currentPage = 1;
        renderBooks(allBooks);
        setupLoanBookSearch();
    } catch (error) {
        console.error("Erro ao carregar livros:", error);
    }
}

function renderBooks(booksList) {
    const tbody = document.getElementById("table-books-body");
    if (!tbody) return;

    const totalPages = Math.max(1, Math.ceil(booksList.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = 1;

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = booksList.slice(start, start + PAGE_SIZE);

    tbody.innerHTML = "";

    pageItems.forEach((b) => {
        tbody.innerHTML += `
            <tr>
                <td data-label="ID">${escapeHtml(b.id)}</td>
                <td data-label="Título">${escapeHtml(b.title)}</td>
                <td data-label="Autor">${escapeHtml(b.author)}</td>
                <td data-label="Status" class="status-${escapeAttr(b.status)}">${escapeHtml(b.status)}</td>
                <td data-label="Ações">
                    <button
                        onclick="openEditBookModal('${escapeAttr(b.id)}', '${escapeAttr(b.title)}', '${escapeAttr(b.author)}')"
                        class="btn-edit-row"
                        type="button"
                        aria-label="Editar livro"
                    >✏️</button>
                    <button
                        onclick="deleteBook('${escapeAttr(b.id)}')"
                        class="btn-delete-row"
                        type="button"
                        aria-label="Remover livro"
                    >🗑️</button>
                </td>
            </tr>
        `;
    });

    renderPagination(booksList.length, totalPages);
}

function renderPagination(total, totalPages) {
    let container = document.getElementById("books-pagination");

    if (!container) {
        container = document.createElement("div");
        container.id = "books-pagination";
        const tableWrapper = document.querySelector("#view-books .table-wrapper");
        if (tableWrapper) tableWrapper.after(container);
    }

    const start = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, total);

    const btnStyle = `class="page-btn"`;

    container.innerHTML = `
        <span class="pagination-info">
            Mostrando <b>${start}–${end}</b> de <b>${total}</b> livros
        </span>
        <div class="pagination-controls">
            <button ${btnStyle} onclick="goToPage(1)" ${currentPage === 1 ? "disabled" : ""} title="Primeira" aria-label="Primeira página">«</button>
            <button ${btnStyle} onclick="goToPage(${currentPage - 1})" ${currentPage === 1 ? "disabled" : ""} title="Anterior" aria-label="Página anterior">‹</button>
            <span class="pagination-label">Pág. <b>${currentPage}</b>/<b>${totalPages}</b></span>
            <button ${btnStyle} onclick="goToPage(${currentPage + 1})" ${currentPage === totalPages ? "disabled" : ""} title="Próxima" aria-label="Próxima página">›</button>
            <button ${btnStyle} onclick="goToPage(${totalPages})" ${currentPage === totalPages ? "disabled" : ""} title="Última" aria-label="Última página">»</button>
        </div>
    `;
}

function goToPage(page) {
    const term = document.getElementById("search-book-input")?.value.toLowerCase().trim() || "";
    const filtered = term
        ? allBooks.filter((b) =>
            String(b.title).toLowerCase().includes(term) ||
            String(b.author).toLowerCase().includes(term) ||
            String(b.id).toLowerCase().includes(term))
        : allBooks;

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    currentPage = Math.max(1, Math.min(page, totalPages));
    renderBooks(filtered);

    // Rola para o topo da tabela ao mudar de página (útil no celular)
    document.querySelector("#view-books .table-wrapper")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ─── BUSCA DE LIVROS ─────────────────────────────────────
document.getElementById("search-book-input").addEventListener("input", (e) => {
    currentPage = 1;
    const term = e.target.value.toLowerCase().trim();

    renderBooks(
        allBooks.filter((b) => {
            return (
                String(b.title).toLowerCase().includes(term) ||
                String(b.author).toLowerCase().includes(term) ||
                String(b.id).toLowerCase().includes(term)
            );
        })
    );
});

function openEditBookModal(id, title, author) {
    currentBookId = id;
    document.getElementById("edit-book-title").value = title;
    document.getElementById("edit-book-author").value = author;
    document.getElementById("modal-edit-book").style.display = "block";
    document.body.style.overflow = "hidden";
}

function closeEditBookModal() {
    document.getElementById("modal-edit-book").style.display = "none";
    document.body.style.overflow = "";
}

async function updateBook() {
    try {
        const title = document.getElementById("edit-book-title").value.trim().toUpperCase();
        const author = document.getElementById("edit-book-author").value.trim().toUpperCase();

        await request(`${API_URL}/books/${encodeURIComponent(currentBookId)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, author })
        });

        closeEditBookModal();

        const book = allBooks.find((b) => String(b.id) === String(currentBookId));
        if (book) {
            book.title = title;
            book.author = author;
        }

        renderBooks(allBooks);
        alert("Livro atualizado com sucesso.");
    } catch (error) {
        alert(error.message);
    }
}

async function deleteBook(id) {
    if (!confirm("Deseja remover este livro do acervo?")) return;

    try {
        await request(`${API_URL}/books/${encodeURIComponent(id)}`, {
            method: "DELETE"
        });
        allBooks = allBooks.filter((b) => String(b.id) !== String(id));
        renderBooks(allBooks);
    } catch (error) {
        alert(error.message);
    }
}

document.getElementById("form-book").onsubmit = async (e) => {
    e.preventDefault();

    try {
        await request(`${API_URL}/books`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id: document.getElementById("book-id").value.trim().toUpperCase(),
                title: document.getElementById("book-title").value.trim().toUpperCase(),
                author: document.getElementById("book-author").value.trim().toUpperCase(),
                quantity: Number(document.getElementById("book-quantity").value)
            })
        });

        e.target.reset();
        document.getElementById("book-quantity").value = 1;

        const books = await request(`${API_URL}/books`);
        allBooks = books;
        currentPage = 1;
        renderBooks(allBooks);
    } catch (error) {
        alert(error.message);
    }
};

// ─── BUSCA DE LIVRO NO FORMULÁRIO DE EMPRÉSTIMO ───────────
function getAvailableBooks() {
    return allBooks.filter((b) => b.status === "Disponível");
}

function renderLoanBookResults(filteredBooks) {
    const results = document.getElementById("loan-book-results");
    if (!results) return;

    if (!filteredBooks.length) {
        results.innerHTML = `<div class="book-search-empty">Nenhum livro disponível encontrado.</div>`;
        results.classList.add("show");
        return;
    }

    results.innerHTML = filteredBooks.map((book) => `
        <div class="book-search-item" onclick="selectLoanBook('${escapeAttr(book.id)}')">
            <div class="book-search-title">${escapeHtml(book.title)}</div>
            <div class="book-search-meta">
                <span>${escapeHtml(book.author)}</span>
                <span>ID: ${escapeHtml(book.id)}</span>
            </div>
        </div>
    `).join("");

    results.classList.add("show");
}

function setupLoanBookSearch() {
    const input = document.getElementById("loan-book-search");
    const hiddenInput = document.getElementById("loan-book-id");
    const results = document.getElementById("loan-book-results");

    if (!input || !hiddenInput || !results) return;

    input.oninput = () => {
        const term = input.value.toLowerCase().trim();
        hiddenInput.value = "";

        const availableBooks = getAvailableBooks();

        if (!term) {
            renderLoanBookResults(availableBooks.slice(0, 8));
            return;
        }

        const filtered = availableBooks.filter((book) => {
            return (
                String(book.title).toLowerCase().includes(term) ||
                String(book.author).toLowerCase().includes(term) ||
                String(book.id).toLowerCase().includes(term)
            );
        });

        renderLoanBookResults(filtered.slice(0, 20));
    };

    input.onfocus = () => {
        renderLoanBookResults(getAvailableBooks().slice(0, 8));
    };
}

function selectLoanBook(bookId) {
    const book = allBooks.find((b) => String(b.id) === String(bookId));
    if (!book) return;

    document.getElementById("loan-book-search").value = book.title;
    document.getElementById("loan-book-id").value = book.id;
    document.getElementById("loan-book-results").classList.remove("show");
}

document.addEventListener("click", (event) => {
    const wrapper = document.querySelector(".book-search-wrapper");
    const results = document.getElementById("loan-book-results");

    if (!wrapper || !results) return;

    if (!wrapper.contains(event.target)) {
        results.classList.remove("show");
    }
});

// ─── EMPRÉSTIMOS ──────────────────────────────────────────
async function loadLoans() {
    try {
        const loans = await request(`${API_URL}/loans`);
        const tbody = document.getElementById("table-loans-body");
        if (!tbody) return;

        tbody.innerHTML = "";

        const today = new Date().setHours(0, 0, 0, 0);

        loans.forEach((l) => {
            const dueDate = parseBRDate(l.returnDate).setHours(0, 0, 0, 0);
            const isLate = dueDate < today;

            tbody.innerHTML += `
                <tr>
                    <td data-label="Aluno">${escapeHtml(l.studentName)}</td>
                    <td data-label="Telefone">${escapeHtml(l.phone || "---")}</td>
                    <td data-label="Escola">${escapeHtml(l.school || "---")}</td>
                    <td data-label="Série">${escapeHtml(l.grade || "---")}</td>
                    <td data-label="Turma">${escapeHtml(l.turma || "---")}</td>
                    <td data-label="Livro">${escapeHtml(l.bookTitle)}</td>
                    <td data-label="Devolução">
                        <span>${escapeHtml(l.returnDate)}
                        ${isLate
                            ? '<span class="badge-late">ATRASADO</span>'
                            : '<span class="badge-ontime">EM DIA</span>'}</span>
                    </td>
                    <td data-label="Ações">
                        <button
                            onclick="openEditLoanModal('${escapeAttr(l.id)}', '${escapeAttr(l.studentName)}', '${escapeAttr(l.school || "")}', '${escapeAttr(l.grade || "")}', '${escapeAttr(l.phone || "")}', '${escapeAttr(l.turma || "")}')"
                            class="btn-edit-row"
                            type="button"
                            aria-label="Editar empréstimo"
                        >✏️</button>
                        <button
                            onclick="openModal('${escapeAttr(l.id)}', '${escapeAttr(l.studentName)}', '${escapeAttr(l.bookTitle)}', '${escapeAttr(l.returnDate)}', '${escapeAttr(l.phone || "---")}', '${escapeAttr(l.school || "---")}', '${escapeAttr(l.grade || "---")}', '${escapeAttr(l.renewCount || 0)}', '${escapeAttr(l.turma || "---")}')"
                            class="btn-ver"
                            type="button"
                        >🔍 Detalhes</button>
                    </td>
                </tr>
            `;
        });
    } catch (error) {
        console.error("Erro ao carregar empréstimos:", error);
    }
}

function openEditLoanModal(id, student, school, grade, phone, turma) {
    currentLoanId = id;
    document.getElementById("edit-loan-student").value = student;
    document.getElementById("edit-loan-school").value = school;
    document.getElementById("edit-loan-grade").value = grade;
    document.getElementById("edit-loan-phone").value = phone || "";
    document.getElementById("edit-loan-turma").value = turma || "";
    document.getElementById("modal-edit-loan").style.display = "block";
    document.body.style.overflow = "hidden";
}

function closeEditLoanModal() {
    document.getElementById("modal-edit-loan").style.display = "none";
    document.body.style.overflow = "";
}

async function updateLoan() {
    try {
        const studentName = document.getElementById("edit-loan-student").value.trim();
        const school = document.getElementById("edit-loan-school").value;
        const grade = document.getElementById("edit-loan-grade").value;
        const phone = document.getElementById("edit-loan-phone").value.trim();
        const turma = document.getElementById("edit-loan-turma").value;

        await request(`${API_URL}/loans/${encodeURIComponent(currentLoanId)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ studentName, school, grade, phone, turma })
        });

        closeEditLoanModal();
        await loadLoans();
        alert("Dados do aluno atualizados com sucesso.");
    } catch (error) {
        alert(error.message);
    }
}

document.getElementById("form-loan").onsubmit = async (e) => {
    e.preventDefault();

    try {
        const bookId = document.getElementById("loan-book-id").value.trim();

        if (!bookId) {
            alert("Selecione um livro da lista de busca.");
            return;
        }

        await request(`${API_URL}/loans`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                studentName: document.getElementById("loan-student").value,
                phone: document.getElementById("loan-phone").value,
                school: document.getElementById("loan-school").value,
                grade: document.getElementById("loan-grade").value,
                turma: document.getElementById("loan-turma").value,
                bookId,
                rentalDate: document.getElementById("loan-date").value
            })
        });

        e.target.reset();
        document.getElementById("loan-book-id").value = "";
        document.getElementById("loan-date").valueAsDate = new Date();
        document.getElementById("loan-book-results").classList.remove("show");

        await loadLoans();
        await loadBooks();
    } catch (error) {
        alert(error.message);
    }
};

// ─── MODAL DETALHES ───────────────────────────────────────
function openModal(id, student, book, date, phone, school, grade, renewCount, turma) {
    currentLoanId = id;

    const today = new Date().setHours(0, 0, 0, 0);
    const dueDate = parseBRDate(date).setHours(0, 0, 0, 0);

    const statusBadge = dueDate < today
        ? '<span class="badge-late">ATRASADO</span>'
        : '<span class="badge-ontime">EM DIA</span>';

    document.getElementById("modal-details").innerHTML = `
        <p><b>Aluno</b> <span>${escapeHtml(student)}</span></p>
        <p><b>Telefone</b> <span>${escapeHtml(phone)}</span></p>
        <p><b>Escola</b> <span>${escapeHtml(school)}</span></p>
        <p><b>Série</b> <span>${escapeHtml(grade)}</span></p>
        <p><b>Turma</b> <span>${escapeHtml(turma)}</span></p>
        <p><b>Livro</b> <span>${escapeHtml(book)}</span></p>
        <p><b>Entrega</b> <span>${escapeHtml(date)} ${statusBadge}</span></p>
        <p><b>Renovações</b> <span>${escapeHtml(renewCount)}</span></p>
    `;

    document.getElementById("modal-loan").style.display = "block";
    document.body.style.overflow = "hidden";
}

function closeModal() {
    document.getElementById("modal-loan").style.display = "none";
    document.body.style.overflow = "";
}

document.getElementById("btn-confirm-return").onclick = async () => {
    try {
        const data = await request(`${API_URL}/loans/${encodeURIComponent(currentLoanId)}/return`, {
            method: "PATCH"
        });

        alert(data.message || "Entrega confirmada com sucesso.");
        closeModal();

        await loadLoans();
        await loadBooks();
    } catch (error) {
        alert(error.message);
    }
};

document.getElementById("btn-renew-loan").onclick = async () => {
    try {
        const data = await request(`${API_URL}/loans/${encodeURIComponent(currentLoanId)}/renew`, {
            method: "PATCH"
        });

        alert(data.message || "Empréstimo renovado com sucesso.");
        closeModal();

        await loadLoans();
    } catch (error) {
        alert(error.message);
    }
};

document.getElementById("btn-delete-loan").onclick = async () => {
    if (!confirm("Remover registro do banco de dados?")) return;

    try {
        await request(`${API_URL}/loans/${encodeURIComponent(currentLoanId)}`, {
            method: "DELETE"
        });

        closeModal();
        await loadLoans();
        await loadBooks();
    } catch (error) {
        alert(error.message);
    }
};

// ─── TEMA ─────────────────────────────────────────────────
function toggleTheme() {
    const isDark = document.body.classList.contains("dark-theme");

    document.body.classList.toggle("light-theme", isDark);
    document.body.classList.toggle("dark-theme", !isDark);

    // Sidebar theme toggle (troca ícones lua/sol)
    const sidebarMoon = document.querySelector("#theme-toggle .icon-moon");
    const sidebarSun = document.querySelector("#theme-toggle .icon-sun");
    if (sidebarMoon && sidebarSun) {
        sidebarMoon.style.display = isDark ? "none" : "";
        sidebarSun.style.display = isDark ? "" : "none";
    }

    // Header mobile theme toggle
    const mhMoon = document.querySelector(".mh-icon-moon");
    const mhSun = document.querySelector(".mh-icon-sun");
    if (mhMoon && mhSun) {
        mhMoon.style.display = isDark ? "none" : "";
        mhSun.style.display = isDark ? "" : "none";
    }

    // Atualiza a meta tag theme-color para a barra de status do celular
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute("content", isDark ? "#f0f2f8" : "#0c0e14");

    localStorage.setItem("theme", isDark ? "light" : "dark");

    loadDashboard();
}

function applyTheme(savedTheme) {
    const isLight = savedTheme === "light";

    if (isLight) {
        document.body.className = "light-theme";
    } else {
        document.body.className = "dark-theme";
    }

    // Sidebar icons
    const sidebarMoon = document.querySelector("#theme-toggle .icon-moon");
    const sidebarSun = document.querySelector("#theme-toggle .icon-sun");
    if (sidebarMoon && sidebarSun) {
        sidebarMoon.style.display = isLight ? "" : "";
        sidebarSun.style.display = isLight ? "none" : "none";
        // No tema escuro mostra lua; no claro mostra sol
        if (isLight) {
            sidebarMoon.style.display = "none";
            sidebarSun.style.display = "";
        } else {
            sidebarMoon.style.display = "";
            sidebarSun.style.display = "none";
        }
    }

    // Mobile header icons
    const mhMoon = document.querySelector(".mh-icon-moon");
    const mhSun = document.querySelector(".mh-icon-sun");
    if (mhMoon && mhSun) {
        if (isLight) {
            mhMoon.style.display = "none";
            mhSun.style.display = "";
        } else {
            mhMoon.style.display = "";
            mhSun.style.display = "none";
        }
    }

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute("content", isLight ? "#f0f2f8" : "#0c0e14");
}

// ─── REDIMENSIONAMENTO (redesenha charts) ─────────────────
let resizeTimer = null;
window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (currentView === "view-dashboard") {
            loadDashboard();
        }
    }, 250);
});

// ─── INIT ─────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
    const savedTheme = localStorage.getItem("theme") || "dark";
    applyTheme(savedTheme);

    document.getElementById("loan-date").valueAsDate = new Date();

    await navigate(currentView, null, currentView === "view-dashboard"
        ? "btn-dashboard"
        : currentView === "view-books"
        ? "btn-books"
        : "btn-loans");
});
