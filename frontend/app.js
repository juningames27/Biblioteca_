const API_URL = "https://biblioteca-vsbz.onrender.com/api";

let statusChart;
let monthlyChart;
let currentLoanId;
let currentBookId;
let allBooks = [];

async function navigate(viewId, clickedButton = null, fallbackButtonId = null) {
    document.querySelectorAll(".view").forEach((v) => {
        v.classList.remove("active");
    });

    document.querySelectorAll(".nav-btn").forEach((b) => {
        b.classList.remove("active");
    });

    const targetView = document.getElementById(viewId);

    if (targetView) {
        targetView.classList.add("active");
    }

    let buttonToActivate = clickedButton;

    if (!buttonToActivate && fallbackButtonId) {
        buttonToActivate = document.getElementById(fallbackButtonId);
    }

    if (buttonToActivate && buttonToActivate.classList.contains("nav-btn")) {
        buttonToActivate.classList.add("active");
    } else if (viewId === "view-dashboard") {
        document.getElementById("btn-dashboard")?.classList.add("active");
    } else if (viewId === "view-books") {
        document.getElementById("btn-books")?.classList.add("active");
    } else if (viewId === "view-loans") {
        document.getElementById("btn-loans")?.classList.add("active");
    }

    if (viewId === "view-dashboard") {
        loadDashboard();
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

// --- DASHBOARD ---
async function loadDashboard() {
    try {
        const res = await fetch(`${API_URL}/dashboard`);
        const data = await res.json();

        document.getElementById("dash-total-books").textContent = data.totalBooks;
        document.getElementById("dash-rented-books").textContent = data.rentedBooks;
        document.getElementById("dash-late-loans").textContent = data.lateLoans;

        const color = document.body.classList.contains("dark-theme") ? "#fff" : "#333";

        if (statusChart) {
            statusChart.destroy();
        }

        statusChart = new Chart(document.getElementById("chartStatus"), {
            type: "doughnut",
            data: {
                labels: ["Livres", "Alugados"],
                datasets: [
                    {
                        data: [data.availableBooks, data.rentedBooks],
                        backgroundColor: ["#007bff", "#dc3545"]
                    }
                ]
            },
            options: {
                plugins: {
                    legend: {
                        labels: {
                            color: color
                        }
                    }
                }
            }
        });

        if (monthlyChart) {
            monthlyChart.destroy();
        }

        monthlyChart = new Chart(document.getElementById("chartMonthly"), {
            type: "bar",
            data: {
                labels: ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"],
                datasets: [
                    {
                        label: "Empréstimos",
                        data: data.monthlyData,
                        backgroundColor: "#0d6efd"
                    }
                ]
            },
            options: {
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            color: color,
                            stepSize: 1
                        }
                    },
                    x: {
                        ticks: {
                            color: color
                        }
                    }
                },
                plugins: {
                    legend: {
                        labels: {
                            color: color
                        }
                    }
                }
            }
        });
    } catch (e) {
        console.error(e);
    }
}

// --- LIVROS ---
async function loadBooks() {
    const res = await fetch(`${API_URL}/books`);
    allBooks = await res.json();
    renderBooks(allBooks);
    setupLoanBookSearch();
}

function renderBooks(booksList) {
    const tbody = document.getElementById("table-books-body");
    if (!tbody) return;

    tbody.innerHTML = "";

    booksList.forEach((b) => {
        tbody.innerHTML += `
            <tr>
                <td>${escapeHtml(b.id)}</td>
                <td>${escapeHtml(b.title)}</td>
                <td>${escapeHtml(b.author)}</td>
                <td class="status-${escapeAttr(b.status)}">${escapeHtml(b.status)}</td>
                <td>
                    <button
                        onclick="openEditBookModal('${escapeAttr(b.id)}', '${escapeAttr(b.title)}', '${escapeAttr(b.author)}')"
                        class="btn-edit-row"
                    >
                        ✏️
                    </button>
                    <button onclick="deleteBook('${escapeAttr(b.id)}')" class="btn-delete-row">🗑️</button>
                </td>
            </tr>
        `;
    });
}

function openEditBookModal(id, title, author) {
    currentBookId = id;
    document.getElementById("edit-book-title").value = title;
    document.getElementById("edit-book-author").value = author;
    document.getElementById("modal-edit-book").style.display = "block";
}

function closeEditBookModal() {
    document.getElementById("modal-edit-book").style.display = "none";
}

