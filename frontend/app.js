const API_URL = "hhttps://biblioteca-vsbz.onrender.com/";

let statusChart;
let monthlyChart;
let currentLoanId = null;
let currentBookId = null;
let allBooks = [];

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

async function navigate(viewId, clickedButton = null, fallbackButtonId = null) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));

    const targetView = document.getElementById(viewId);
    if (targetView) targetView.classList.add("active");

    let buttonToActivate = clickedButton;

    if (!buttonToActivate && fallbackButtonId) {
        buttonToActivate = document.getElementById(fallbackButtonId);
    }

    if (buttonToActivate?.classList.contains("nav-btn")) {
        buttonToActivate.classList.add("active");
    } else if (viewId === "view-dashboard") {
        document.getElementById("btn-dashboard")?.classList.add("active");
    } else if (viewId === "view-books") {
        document.getElementById("btn-books")?.classList.add("active");
    } else if (viewId === "view-loans") {
        document.getElementById("btn-loans")?.classList.add("active");
    }

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

async function loadDashboard() {
    try {
        const data = await request(`${API_URL}/dashboard`);

        document.getElementById("dash-total-books").textContent = data.totalBooks ?? 0;
        document.getElementById("dash-rented-books").textContent = data.rentedBooks ?? 0;
        document.getElementById("dash-late-loans").textContent = data.lateLoans ?? 0;

        const color = document.body.classList.contains("dark-theme") ? "#fff" : "#333";

        if (statusChart) statusChart.destroy();
        statusChart = new Chart(document.getElementById("chartStatus"), {
            type: "doughnut",
            data: {
                labels: ["Livres", "Alugados"],
                datasets: [
                    {
                        data: [data.availableBooks ?? 0, data.rentedBooks ?? 0],
                        backgroundColor: ["#007bff", "#dc3545"]
                    }
                ]
            },
            options: {
                plugins: {
                    legend: {
                        labels: { color }
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
                        backgroundColor: "#0d6efd"
                    }
                ]
            },
            options: {
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            color,
                            stepSize: 1
                        }
                    },
                    x: {
                        ticks: { color }
                    }
                },
                plugins: {
                    legend: {
                        labels: { color }
                    }
                }
            }
        });
    } catch (error) {
        console.error("Erro ao carregar dashboard:", error);
    }
}

async function loadBooks() {
    try {
        allBooks = await request(`${API_URL}/books`);
        renderBooks(allBooks);
        setupLoanBookSearch();
    } catch (error) {
        console.error("Erro ao carregar livros:", error);
    }
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
    try {
        const title = document.getElementById("edit-book-title").value.trim();
        const author = document.getElementById("edit-book-author").value.trim();

        await request(`${API_URL}/books/${encodeURIComponent(currentBookId)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, author })
        });

        closeEditBookModal();
        await loadBooks();
        await loadDashboard();
    } catch (error) {
        alert(error.message);
    }
}

document.getElementById("search-book-input").addEventListener("input", (e) => {
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

async function deleteBook(id) {
    if (!confirm("Deseja remover este livro do acervo?")) return;

    try {
        await request(`${API_URL}/books/${encodeURIComponent(id)}`, {
            method: "DELETE"
        });

        await loadBooks();
        await loadDashboard();
    } catch (error) {
        alert(error.message);
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
            author: document.getElementById("book-author").value,
            quantity: Number(document.getElementById("book-quantity").value)
        })
    });

    try {
        await request(`${API_URL}/books`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id: document.getElementById("book-id").value,
                title: document.getElementById("book-title").value,
                author: document.getElementById("book-author").value,
                quantity: Number(document.getElementById("book-quantity").value)
            })
        });


        e.target.reset();
        document.getElementById("book-quantity").value = 1;

        await loadBooks();
        await loadDashboard();
    } catch (error) {
        alert(error.message);
    }
};

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
                <tr onclick="openModal('${escapeAttr(l.id)}', '${escapeAttr(l.studentName)}', '${escapeAttr(l.bookTitle)}', '${escapeAttr(l.returnDate)}', '${escapeAttr(l.phone || "---")}', '${escapeAttr(l.school || "---")}', '${escapeAttr(l.grade || "---")}', '${escapeAttr(l.renewCount || 0)}')" style="cursor:pointer">
                    <td>${escapeHtml(l.studentName)}</td>
                    <td>${escapeHtml(l.phone || "---")}</td>
                    <td>${escapeHtml(l.school || "---")}</td>
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
                            onclick="event.stopPropagation(); openEditLoanModal('${escapeAttr(l.id)}', '${escapeAttr(l.studentName)}', '${escapeAttr(l.school || "")}', '${escapeAttr(l.grade || "")}', '${escapeAttr(l.phone || "")}')"
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
    } catch (error) {
        console.error("Erro ao carregar empréstimos:", error);
    }
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
    try {
        const studentName = document.getElementById("edit-loan-student").value.trim();
        const school = document.getElementById("edit-loan-school").value;
        const grade = document.getElementById("edit-loan-grade").value;
        const phone = document.getElementById("edit-loan-phone").value.trim();

        await request(`${API_URL}/loans/${encodeURIComponent(currentLoanId)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ studentName, school, grade, phone })
        });

        closeEditLoanModal();
        await loadLoans();
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
                bookId,
                rentalDate: document.getElementById("loan-date").value
            })
        });

        e.target.reset();
        document.getElementById("loan-book-id").value = "";
        document.getElementById("loan-date").valueAsDate = new Date();
        document.getElementById("loan-book-results").classList.remove("show");

        await loadBooks();
        await loadLoans();
        await loadDashboard();
    } catch (error) {
        alert(error.message);
    }
};

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
    try {
        const data = await request(`${API_URL}/loans/${encodeURIComponent(currentLoanId)}/return`, {
            method: "PATCH"
        });

        alert(data.message || "Entrega confirmada com sucesso.");
        closeModal();

        await loadLoans();
        await loadDashboard();
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
        await loadDashboard();
        await loadBooks();
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
        await loadDashboard();
        await loadBooks();
    } catch (error) {
        alert(error.message);
    }
};

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
