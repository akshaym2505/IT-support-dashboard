// ==========================================
// GLOBAL VARIABLES & CONFIG
// ==========================================
// Address of the FastAPI backend (backend/main.py)
const API_BASE = "http://127.0.0.1:8000";
// Written to localStorage whenever a ticket or note changes, so other open tabs refresh
const TICKETS_CHANGED_KEY = "itportal:ticketsChanged";
const BACKEND_DOWN_MESSAGE = "Can't reach the backend at " + API_BASE + ". Make sure it is running (see docs/README.md).";

let tickets = [];

// ==========================================
// SHARED HELPERS
// ==========================================
function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Turns a value like "Ready to Deploy" into a safe CSS class ("ready-to-deploy")
function cssToken(value) {
    return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function formatText(text) {
    if (!text) return "";
    return text.charAt(0).toUpperCase() + text.slice(1);
}

// New records store ISO dates; older tickets store toLocaleString() text
function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatMinutes(totalMinutes) {
    const minutes = Math.max(0, Math.round(Number(totalMinutes) || 0));
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (!hours) return rest + "m";
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

// Pulls FastAPI's {"detail": ...} message out of an error response
async function readError(response, fallback) {
    try {
        const data = await response.json();
        if (typeof data.detail === "string") return data.detail;
        if (Array.isArray(data.detail)) return data.detail.map(item => item.msg).join("; ");
    } catch (error) {
        // body was not JSON
    }
    return fallback || "Request failed (HTTP " + response.status + ")";
}

function errorMessage(error) {
    // fetch() rejects with a TypeError when the server can't be reached at all
    return error instanceof TypeError ? BACKEND_DOWN_MESSAGE : error.message;
}

function notifyTicketsChanged() {
    try {
        localStorage.setItem(TICKETS_CHANGED_KEY, String(Date.now()));
    } catch (error) {
        // storage unavailable: other tabs just won't auto-refresh
    }
}

function renderTableState(tbody, columns, kind, message) {
    if (!tbody) return;
    tbody.innerHTML = `<tr class="table-state ${kind}"><td colspan="${columns}">${escapeHtml(message)}</td></tr>`;
}

function setTextById(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value ?? "";
}

function saveBlob(blob, fileName) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

function ticketDetailsUrl(ticketId) {
    return "ticket-details.html?id=" + encodeURIComponent(ticketId);
}

function openTicketInNewTab(ticketId) {
    window.open(ticketDetailsUrl(ticketId), "_blank", "noopener");
}

// ==========================================
// FETCH DYNAMIC DATA FROM BACKEND
// ==========================================
async function fetchAllData() {
    const ticketTable = document.getElementById("ticketTableBody");
    const recentTable = document.getElementById("recentTicketTableBody");
    if (!ticketTable && !recentTable) return; // only the dashboard and tickets pages use this

    if (!tickets.length) {
        renderTableState(ticketTable, 8, "loading", "Loading tickets…");
        renderTableState(recentTable, 5, "loading", "Loading tickets…");
    }

    try {
        // 1. Fetch Dashboard Stats safely
        const statsResponse = await fetch(API_BASE + "/api/dashboard-stats");

        if (statsResponse.ok) {
            const stats = await statsResponse.json();
            const elementMap = {
                "count-total": stats.total,
                "count-open": stats.open,
                "count-pending": stats.pending,
                "count-resolved": stats.resolved,
                "count-closed": stats.closed,
                "count-critical": stats.critical
            };

            for (const [id, value] of Object.entries(elementMap)) {
                const el = document.getElementById(id);
                if (el) el.innerText = value;
            }
        }

        // 2. Fetch Ticket List safely
        const ticketsResponse = await fetch(API_BASE + "/api/tickets");
        if (!ticketsResponse.ok) throw new Error(await readError(ticketsResponse));
        tickets = await ticketsResponse.json();

        // 3. Render Tables
        loadTickets();
        loadRecentTickets();
    } catch (error) {
        console.error("Database connection failed:", error);
        renderTableState(ticketTable, 8, "error", errorMessage(error));
        renderTableState(recentTable, 5, "error", errorMessage(error));
    }
}

// Run immediately when page loads
document.addEventListener("DOMContentLoaded", fetchAllData);

// Another tab (e.g. a ticket opened with "View") changed a ticket or note.
// The browser only fires this in *other* tabs, so a tab never reacts to its own saves.
window.addEventListener("storage", function (event) {
    if (event.key === TICKETS_CHANGED_KEY) refreshAfterExternalChange();
});

async function refreshAfterExternalChange() {
    // quick-view popup on tickets.html: keep a status the user already changed but hasn't saved
    const openId = selectedViewTicketId;
    const statusEl = document.getElementById("viewTicketStatus");
    const before = openId ? tickets.find(item => item.id === openId) : null;
    const statusUntouched = before && statusEl && statusEl.value === before.status;

    await fetchAllData();

    if (openId && selectedViewTicketId === openId) {
        const fresh = tickets.find(item => item.id === openId);
        if (fresh) {
            setTextById("viewTicketSubject", fresh.subject);
            setTextById("viewTicketAssigned", fresh.assigned);
            setTextById("viewTicketDescription", fresh.description);
            if (statusUntouched) statusEl.value = fresh.status;
        }
        if (modalNotesPanel) modalNotesPanel.reload();
    }

    refreshTicketDetails();
}

// ==========================================
// LOGIN
// ==========================================
const loginForm = document.getElementById("loginForm");
if (loginForm) {
    loginForm.addEventListener("submit", function(event) {
        event.preventDefault();
        const username = document.getElementById("username").value.trim();
        const password = document.getElementById("password").value;

        if (username === "admin" && password === "admin123") {
            localStorage.setItem("loggedIn", "true");
            localStorage.setItem("username", username);
            window.location.href = "dashboard.html";
        } else {
            alert("Invalid username or password");
        }
    });
}

// ==========================================
// LOGIN PROTECTION & LOGOUT
// ==========================================
const currentPage = window.location.pathname;
const isLoginPage = currentPage.endsWith("index.html") || currentPage.endsWith("/") || currentPage === "";

if (!isLoginPage) {
    if (localStorage.getItem("loggedIn") !== "true") {
        window.location.href = "index.html";
    }
}

document.addEventListener("DOMContentLoaded", function () {
    const logoutBtn = document.getElementById("logoutBtn");
    if (!logoutBtn) return;

    logoutBtn.addEventListener("click", function () {
        if (!confirm("Are you sure you want to logout?")) return;
        localStorage.removeItem("loggedIn");
        localStorage.removeItem("username");
        window.location.href = "index.html";
    });
});

document.addEventListener("DOMContentLoaded", function () {
    const greeting = document.getElementById("welcomeUser");
    if (greeting) greeting.textContent = localStorage.getItem("username") || "Admin";
});

// =========================================
// LOAD TICKET TABLES
// =========================================
function loadTickets() {
    const table = document.getElementById("ticketTableBody");
    if (!table) return;
    table.innerHTML = "";

    if (!tickets.length) {
        renderTableState(table, 8, "empty", "No tickets yet. Click “+ Create Ticket” to add one.");
        return;
    }

    tickets.forEach(function(ticket) {
        const row = document.createElement("tr");
        row.classList.add("ticket-row");
        row.tabIndex = 0;
        row.title = "Click to preview " + ticket.id;
        row.dataset.search = [ticket.id, ticket.subject, ticket.requester, ticket.email, ticket.category,
            ticket.priority, ticket.status, ticket.assigned].join(" ").toLowerCase();

        const notesCount = ticket.notes_count || 0;
        row.innerHTML = `
            <td><strong>${escapeHtml(ticket.id)}</strong>${notesCount ? ` <span class="notes-chip" title="${notesCount} note(s)">💬 ${notesCount}</span>` : ""}</td>
            <td>${escapeHtml(ticket.subject)}</td>
            <td>${escapeHtml(ticket.requester)}<br><small>${escapeHtml(ticket.email)}</small></td>
            <td>${escapeHtml(formatText(ticket.category))}</td>
            <td><span class="priority ${cssToken(ticket.priority)}">${escapeHtml(formatText(ticket.priority))}</span></td>
            <td><span class="ticket-status ${cssToken(ticket.status)}">${escapeHtml(formatText(ticket.status))}</span></td>
            <td>${escapeHtml(ticket.assigned)}</td>
            <td>
                <button type="button" class="view-ticket-btn" title="Open ${escapeHtml(ticket.id)} in a new tab">View ↗</button>
            </td>
        `;

        // Clicking anywhere on the row opens the quick-view popup...
        row.addEventListener("click", () => viewTicket(ticket.id));
        row.addEventListener("keydown", function (event) {
            if (event.key === "Enter" && event.target === row) {
                event.preventDefault();
                viewTicket(ticket.id);
            }
        });
        // ...while "View" opens the full ticket page in a new tab
        row.querySelector(".view-ticket-btn").addEventListener("click", function (event) {
            event.stopPropagation();
            openTicketInNewTab(ticket.id);
        });

        table.appendChild(row);
    });

    applyTicketSearch();
}

function loadRecentTickets() {
    const table = document.getElementById("recentTicketTableBody");
    if (!table) return;
    table.innerHTML = "";

    if (!tickets.length) {
        renderTableState(table, 5, "empty", "No tickets yet.");
        return;
    }

    const recentTickets = tickets.slice(0, 4);

    recentTickets.forEach(function(ticket) {
        const row = document.createElement("tr");
        row.classList.add("ticket-row");
        row.tabIndex = 0;
        row.title = "Open " + ticket.id;
        row.innerHTML = `
            <td><strong>${escapeHtml(ticket.id)}</strong></td>
            <td>${escapeHtml(ticket.subject)}</td>
            <td>${escapeHtml(ticket.requester)}</td>
            <td><span class="priority ${cssToken(ticket.priority)}">${escapeHtml(formatText(ticket.priority))}</span></td>
            <td><span class="ticket-status ${cssToken(ticket.status)}">${escapeHtml(formatText(ticket.status))}</span></td>
        `;
        const open = () => { window.location.href = ticketDetailsUrl(ticket.id); };
        row.addEventListener("click", open);
        row.addEventListener("keydown", event => { if (event.key === "Enter") open(); });
        table.appendChild(row);
    });
}

// =========================================
// CREATE TICKET MODAL & SUBMISSION
// =========================================
document.addEventListener("DOMContentLoaded", function () {
    const openTicketBtn = document.getElementById("openTicketModal");
    const closeTicketBtn = document.getElementById("closeTicketModal");
    const cancelTicketBtn = document.getElementById("cancelTicket");
    const ticketModal = document.getElementById("ticketModal");
    const ticketForm = document.getElementById("ticketForm");

    if (openTicketBtn && ticketModal) {
        openTicketBtn.addEventListener("click", () => ticketModal.classList.add("show"));
    }
    if (closeTicketBtn && ticketModal) {
        closeTicketBtn.addEventListener("click", () => ticketModal.classList.remove("show"));
    }
    if (cancelTicketBtn && ticketModal) {
        cancelTicketBtn.addEventListener("click", () => ticketModal.classList.remove("show"));
    }

    if (ticketForm) {
        ticketForm.addEventListener("submit", async function (event) {
            event.preventDefault();

            const requester = document.getElementById("requester").value.trim();
            const email = document.getElementById("requesterEmail").value.trim();
            const subject = document.getElementById("ticketSubject").value.trim();
            const category = document.getElementById("ticketCategory").value;
            const priority = document.getElementById("ticketPriority").value;
            const description = document.getElementById("ticketDescription").value.trim();

            if (!requester || !email || !subject || !description) {
                alert("Please fill all required fields.");
                return;
            }

            // The backend assigns the ticket ID and creation time
            const newTicket = { subject, requester, email, category, priority, description };
            const submitBtn = ticketForm.querySelector('button[type="submit"]');
            if (submitBtn) submitBtn.disabled = true;

            try {
                const response = await fetch(API_BASE + "/api/tickets", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(newTicket),
                });
                if (!response.ok) {
                    alert("Could not create the ticket: " + await readError(response));
                    return;
                }
                const result = await response.json();
                ticketModal.classList.remove("show");
                ticketForm.reset();
                notifyTicketsChanged();
                fetchAllData();
                alert("Ticket " + result.id + " saved to database successfully!");
            } catch (error) {
                console.error("Error saving ticket:", error);
                alert(errorMessage(error));
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }
});

// =========================================
// SEARCH TICKETS
// =========================================
function applyTicketSearch() {
    const input = document.getElementById("ticketSearch");
    if (!input) return;
    const search = input.value.trim().toLowerCase();

    document.querySelectorAll("#ticketTableBody tr.ticket-row").forEach(function(row) {
        row.style.display = !search || row.dataset.search.includes(search) ? "" : "none";
    });
}

const ticketSearch = document.getElementById("ticketSearch");
if (ticketSearch) {
    ticketSearch.addEventListener("input", applyTicketSearch);
}

// =========================================
// QUICK VIEW POPUP & STATUS UPDATE (tickets.html)
// =========================================
let selectedViewTicketId = null;
let modalNotesPanel = null;

function viewTicket(ticketId) {
    const ticket = tickets.find(item => item.id === ticketId);
    const modal = document.getElementById("viewTicketModal");
    if (!ticket || !modal) return;
    selectedViewTicketId = ticketId;

    setTextById("viewTicketId", ticket.id);
    setTextById("viewTicketSubject", ticket.subject);
    setTextById("viewTicketRequester", ticket.requester);
    setTextById("viewTicketAssigned", ticket.assigned);
    setTextById("viewTicketDescription", ticket.description);

    const statusEl = document.getElementById("viewTicketStatus");
    if (statusEl) statusEl.value = ticket.status;

    const openTabLink = document.getElementById("viewTicketOpenTab");
    if (openTabLink) openTabLink.href = ticketDetailsUrl(ticket.id);

    const notesPanel = document.getElementById("modalNotesPanel");
    if (notesPanel) {
        modalNotesPanel = mountNotesPanel(notesPanel, ticket.id, {
            onChange: function () {
                notifyTicketsChanged();
                fetchAllData(); // refresh the notes count in the table
            },
        });
    }

    modal.classList.add("show");
}

function closeViewTicketModal() {
    const modal = document.getElementById("viewTicketModal");
    if (modal) modal.classList.remove("show");
    selectedViewTicketId = null;
    modalNotesPanel = null;
}

document.addEventListener("keydown", function (event) {
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName);
    if (event.key === "Escape" && selectedViewTicketId && !typing) closeViewTicketModal();
});

async function updateTicketStatus() {
    const ticketId = selectedViewTicketId;
    if (!ticketId) return;
    const newStatus = document.getElementById("viewTicketStatus").value;

    try {
        // Send the updated status to the SQLite database
        const response = await fetch(API_BASE + "/api/tickets/" + encodeURIComponent(ticketId), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: newStatus })
        });

        if (!response.ok) {
            alert("Failed to update status: " + await readError(response));
            return;
        }

        // Re-fetch all data so the tables and dashboard numbers refresh instantly
        notifyTicketsChanged();
        fetchAllData();
        closeViewTicketModal();
        alert(ticketId + " status updated to " + formatText(newStatus));
    } catch (error) {
        console.error("Error updating ticket:", error);
        alert(errorMessage(error));
    }
}