async function updateBook() {
    const title = document.getElementById("edit-book-title").value;
    const author = document.getElementById("edit-book-author").value;

    const res = await fetch(`${API_URL}/books/${currentBookId}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ title, author })
    });

    if (res.ok) {
        closeEditBookModal();
        loadBooks();
    }
}

document.getElementById("search-book-input").addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase().trim();

    renderBooks(
        allBooks.filter((b) => {
            return (
                b.title.toLowerCase().includes(term) ||
                b.author.toLowerCase().includes(term) ||
                String(b.id).toLowerCase().includes(term)
            );
        })
    );
});

async function deleteBook(id) {
    if (confirm("Deseja remover este livro do acervo?")) {
        const res = await fetch(`${API_URL}/books/${id}`, {
            method: "DELETE"
        });

        if (res.ok) {
            loadBooks();
            loadDashboard();
        } else {
            alert((await res.json()).error);
        }
    }
}

document.getElementById("form-book").onsubmit = async (e) => {
    e.preventDefault();

    const res = await fetch(`${API_URL}/books`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            id: document.getElementById("book-id").value,
            title: document.getElementById("book-title").value,
            author: document.getElementById("book-author").value
        })
    });

    if (res.ok) {
        e.target.reset();
        loadBooks();
    } else {
        alert((await res.json()).error);
    }
};

// --- BUSCA CUSTOMIZADA DE LIVRO ---
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

    results.innerHTML = filteredBooks
        .map((book) => {
            return `
                <div class="book-search-item" onclick="selectLoanBook('${escapeAttr(book.id)}')">
                    <div class="book-search-title">${escapeHtml(book.title)}</div>
                    <div class="book-search-meta">
                        <span>${escapeHtml(book.author)}</span>
                        <span>ID: ${escapeHtml(book.id)}</span>
                    </div>
                </div>
            `;
        })
        .join("");

    results.classList.add("show");
}

function setupLoanBookSearch() {
    const input = document.getElementById("loan-book-search");
    const hiddenInput = document.getElementById("loan-book-id");
    const results = document.getElementById("loan-book-results");

    if (!input || !hiddenInput || !results) {
        return;
    }

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
                book.title.toLowerCase().includes(term) ||
                book.author.toLowerCase().includes(term) ||
                String(book.id).toLowerCase().includes(term)
            );
        });

        renderLoanBookResults(filtered.slice(0, 20));
    };

    input.onfocus = () => {
        const availableBooks = getAvailableBooks();
        renderLoanBookResults(availableBooks.slice(0, 8));
    };
}

function selectLoanBook(bookId) {
    const book = allBooks.find((b) => String(b.id) === String(bookId));

    if (!book) {
        return;
    }

    document.getElementById("loan-book-search").value = book.title;
    document.getElementById("loan-book-id").value = book.id;
    document.getElementById("loan-book-results").classList.remove("show");
}

document.addEventListener("click", (event) => {
    const wrapper = document.querySelector(".book-search-wrapper");
    const results = document.getElementById("loan-book-results");

    if (!wrapper || !results) {
        return;
    }

    if (!wrapper.contains(event.target)) {
        results.classList.remove("show");
    }
});

// --- EMPRÉSTIMOS ---
async function loadLoans() {
    const res = await fetch(`${API_URL}/loans`);
    const loans = await res.json();

    const tbody = document.getElementById("table-loans-body");
    if (!tbody) return;

    tbody.innerHTML = "";

    const today = new Date().setHours(0, 0, 0, 0);

    loans.forEach((l) => {
        const dueDate = parseBRDate(l.returnDate).setHours(0, 0, 0, 0);
        const isLate = dueDate < today;

        tbody.innerHTML += `
            <tr onclick="openModal('${escapeAttr(l.id)}', '${escapeAttr(l.studentName)}', '${escapeAttr(l.bookTitle)}', '${escapeAttr(l.returnDate)}', '${escapeAttr(l.phone || "---")}', '${escapeAttr(l.school || "---")}', '${escapeAttr(l.grade || "---")}', '${escapeAttr(l.renewCount || 0)}')" style="cursor:pointer">
                <td>${escapeHtml(l.studentName)}</td>
                <td>${escapeHtml(l.phone || "---")}</td>
                <td>${escapeHtml(l.school)}</td>
                <td>${escapeHtml(l.grade || "---")}</td>
                <td>${escapeHtml(l.bookTitle)}</td>
                <td>
                    ${escapeHtml(l.returnDate)}
                    ${isLate
                        ? '<span class="badge-late">ATRASADO</span>'
                        : '<span class="badge-ontime">EM DIA</span>'}
                </td>
                <td>
                    <button
                        onclick="event.stopPropagation(); openEditLoanModal('${escapeAttr(l.id)}', '${escapeAttr(l.studentName)}', '${escapeAttr(l.school)}', '${escapeAttr(l.grade)}', '${escapeAttr(l.phone || "")}')"
                        class="btn-edit-row"
                    >
                        ✏️
                    </button>
                    <button class="btn-ver" style="background: #fff; border-radius: 4px; padding: 2px 5px; color: #000; font-size: 12px; border: none;">
                        🔍 Detalhes
                    </button>
                </td>
            </tr>
        `;
    });
}

function openEditLoanModal(id, student, school, grade, phone) {
    currentLoanId = id;
    document.getElementById("edit-loan-student").value = student;
    document.getElementById("edit-loan-school").value = school;
    document.getElementById("edit-loan-grade").value = grade;
    document.getElementById("edit-loan-phone").value = phone || "";
    document.getElementById("modal-edit-loan").style.display = "block";
    closeModal();
}

function closeEditLoanModal() {
    document.getElementById("modal-edit-loan").style.display = "none";
}

async function updateLoan() {
    const studentName = document.getElementById("edit-loan-student").value;
    const school = document.getElementById("edit-loan-school").value;
    const grade = document.getElementById("edit-loan-grade").value;
    const phone = document.getElementById("edit-loan-phone").value;

    const res = await fetch(`${API_URL}/loans/${currentLoanId}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            studentName,
            school,
            grade,
            phone
        })
    });

    if (res.ok) {
        closeEditLoanModal();
        loadLoans();
    }
}