// =========================================
// TICKET NOTES PANEL
// Shared by the quick-view popup and the ticket details page.
// =========================================
const NOTE_TYPES = [
    { key: "discussion", label: "Discussion" },
    { key: "internal", label: "Internal" },
    { key: "resolution", label: "Resolution" },
];
const NOTE_TABS = [...NOTE_TYPES, { key: "all", label: "All" }];
let notesPanelCount = 0;

function noteTypeLabel(type) {
    const match = NOTE_TYPES.find(item => item.key === type);
    return match ? match.label : formatText(type);
}

function timeInputsHtml(prefix, totalMinutes) {
    const total = Math.max(0, Number(totalMinutes) || 0);
    return `
        <span class="time-spent-label">Time spent</span>
        <label class="time-spent-field"><input type="number" class="${prefix}-hours" min="0" max="168" step="1" value="${Math.floor(total / 60)}" aria-label="Hours"> h</label>
        <label class="time-spent-field"><input type="number" class="${prefix}-minutes" min="0" max="59" step="5" value="${total % 60}" aria-label="Minutes"> m</label>`;
}

// Returns total minutes, or null when the inputs are invalid
function readMinutes(scope, prefix) {
    const hours = Number(scope.querySelector("." + prefix + "-hours").value || 0);
    const minutes = Number(scope.querySelector("." + prefix + "-minutes").value || 0);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || minutes < 0) return null;
    return Math.round(hours * 60 + minutes);
}

function noteHtml(note) {
    const type = cssToken(note.note_type);
    const edited = note.updated_at
        ? ` · <em title="Edited ${escapeHtml(formatDate(note.updated_at))}">edited</em>`
        : "";
    const time = note.time_spent_minutes
        ? `<span class="note-time-chip" title="Time spent">⏱ ${formatMinutes(note.time_spent_minutes)}</span>`
        : "";
    return `
        <div class="note-item note-${type}" data-note-id="${Number(note.id)}">
            <div class="note-meta">
                <span class="note-type-badge ${type}">${escapeHtml(noteTypeLabel(note.note_type))}</span>
                <span class="note-author">${escapeHtml(note.author)}</span>
                <span class="note-date">${escapeHtml(formatDate(note.created_at))}${edited}</span>
                ${time}
                <span class="note-actions">
                    <button type="button" class="note-action-btn" data-action="edit">Edit</button>
                    <button type="button" class="note-action-btn danger" data-action="delete">Delete</button>
                </span>
            </div>
            <p class="note-body">${escapeHtml(note.text)}</p>
        </div>`;
}

// draft: what the user already typed in this editor (kept when the list is redrawn)
function editNoteHtml(note, draft) {
    const values = draft || { note_type: note.note_type, text: note.text, minutes: note.time_spent_minutes };
    return `
        <div class="note-item note-${cssToken(values.note_type)} editing" data-note-id="${Number(note.id)}">
            <div class="note-edit-row">
                <select class="note-edit-type" aria-label="Note type">
                    ${NOTE_TYPES.map(type => `<option value="${type.key}" ${type.key === values.note_type ? "selected" : ""}>${type.label}</option>`).join("")}
                </select>
                <div class="time-spent">${timeInputsHtml("note-edit", values.minutes)}</div>
            </div>
            <textarea class="note-edit-text" rows="3" maxlength="10000">${escapeHtml(values.text)}</textarea>
            <div class="note-edit-actions">
                <button type="button" class="cancel-btn" data-action="cancel">Cancel</button>
                <button type="button" class="create-ticket-btn" data-action="save">Save</button>
            </div>
        </div>`;
}