document.getElementById("form-loan").onsubmit = async (e) => {
    e.preventDefault();

    const bookId = document.getElementById("loan-book-id").value.trim();

    if (!bookId) {
        alert("Selecione um livro da lista de busca.");
        return;
    }

    const res = await fetch(`${API_URL}/loans`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            studentName: document.getElementById("loan-student").value,
            phone: document.getElementById("loan-phone").value,
            school: document.getElementById("loan-school").value,
            grade: document.getElementById("loan-grade").value,
            bookId: bookId,
            rentalDate: document.getElementById("loan-date").value
        })
    });

    if (res.ok) {
        e.target.reset();
        document.getElementById("loan-book-id").value = "";
        document.getElementById("loan-date").valueAsDate = new Date();
        document.getElementById("loan-book-results").classList.remove("show");
        loadBooks();
        loadLoans();
        loadDashboard();
    } else {
        alert((await res.json()).error);
    }
};

// --- MODAIS GERAIS ---
function openModal(id, student, book, date, phone, school, grade, renewCount) {
    currentLoanId = id;

    const today = new Date().setHours(0, 0, 0, 0);
    const dueDate = parseBRDate(date).setHours(0, 0, 0, 0);
    const statusBadge = dueDate < today
        ? '<span class="badge-late">ATRASADO</span>'
        : '<span class="badge-ontime">EM DIA</span>';

    document.getElementById("modal-details").innerHTML = `
        <p><b>Aluno:</b> ${escapeHtml(student)}</p>
        <p><b>Telefone:</b> ${escapeHtml(phone)}</p>
        <p><b>Escola:</b> ${escapeHtml(school)}</p>
        <p><b>Série:</b> ${escapeHtml(grade)}</p>
        <p><b>Livro:</b> ${escapeHtml(book)}</p>
        <p><b>Entrega:</b> ${escapeHtml(date)} ${statusBadge}</p>
        <p><b>Renovações:</b> ${escapeHtml(renewCount)}</p>
    `;

    document.getElementById("modal-loan").style.display = "block";
}

function closeModal() {
    document.getElementById("modal-loan").style.display = "none";
}

document.getElementById("btn-confirm-return").onclick = async () => {
    const res = await fetch(`${API_URL}/loans/${currentLoanId}/return`, {
        method: "PATCH"
    });

    const data = await res.json();

    if (res.ok) {
        alert(data.message || "Entrega confirmada com sucesso.");
        closeModal();
        loadLoans();
        loadDashboard();
        loadBooks();
    } else {
        alert(data.error || "Erro ao confirmar entrega.");
    }
};

document.getElementById("btn-renew-loan").onclick = async () => {
    const res = await fetch(`${API_URL}/loans/${currentLoanId}/renew`, {
        method: "PATCH"
    });

    const data = await res.json();

    if (res.ok) {
        alert(data.message || "Empréstimo renovado com sucesso.");
        closeModal();
        loadLoans();
        loadDashboard();
        loadBooks();
    } else {
        alert(data.error || "Erro ao renovar empréstimo.");
    }
};

document.getElementById("btn-delete-loan").onclick = async () => {
    if (confirm("Remover registro do banco de dados?")) {
        const res = await fetch(`${API_URL}/loans/${currentLoanId}`, {
            method: "DELETE"
        });

        const data = await res.json();

        if (res.ok) {
            closeModal();
            loadLoans();
            loadDashboard();
            loadBooks();
        } else {
            alert(data.error || "Erro ao remover empréstimo.");
        }
    }
};

// --- TEMA E INICIALIZAÇÃO ---
function toggleTheme() {
    const isDark = document.body.classList.contains("dark-theme");

    document.body.classList.toggle("light-theme", isDark);
    document.body.classList.toggle("dark-theme", !isDark);

    document.getElementById("theme-toggle").textContent = isDark ? "⚫" : "⚪";

    localStorage.setItem("theme", isDark ? "light" : "dark");

    loadDashboard();
}

document.addEventListener("DOMContentLoaded", () => {
    const saved = localStorage.getItem("theme") || "dark";

    if (saved === "light") {
        document.body.className = "light-theme";
        document.getElementById("theme-toggle").textContent = "⚫";
    } else {
        document.body.className = "dark-theme";
        document.getElementById("theme-toggle").textContent = "⚪";
    }

    document.getElementById("loan-date").valueAsDate = new Date();

    loadDashboard();
    loadBooks();
});