// Renders the composer, tabs and note list for one ticket into `container`.
// options.composerOpen: show the "new note" form straight away
// options.onLoad(notes) / options.onChange(notes): called after loading / any add, edit or delete
function mountNotesPanel(container, ticketId, options = {}) {
    const panelId = ++notesPanelCount;
    const typeName = "noteType" + panelId;
    const state = { notes: [], activeTab: "all", editingId: null, draft: null };
    const notesUrl = API_BASE + "/api/tickets/" + encodeURIComponent(ticketId) + "/notes";

    container.classList.add("notes-panel");
    container.innerHTML = `
        <button type="button" class="new-note-btn" aria-expanded="false">+ New Note</button>
        <div class="note-composer" hidden>
            <div class="note-type-picker" role="radiogroup" aria-label="Note type">
                ${NOTE_TYPES.map(type => `
                    <label class="note-type-option ${type.key}">
                        <input type="radio" name="${typeName}" value="${type.key}" ${type.key === "discussion" ? "checked" : ""}>
                        <span>${type.label}</span>
                    </label>`).join("")}
            </div>
            <textarea class="note-text-input" rows="3" maxlength="10000" placeholder="Type your note here... (Ctrl+Enter to add)"></textarea>
            <div class="note-composer-footer">
                <div class="time-spent">${timeInputsHtml("note-new", 0)}</div>
                <button type="button" class="create-ticket-btn note-add-btn">Add Note</button>
            </div>
            <p class="note-error" role="alert" hidden></p>
        </div>
        <div class="ticket-tabs" role="tablist">
            ${NOTE_TABS.map(tab => `<button type="button" class="tab-btn" role="tab" data-tab="${tab.key}">${tab.label} <span class="tab-count" data-count="${tab.key}">0</span></button>`).join("")}
        </div>
        <div class="notes-list" aria-live="polite"><p class="notes-empty">Loading notes…</p></div>
    `;

    const newNoteBtn = container.querySelector(".new-note-btn");
    const composer = container.querySelector(".note-composer");
    const textInput = container.querySelector(".note-text-input");
    const addBtn = container.querySelector(".note-add-btn");
    const errorEl = container.querySelector(".note-error");
    const list = container.querySelector(".notes-list");

    function setComposerOpen(open, focus) {
        composer.hidden = !open;
        newNoteBtn.setAttribute("aria-expanded", String(open));
        newNoteBtn.textContent = open ? "− Hide New Note" : "+ New Note";
        if (open && focus) textInput.focus();
    }

    function showError(message) {
        errorEl.textContent = message || "";
        errorEl.hidden = !message;
    }

    function selectedType() {
        const checked = container.querySelector(`input[name="${typeName}"]:checked`);
        return checked ? checked.value : "discussion";
    }

    function setComposerType(type) {
        const radio = container.querySelector(`input[name="${typeName}"][value="${type}"]`);
        if (radio) radio.checked = true;
    }

    function changed() {
        if (typeof options.onChange === "function") options.onChange(state.notes.slice());
    }

    function renderTabs() {
        container.querySelectorAll(".tab-btn").forEach(function (btn) {
            const active = btn.dataset.tab === state.activeTab;
            btn.classList.toggle("active", active);
            btn.setAttribute("aria-selected", String(active));
        });
        container.querySelectorAll("[data-count]").forEach(function (el) {
            const key = el.dataset.count;
            el.textContent = key === "all" ? state.notes.length : state.notes.filter(note => note.note_type === key).length;
        });
    }

    // Remember what is typed in the open editor so a redraw doesn't throw it away
    function captureDraft() {
        if (state.editingId === null) return;
        const card = list.querySelector(`.note-item.editing[data-note-id="${state.editingId}"]`);
        if (!card) return;
        state.draft = {
            note_type: card.querySelector(".note-edit-type").value,
            text: card.querySelector(".note-edit-text").value,
            minutes: readMinutes(card, "note-edit") ?? 0,
        };
    }

    function hasUnsavedEdit() {
        captureDraft();
        const note = state.notes.find(item => item.id === state.editingId);
        if (!note || !state.draft) return false;
        return state.draft.text.trim() !== note.text
            || state.draft.note_type !== note.note_type
            || state.draft.minutes !== (note.time_spent_minutes || 0);
    }

    function stopEditing() {
        state.editingId = null;
        state.draft = null;
    }

    function render() {
        captureDraft();
        if (state.editingId !== null && !state.notes.some(note => note.id === state.editingId)) stopEditing();
        renderTabs();
        const visible = state.activeTab === "all"
            ? state.notes
            : state.notes.filter(note => note.note_type === state.activeTab);

        if (!visible.length) {
            const label = state.activeTab === "all" ? "" : noteTypeLabel(state.activeTab).toLowerCase() + " ";
            list.innerHTML = `<p class="notes-empty">No ${label}notes yet.</p>`;
            return;
        }
        list.innerHTML = visible
            .map(note => note.id === state.editingId ? editNoteHtml(note, state.draft) : noteHtml(note))
            .join("");
    }

    async function load() {
        try {
            const response = await fetch(notesUrl);
            if (!response.ok) throw new Error(await readError(response));
            state.notes = await response.json();
            render();
            if (typeof options.onLoad === "function") options.onLoad(state.notes.slice());
        } catch (error) {
            console.error("Error loading notes:", error);
            list.innerHTML = `<p class="notes-empty error">Couldn't load notes. ${escapeHtml(errorMessage(error))}</p>`;
        }
    }

    newNoteBtn.addEventListener("click", () => setComposerOpen(composer.hidden, true));

    container.querySelectorAll(".tab-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
            state.activeTab = btn.dataset.tab;
            if (state.activeTab !== "all") setComposerType(state.activeTab);
            render();
        });
    });

    addBtn.addEventListener("click", async function () {
        const text = textInput.value.trim();
        const minutes = readMinutes(composer, "note-new");
        if (!text) {
            showError("Write something before adding the note.");
            textInput.focus();
            return;
        }
        if (minutes === null) {
            showError("Time spent must be zero or more.");
            return;
        }
        showError("");
        addBtn.disabled = true;
        addBtn.textContent = "Saving…";

        try {
            const response = await fetch(notesUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    note_type: selectedType(),
                    author: localStorage.getItem("username") || "Admin",
                    text: text,
                    time_spent_minutes: minutes,
                }),
            });
            if (!response.ok) {
                showError(await readError(response));
                return;
            }
            const note = await response.json();
            state.notes.unshift(note);
            textInput.value = "";
            composer.querySelector(".note-new-hours").value = 0;
            composer.querySelector(".note-new-minutes").value = 0;
            // keep the new note visible
            if (state.activeTab !== "all" && state.activeTab !== note.note_type) state.activeTab = note.note_type;
            render();
            changed();
        } catch (error) {
            showError(errorMessage(error));
        } finally {
            addBtn.disabled = false;
            addBtn.textContent = "Add Note";
        }
    });

    textInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) addBtn.click();
    });

    list.addEventListener("click", async function (event) {
        const button = event.target.closest("[data-action]");
        const card = button && button.closest("[data-note-id]");
        if (!card) return;
        const noteId = Number(card.dataset.noteId);
        const note = state.notes.find(item => item.id === noteId);
        if (!note) return;

        switch (button.dataset.action) {
            case "edit": {
                if (state.editingId !== null && state.editingId !== noteId && hasUnsavedEdit() &&
                    !confirm("Discard your unsaved changes to the note you're editing?")) return;
                stopEditing();
                state.editingId = noteId;
                render();
                const editor = list.querySelector(".note-edit-text");
                if (editor) editor.focus();
                break;
            }
            case "cancel":
                stopEditing();
                render();
                break;
            case "delete": {
                if (!confirm("Delete this note? This can't be undone.")) return;
                button.disabled = true;
                try {
                    const response = await fetch(notesUrl + "/" + noteId, { method: "DELETE" });
                    // 404 means it was already deleted elsewhere
                    if (!response.ok && response.status !== 404) {
                        alert("Could not delete the note: " + await readError(response));
                        button.disabled = false;
                        return;
                    }
                    state.notes = state.notes.filter(item => item.id !== noteId);
                    if (state.editingId === noteId) stopEditing();
                    render();
                    changed();
                } catch (error) {
                    alert(errorMessage(error));
                    button.disabled = false;
                }
                break;
            }
            case "save": {
                const text = card.querySelector(".note-edit-text").value.trim();
                const minutes = readMinutes(card, "note-edit");
                if (!text) {
                    alert("A note can't be empty.");
                    return;
                }
                if (minutes === null) {
                    alert("Time spent must be zero or more.");
                    return;
                }
                button.disabled = true;
                try {
                    const response = await fetch(notesUrl + "/" + noteId, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            note_type: card.querySelector(".note-edit-type").value,
                            text: text,
                            time_spent_minutes: minutes,
                        }),
                    });
                    if (!response.ok) {
                        alert("Could not save the note: " + await readError(response));
                        button.disabled = false;
                        return;
                    }
                    const updated = await response.json();
                    state.notes = state.notes.map(item => item.id === noteId ? updated : item);
                    stopEditing();
                    // like adding: if the type changed, follow the note to its tab
                    if (state.activeTab !== "all" && state.activeTab !== updated.note_type) state.activeTab = updated.note_type;
                    render();
                    changed();
                } catch (error) {
                    alert(errorMessage(error));
                    button.disabled = false;
                }
                break;
            }
        }
    });

    setComposerOpen(Boolean(options.composerOpen), false);
    renderTabs();
    load();
    return { reload: load };
}

// =========================================
// TICKET DETAILS PAGE (ticket-details.html, opened by "View")
// =========================================
let detailsTicket = null;
let detailsNotesPanel = null;

// Values in the Ticket Details form, in the same shape as the ticket
function readDetailsForm() {
    return {
        status: document.getElementById("detailsStatus").value,
        priority: document.getElementById("detailsPriority").value,
        category: document.getElementById("detailsCategory").value,
        assigned: document.getElementById("detailsAssigned").value.trim() || "Unassigned",
    };
}

// Only the fields the user changed compared with the last copy loaded from the server
function changedDetailsFields() {
    const form = readDetailsForm();
    const changes = {};
    Object.keys(form).forEach(key => {
        const saved = key === "assigned" ? (detailsTicket.assigned || "Unassigned") : detailsTicket[key];
        if (form[key] !== saved) changes[key] = form[key];
    });
    return changes;
}

function fillDetailsForm(ticket) {
    document.getElementById("detailsStatus").value = ticket.status;
    document.getElementById("detailsPriority").value = ticket.priority;
    document.getElementById("detailsCategory").value = ticket.category;
    document.getElementById("detailsAssigned").value = ticket.assigned === "Unassigned" ? "" : (ticket.assigned || "");
}

// Called when another tab changed tickets or notes
async function refreshTicketDetails() {
    if (!detailsTicket) return;
    try {
        const response = await fetch(API_BASE + "/api/tickets/" + encodeURIComponent(detailsTicket.id));
        if (!response.ok) return;
        const fresh = await response.json();
        // show the new values, then put back only the fields the user was still editing
        const pending = changedDetailsFields();
        renderTicketDetails(fresh);
        const fieldIds = { status: "detailsStatus", priority: "detailsPriority", category: "detailsCategory", assigned: "detailsAssigned" };
        Object.keys(pending).forEach(key => {
            document.getElementById(fieldIds[key]).value = key === "assigned" && pending[key] === "Unassigned" ? "" : pending[key];
        });
        if (detailsNotesPanel) detailsNotesPanel.reload();
    } catch (error) {
        // keep showing what we have
    }
}

async function initTicketDetailsPage() {
    if (!document.getElementById("ticketDetailsPage")) return;

    const ticketId = new URLSearchParams(window.location.search).get("id");
    if (!ticketId) {
        showTicketDetailsMessage("No ticket selected", "Open a ticket from the Tickets page.");
        return;
    }

    try {
        const response = await fetch(API_BASE + "/api/tickets/" + encodeURIComponent(ticketId));
        if (response.status === 404) {
            showTicketDetailsMessage("Ticket not found", "Ticket " + ticketId + " doesn't exist or was removed.");
            return;
        }
        if (!response.ok) throw new Error(await readError(response));

        renderTicketDetails(await response.json());
        detailsNotesPanel = mountNotesPanel(document.getElementById("detailsNotesPanel"), ticketId, {
            composerOpen: true,
            onLoad: updateTicketSummary,
            onChange: function (notes) {
                updateTicketSummary(notes);
                notifyTicketsChanged();
            },
        });
        loadAssigneeSuggestions();
    } catch (error) {
        console.error("Error loading ticket:", error);
        showTicketDetailsMessage("Can't load this ticket", errorMessage(error));
    }
}

function showTicketDetailsMessage(title, message) {
    const layout = document.getElementById("detailsLayout");
    const box = document.getElementById("detailsState");
    if (layout) layout.hidden = true;
    if (box) {
        box.hidden = false;
        box.innerHTML = `
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(message)}</p>
            <a href="tickets.html" class="create-ticket-btn">Back to Tickets</a>`;
    }
    setTextById("detailsTitle", title);
    setTextById("detailsSubtitle", "");
}

function renderTicketDetails(ticket) {
    detailsTicket = ticket;
    document.title = ticket.id + " · " + ticket.subject + " - IT Support Portal";

    setTextById("detailsTitle", ticket.id);
    setTextById("detailsSubtitle", ticket.subject);
    setTextById("detailsDescription", ticket.description);
    setTextById("detailsCreatedLine", "Opened by " + ticket.requester + " on " + formatDate(ticket.createdAt));
    setTextById("detailsRequester", ticket.requester);
    setTextById("detailsTicketId", ticket.id);
    setTextById("detailsCreated", formatDate(ticket.createdAt));

    const emailLink = document.getElementById("detailsEmail");
    if (emailLink) {
        emailLink.textContent = ticket.email;
        emailLink.href = "mailto:" + ticket.email;
    }

    fillDetailsForm(ticket);

    updateDetailsPills(ticket);
    updateTicketSummary(null, ticket.total_time_minutes);

    document.getElementById("detailsState").hidden = true;
    document.getElementById("detailsLayout").hidden = false;
}

function updateDetailsPills(ticket) {
    const status = document.getElementById("detailsStatusPill");
    if (status) {
        status.className = "ticket-status " + cssToken(ticket.status);
        status.textContent = formatText(ticket.status);
    }
    const priority = document.getElementById("detailsPriorityPill");
    if (priority) {
        priority.className = "priority " + cssToken(ticket.priority);
        priority.textContent = formatText(ticket.priority) + " priority";
    }
    setTextById("detailsAssignedSummary", ticket.assigned || "Unassigned");
}

// notes: the loaded notes (or null to only show the total the ticket endpoint returned)
function updateTicketSummary(notes, totalMinutes) {
    if (Array.isArray(notes)) {
        totalMinutes = notes.reduce((sum, note) => sum + (note.time_spent_minutes || 0), 0);
        const counts = NOTE_TYPES.map(type => {
            const count = notes.filter(note => note.note_type === type.key).length;
            return count + " " + type.label.toLowerCase();
        });
        setTextById("detailsNoteCounts", notes.length ? counts.join(" · ") : "No notes yet");
    }
    if (totalMinutes !== undefined) setTextById("detailsTotalTime", formatMinutes(totalMinutes));
}

async function loadAssigneeSuggestions() {
    const list = document.getElementById("assigneeOptions");
    if (!list) return;
    const names = new Set();
    const me = localStorage.getItem("username");
    if (me) names.add(me);
    try {
        const response = await fetch(API_BASE + "/api/tickets");
        if (response.ok) {
            (await response.json()).forEach(ticket => {
                const name = (ticket.assigned || "").trim();
                if (name && name !== "Unassigned") names.add(name);
            });
        }
    } catch (error) {
        // suggestions are optional
    }
    list.innerHTML = [...names].sort().map(name => `<option value="${escapeHtml(name)}"></option>`).join("");
}

document.addEventListener("DOMContentLoaded", function () {
    initTicketDetailsPage();

    const form = document.getElementById("detailsForm");
    if (!form) return;

    form.addEventListener("submit", async function (event) {
        event.preventDefault();
        if (!detailsTicket) return;

        const message = document.getElementById("detailsSaveMsg");
        const setMessage = (text, kind) => {
            message.textContent = text;
            message.className = "details-save-msg " + (kind || "");
        };
        // send only what changed, so a stale form can't undo changes made in another tab
        const changes = changedDetailsFields();
        if (!Object.keys(changes).length) {
            setMessage("Nothing to save: no changes.");
            return;
        }
        const saveBtn = form.querySelector('button[type="submit"]');
        saveBtn.disabled = true;
        setMessage("Saving…");

        try {
            const response = await fetch(API_BASE + "/api/tickets/" + encodeURIComponent(detailsTicket.id), {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(changes),
            });
            if (!response.ok) {
                setMessage(await readError(response), "error");
                return;
            }
            const result = await response.json();
            renderTicketDetails(Object.assign(detailsTicket, result.ticket));
            setMessage("Saved ✓", "success");
            notifyTicketsChanged();
        } catch (error) {
            setMessage(errorMessage(error), "error");
        } finally {
            saveBtn.disabled = false;
        }
    });
});


// ==========================================
// ASSETS MANAGEMENT
// ==========================================
const ASSET_COLUMNS = 14;
const ASSET_FIELDS = ["asset_name", "device_image", "asset_tag", "serial", "model", "category", "status",
    "checked_out_to", "location", "purchase_cost", "current_value", "desk_number"];
let globalAssets = [];
let isEditingAsset = false;
let currentEditTagId = "";

// The API expects every asset field as a string
function assetPayload(asset) {
    const payload = {};
    ASSET_FIELDS.forEach(field => { payload[field] = String(asset[field] ?? ""); });
    return payload;
}

// Fetch and render assets AND backend stats
async function fetchAssets() {
    const table = document.getElementById("assetTableBody");
    if (!table) return;
    if (!globalAssets.length) renderTableState(table, ASSET_COLUMNS, "loading", "Loading assets…");

    try {
        const response = await fetch(API_BASE + "/api/assets");
        if (!response.ok) throw new Error(await readError(response));
        globalAssets = await response.json();
        renderAssets(globalAssets);
        updateAssetStats();
    } catch (error) {
        console.error("Error fetching assets:", error);
        renderTableState(table, ASSET_COLUMNS, "error", error instanceof TypeError
            ? BACKEND_DOWN_MESSAGE
            : "Couldn't load assets: " + error.message);
    }
}

async function updateAssetStats() {
    try {
        const response = await fetch(API_BASE + "/api/asset-stats");
        if (response.ok) {
            const stats = await response.json();
            setTextById("asset-total", stats.total);
            setTextById("asset-deployed", stats.deployed);
            setTextById("asset-ready", stats.ready);
            setTextById("asset-pending", stats.pending);
        }
    } catch (error) {
        console.error("Failed to fetch live stats:", error);
    }
}

function renderAssets(assets) {
    const table = document.getElementById("assetTableBody");
    if (!table) return;
    table.innerHTML = "";

    if (!assets.length) {
        renderTableState(table, ASSET_COLUMNS, "empty", "No assets yet. Click “+ Add Asset” to add your first device.");
        return;
    }

    assets.forEach(asset => {
        const row = document.createElement("tr");
        row.dataset.search = ASSET_FIELDS.filter(field => field !== "device_image")
            .map(field => asset[field] ?? "").join(" ").toLowerCase();

        row.innerHTML = `
            <td><strong>${escapeHtml(asset.asset_name)}</strong></td>
            <td>${asset.device_image ? `<img src="${escapeHtml(asset.device_image)}" alt="Device" style="width: 30px; height: 30px; border-radius: 4px; object-fit: cover;">` : 'No Image'}</td>
            <td>${escapeHtml(asset.asset_tag)}</td>
            <td>${escapeHtml(asset.serial)}</td>
            <td>${escapeHtml(asset.model)}</td>
            <td>${escapeHtml(asset.category)}</td>
            <td><span class="ticket-status ${cssToken(asset.status)}">${escapeHtml(asset.status)}</span></td>
            <td>${escapeHtml(asset.checked_out_to || 'Unassigned')}</td>
            <td>${escapeHtml(asset.location)}</td>
            <td>$${escapeHtml(asset.purchase_cost || '0.00')}</td>
            <td>$${escapeHtml(asset.current_value || '0.00')}</td>
            <td>${escapeHtml(asset.desk_number)}</td>
            <td>
                <button type="button" class="view-ticket-btn" data-action="checkout">
                    ${asset.checked_out_to ? 'Check In' : 'Check Out'}
                </button>
            </td>
            <td>
                <button type="button" class="view-ticket-btn" data-action="edit" style="background-color: #3b82f6; color: white; border: none; margin-right: 5px;">Edit</button>
                <button type="button" class="view-ticket-btn" data-action="retire" style="color: red;">Retire</button>
            </td>
        `;
        row.querySelector('[data-action="checkout"]').addEventListener("click", () => checkOutAsset(asset.asset_tag));
        row.querySelector('[data-action="edit"]').addEventListener("click", () => editAsset(asset.asset_tag));
        row.querySelector('[data-action="retire"]').addEventListener("click", () => deleteAsset(asset.asset_tag));
        table.appendChild(row);
    });

    applyAssetSearch();
}

function applyAssetSearch() {
    const input = document.getElementById("assetSearch");
    if (!input) return;
    const value = input.value.trim().toLowerCase();
    document.querySelectorAll("#assetTableBody tr").forEach(row => {
        if (!row.dataset.search) return; // loading / empty rows
        row.style.display = !value || row.dataset.search.includes(value) ? "" : "none";
    });
}

// Selects `value`, adding it as an option first if the list doesn't have it
function setSelectValue(select, value) {
    if (value && ![...select.options].some(option => option.value === value)) {
        select.add(new Option(value, value));
    }
    select.value = value || select.options[0].value;
}

function closeAssetModal() {
    const modal = document.getElementById("assetModal");
    if (modal) modal.classList.remove("show");
    const tagInput = document.getElementById("assetTag");
    if (tagInput) tagInput.disabled = false;
    isEditingAsset = false;
    currentEditTagId = "";
}

// Open modal for EDITING
function editAsset(tagId) {
    const asset = globalAssets.find(a => a.asset_tag === tagId);
    if (!asset) return;

    isEditingAsset = true;
    currentEditTagId = tagId;

    // Populate the form with existing data
    document.getElementById("assetName").value = asset.asset_name || "";
    document.getElementById("assetTag").value = asset.asset_tag || "";
    document.getElementById("assetTag").disabled = true; // Prevent changing the ID
    document.getElementById("assetSerial").value = asset.serial || "";
    document.getElementById("assetModel").value = asset.model || "";
    document.getElementById("assetCategory").value = asset.category || "";
    setSelectValue(document.getElementById("assetStatus"), asset.status);
    document.getElementById("assetCheckedOut").value = asset.checked_out_to || "";
    document.getElementById("assetLocation").value = asset.location || "";
    document.getElementById("assetCost").value = asset.purchase_cost || "";
    document.getElementById("assetValue").value = asset.current_value || "";
    document.getElementById("assetDesk").value = asset.desk_number || "";
    document.getElementById("assetImage").value = asset.device_image || "";

    setTextById("assetModalTitle", "Edit Asset " + tagId);
    document.getElementById("assetModal").classList.add("show");
}

// Asset Modal & Form Logic
document.addEventListener("DOMContentLoaded", function () {
    fetchAssets(); // does nothing on pages without the asset table

    const openAssetBtn = document.getElementById("openAssetModal");
    const closeAssetBtn = document.getElementById("closeAssetModal");
    const cancelAssetBtn = document.getElementById("cancelAsset");
    const assetModal = document.getElementById("assetModal");
    const assetForm = document.getElementById("assetForm");
    const assetSearch = document.getElementById("assetSearch");

    // Open modal for CREATING
    if (openAssetBtn && assetModal) {
        openAssetBtn.addEventListener("click", () => {
            isEditingAsset = false;
            currentEditTagId = "";
            assetForm.reset();
            document.getElementById("assetTag").disabled = false; // Allow typing ID
            setTextById("assetModalTitle", "Add New Asset");
            assetModal.classList.add("show");
        });
    }

    if (closeAssetBtn) closeAssetBtn.addEventListener("click", closeAssetModal);
    if (cancelAssetBtn) cancelAssetBtn.addEventListener("click", closeAssetModal);
    if (assetSearch) assetSearch.addEventListener("input", applyAssetSearch);

    if (assetForm) {
        assetForm.addEventListener("submit", async function (event) {
            event.preventDefault();

            const assetData = {
                asset_name: document.getElementById("assetName").value.trim(),
                device_image: document.getElementById("assetImage").value.trim(),
                asset_tag: document.getElementById("assetTag").value.trim(),
                serial: document.getElementById("assetSerial").value.trim(),
                model: document.getElementById("assetModel").value.trim(),
                category: document.getElementById("assetCategory").value.trim(),
                status: document.getElementById("assetStatus").value,
                checked_out_to: document.getElementById("assetCheckedOut").value.trim(),
                location: document.getElementById("assetLocation").value.trim(),
                purchase_cost: document.getElementById("assetCost").value.trim(),
                current_value: document.getElementById("assetValue").value.trim(),
                desk_number: document.getElementById("assetDesk").value.trim()
            };

            // Determine if we are POSTing (new) or PUTting (editing)
            const method = isEditingAsset ? 'PUT' : 'POST';
            const url = isEditingAsset
                ? API_BASE + '/api/assets/' + encodeURIComponent(currentEditTagId)
                : API_BASE + '/api/assets';

            try {
                const response = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(assetData),
                });

                if (response.ok) {
                    closeAssetModal();
                    assetForm.reset();
                    fetchAssets();
                } else {
                    alert("Failed to save asset: " + await readError(response));
                }
            } catch (error) {
                console.error("Error saving asset:", error);
                alert(errorMessage(error));
            }
        });
    }
});

// Quick Check-in / Check-out toggle
async function checkOutAsset(tagId) {
    const asset = globalAssets.find(a => a.asset_tag === tagId);
    if (!asset) return;

    let person = "";
    if (asset.checked_out_to) {
        if (!confirm("Check in " + (asset.asset_name || tagId) + " from " + asset.checked_out_to + "?")) return;
    } else {
        const answer = prompt("Enter the name of the person checking out this asset:");
        if (answer === null) return; // Cancelled prompt
        person = answer.trim();
        if (!person) {
            alert("Please enter a name to check the asset out.");
            return;
        }
    }

    const updated = assetPayload(Object.assign({}, asset, {
        checked_out_to: person,
        status: person ? "Deployed" : "Ready to Deploy",
    }));

    try {
        const response = await fetch(API_BASE + '/api/assets/' + encodeURIComponent(tagId), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updated)
        });
        if (!response.ok) {
            alert("Could not update the asset: " + await readError(response));
            return;
        }
    } catch (error) {
        alert(errorMessage(error));
        return;
    }

    fetchAssets();
}

// Retire an asset
async function deleteAsset(tagId) {
    if (!confirm("Are you sure you want to permanently retire and delete asset " + tagId + "?")) return;

    try {
        const response = await fetch(API_BASE + '/api/assets/' + encodeURIComponent(tagId), {
            method: 'DELETE'
        });
        if (!response.ok && response.status !== 404) {
            alert("Could not retire the asset: " + await readError(response));
            return;
        }
    } catch (error) {
        alert(errorMessage(error));
        return;
    }

    fetchAssets();
}


// ==========================================
// MULTI-OS REMOTE TROUBLESHOOTING LOGIC
// ==========================================
let remoteMachines = [];
let remoteGroup = "all";

function isServerMachine(machine) {
    const name = (machine.hostname || "").toLowerCase();
    return name.includes("srv") || name.includes("server");
}

function isOfflineMachine(machine) {
    return (machine.status || "").toLowerCase() === "offline";
}

function machineInGroup(machine, group) {
    if (group === "servers") return isServerMachine(machine);
    if (group === "workstations") return !isServerMachine(machine);
    if (group === "offline") return isOfflineMachine(machine);
    return true;
}

async function loadRemoteMachines() {
    const table = document.getElementById("remoteMachineList");
    if (!table) return;

    try {
        const response = await fetch(API_BASE + '/api/remote-machines');
        if (!response.ok) throw new Error(await readError(response));
        remoteMachines = await response.json();
    } catch (error) {
        console.error("Error fetching machines:", error);
        renderTableState(table, 6, "error", errorMessage(error));
        return;
    }

    // --- SIDEBAR COUNTING LOGIC ---
    const serverCount = remoteMachines.filter(isServerMachine).length;
    setTextById("count-all", `(${remoteMachines.length})`);
    setTextById("count-servers", `(${serverCount})`);
    setTextById("count-workstations", `(${remoteMachines.length - serverCount})`);
    setTextById("count-offline", `(${remoteMachines.filter(isOfflineMachine).length})`);

    renderRemoteMachines();
}

function renderRemoteMachines() {
    const table = document.getElementById("remoteMachineList");
    if (!table) return;
    const searchInput = document.getElementById("remoteSearch");
    const search = searchInput ? searchInput.value.trim().toLowerCase() : "";

    const visible = remoteMachines
        .filter(machine => machineInGroup(machine, remoteGroup))
        .filter(machine => !search || [machine.os_type, machine.hostname, machine.ip_address, machine.user,
            machine.company, machine.site, machine.department].join(" ").toLowerCase().includes(search));

    table.innerHTML = "";
    if (!visible.length) {
        renderTableState(table, 6, "empty", remoteMachines.length
            ? "No machines match this filter."
            : "No machines registered yet. Use “+ Build Installer” to add one.");
        return;
    }

    visible.forEach(machine => {
        const isOnline = (machine.status || "").toLowerCase() === "online";
        const statusBadge = isOnline
            ? `<span style="color: #166534; background: #dcfce7; padding: 4px 8px; border-radius: 10px; font-weight: bold;">● Online</span>`
            : `<span style="color: #991b1b; background: #fee2e2; padding: 4px 8px; border-radius: 10px; font-weight: bold;">○ Offline</span>`;
        const disabledAttrs = 'disabled style="opacity: 0.5; cursor: not-allowed;"';

        let osIcon = "💻";
        if (machine.os_type === "macOS") osIcon = "🍎";
        if (machine.os_type === "Linux") osIcon = "🐧";
        if (machine.os_type === "Windows") osIcon = "🪟";

        const labels = [machine.company, machine.site, machine.department].filter(Boolean).join(" · ");
        const demoBadge = machine.demo
            ? ' <span class="demo-badge" title="Sample machine shown until a real agent registers">Demo</span>'
            : "";

        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${statusBadge}</td>
            <td><strong>${osIcon} ${escapeHtml(machine.os_type)}</strong></td>
            <td><strong>${escapeHtml(machine.hostname)}</strong>${demoBadge}${labels ? `<br><small>${escapeHtml(labels)}</small>` : ""}</td>
            <td><code>${escapeHtml(machine.ip_address)}</code></td>
            <td>${escapeHtml(machine.user)}</td>
            <td>
                ${machine.os_type === "Linux" ? `
                    <button type="button" class="view-ticket-btn" data-action="remote" ${!isOnline ? disabledAttrs : 'style="background: #4b5563; color: white; border: none; margin-right: 4px;"'}>Web SSH</button>
                ` : ''}
                <button type="button" class="view-ticket-btn" data-action="remote"
                        ${!isOnline ? disabledAttrs : 'style="background: #2563eb; color: white; border: none; margin-right: 4px;"'}>
                    Remote Desktop
                </button>
                <button type="button" class="view-ticket-btn" data-action="session"
                        ${!isOnline ? disabledAttrs : 'style="background: #8b5cf6; color: white; border: none;"'}>
                    ↓ 5-Min Session
                </button>
            </td>
        `;
        row.querySelectorAll("[data-action]").forEach(button => {
            button.addEventListener("click", () => {
                if (button.dataset.action === "session") {
                    downloadTimedSession(machine.hostname, machine.ip_address, machine.os_type, machine.user);
                } else {
                    openRemoteSession(machine.hostname, machine.remote_url);
                }
            });
        });
        table.appendChild(row);
    });
}

function isSafeSessionUrl(url) {
    try {
        return ["http:", "https:", "data:"].includes(new URL(url, window.location.href).protocol);
    } catch (error) {
        return false;
    }
}

function openRemoteSession(hostname, remoteUrl) {
    if (!remoteUrl) {
        alert("No active session gateway configured for " + hostname);
        return;
    }
    if (!isSafeSessionUrl(remoteUrl)) {
        alert("The session address for " + hostname + " isn't an http(s) link, so it was blocked.");
        return;
    }

    // Option A: Launch in Embedded IFrame Modal
    const modal = document.getElementById("remoteSessionModal");
    const frame = document.getElementById("remoteSessionFrame");
    const title = document.getElementById("sessionModalTitle");

    if (modal && frame) {
        title.innerText = "Troubleshooting Session - " + hostname;
        frame.src = remoteUrl;
        modal.classList.add("show");
    } else {
        // Option B: Fallback to standalone popup tab
        window.open(remoteUrl, '_blank', 'width=1280,height=720');
    }
}

function closeRemoteSession() {
    const modal = document.getElementById("remoteSessionModal");
    const frame = document.getElementById("remoteSessionFrame");
    if (frame) frame.src = "";
    if (modal) modal.classList.remove("show");
}

document.addEventListener("DOMContentLoaded", function () {
    if (!document.getElementById("remoteMachineList")) return;
    loadRemoteMachines();

    const remoteSearch = document.getElementById("remoteSearch");
    if (remoteSearch) remoteSearch.addEventListener("input", renderRemoteMachines);

    document.querySelectorAll(".group-list li[data-group]").forEach(item => {
        item.addEventListener("click", () => {
            remoteGroup = item.dataset.group;
            document.querySelectorAll(".group-list li[data-group]").forEach(other => {
                other.classList.toggle("active", other === item);
            });
            renderRemoteMachines();
        });
    });
});

// ==========================================
// 5-MINUTE TIMED SESSION GENERATOR
// ==========================================
// Machine details come from agents, so only allow characters that are safe inside a script
const SAFE_HOSTNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const SAFE_IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const SAFE_USER_RE = /^[A-Za-z0-9._-]{1,64}$/;

function downloadTimedSession(hostname, ip, osType, user) {
    const isWindows = (osType || "").toLowerCase() === "windows";
    if (!SAFE_HOSTNAME_RE.test(hostname || "") || !SAFE_IPV4_RE.test(ip || "") ||
        (!isWindows && !SAFE_USER_RE.test(user || ""))) {
        alert("This machine's hostname, IP or user contains characters that aren't safe in a script, so no session file was created.");
        return;
    }

    let fileContent = "";
    let fileName = "";

    if (isWindows) {
        fileName = `Connect_${hostname}_5Min.bat`;
        fileContent = `@echo off\n`;
        fileContent += `echo Starting strict 5-minute practice session to ${hostname} (${ip})...\n`;
        fileContent += `start mstsc /v:${ip}\n`;
        fileContent += `echo Session is active. DO NOT CLOSE THIS WINDOW.\n`;
        fileContent += `timeout /t 300 /nobreak\n`;
        fileContent += `echo Time limit reached! Forcing disconnection...\n`;
        fileContent += `taskkill /f /im mstsc.exe\n`;
        fileContent += `echo Practice session ended.\n`;
        fileContent += `pause\n`;
    } else {
        fileName = `Connect_${hostname}_5Min.sh`;
        fileContent = `#!/bin/bash\n`;
        fileContent += `echo "Starting strict 5-minute practice session to ${hostname} (${ip})..."\n`;
        fileContent += `timeout 300 ssh ${user}@${ip}\n`;
        fileContent += `echo "Time limit reached! Disconnected."\n`;
        fileContent += `sleep 3\n`;
    }

    saveBlob(new Blob([fileContent], { type: 'text/plain' }), fileName);
}


// ==========================================
// BUILD INSTALLER MODAL LOGIC
// ==========================================
function openBuildInstaller() {
    const modal = document.getElementById("buildInstallerModal");
    if (!modal) return;
    modal.classList.add("show");
    toggleCustomNameField();
    prefillPortalUrl();
}

function closeBuildInstaller() {
    const modal = document.getElementById("buildInstallerModal");
    if (modal) modal.classList.remove("show");
}

// Remote PCs can't reach 127.0.0.1, so suggest this server's LAN address
async function prefillPortalUrl() {
    const input = document.getElementById("instPortalUrl");
    if (!input) return;
    if (!input.value.trim()) {
        input.value = API_BASE;
        try {
            const response = await fetch(API_BASE + "/api/server-info");
            if (response.ok) {
                const info = await response.json();
                if (input.value === API_BASE) input.value = info.suggested_portal_url;
                if (!info.windows_installer_available) {
                    setTextById("instTypeHint", "This server can't build .exe files (no C# compiler found). Use the Python agent.");
                }
            }
        } catch (error) {
            // keep API_BASE; the hint below explains the problem
        }
    }
    updatePortalUrlHint();
}

function updatePortalUrlHint() {
    const input = document.getElementById("instPortalUrl");
    const hint = document.getElementById("instPortalHint");
    if (!input || !hint) return;

    let host = "";
    try {
        host = new URL(input.value.trim()).hostname;
    } catch (error) {
        hint.textContent = "Enter the address remote computers use to reach this portal, e.g. http://192.168.1.20:8000";
        hint.className = "installer-hint warning";
        return;
    }
    const loopback = host === "localhost" || host.startsWith("127.") || host === "[::1]";
    hint.textContent = loopback
        ? "127.0.0.1 / localhost only works on this computer. Use this server's LAN address so other machines can register."
        : "Machines that run the installer will register with this address.";
    hint.className = "installer-hint" + (loopback ? " warning" : "");
}

function toggleCustomNameField() {
    const select = document.getElementById("instName");
    const row = document.getElementById("instCustomNameRow");
    if (select && row) row.hidden = select.value !== "Custom Name";
}

// base: where the link should point (this browser uses API_BASE; shared links use the portal URL)
function installerDownloadUrl(base) {
    const value = id => {
        const el = document.getElementById(id);
        return el ? el.value.trim() : "";
    };
    const params = new URLSearchParams({
        type: value("instType") || "windows",
        portal_url: value("instPortalUrl"),
        company: value("instCompany"),
        site: value("instSite"),
        department: value("instDept"),
        device_type: value("instDeviceType"),
    });
    if (value("instName") === "Custom Name" && value("instCustomName")) {
        params.set("custom_name", value("instCustomName"));
    }
    return (base || API_BASE).replace(/\/+$/, "") + "/api/download-agent?" + params.toString();
}

function sharedInstallerUrl() {
    const portal = document.getElementById("instPortalUrl");
    return installerDownloadUrl(portal && portal.value.trim() ? portal.value.trim() : API_BASE);
}

function fileNameFromDisposition(header) {
    if (!header) return "";
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
    if (encoded) return decodeURIComponent(encoded[1]);
    const plain = /filename="?([^";]+)"?/i.exec(header);
    return plain ? plain[1] : "";
}

async function generateAndDownloadInstaller() {
    const button = document.getElementById("installerDownloadBtn");
    const label = button ? button.textContent : "";
    if (button) {
        button.disabled = true;
        button.textContent = "BUILDING…";
    }

    try {
        const response = await fetch(installerDownloadUrl(API_BASE));
        if (!response.ok) {
            alert("Could not build the installer:\n" + await readError(response));
            return;
        }
        const blob = await response.blob();
        saveBlob(blob, fileNameFromDisposition(response.headers.get("Content-Disposition")) || "ITPortalAgent");
        closeBuildInstaller();
    } catch (error) {
        console.error("Installer download failed:", error);
        alert(errorMessage(error));
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = label;
        }
    }
}

async function copyInstallerUrl() {
    const url = sharedInstallerUrl();
    try {
        await navigator.clipboard.writeText(url);
        alert("Installer URL copied to clipboard:\n" + url);
    } catch (error) {
        // clipboard API needs https or localhost
        prompt("Copy this installer URL:", url);
    }
}

function sendInstallerLink() {
    const email = prompt("Enter email address to send the installer link:");
    if (!email || !email.trim()) return;

    const subject = "IT Support Portal agent installer";
    const body = "Please download and run the IT Support Portal agent to register your computer:\n\n" + sharedInstallerUrl();
    // Opens a pre-filled draft in the default mail app
    window.location.href = "mailto:" + encodeURIComponent(email.trim()).replace(/%40/g, "@") +
        "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
}

document.addEventListener("DOMContentLoaded", function () {
    const nameSelect = document.getElementById("instName");
    if (nameSelect) nameSelect.addEventListener("change", toggleCustomNameField);
    const portalInput = document.getElementById("instPortalUrl");
    if (portalInput) portalInput.addEventListener("input", updatePortalUrlHint);
});
