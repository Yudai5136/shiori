"use strict";

const STORAGE_KEY = "shiori:data:v1";
const SORT_KEY = "shiori:sort";

// データ構造: { books: [{ id, title, createdAt, entries: [{ page, at }] }] }
// entries は追記のみ。削除する手段は用意しない。
let state = load();
let sortDesc = localStorage.getItem(SORT_KEY) !== "asc";

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data && Array.isArray(data.books)) return data;
  } catch (_) {}
  return { books: [] };
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function lastAt(book) {
  return book.entries.length ? book.entries[book.entries.length - 1].at : book.createdAt;
}

function formatTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---- 描画 ----

const $books = document.getElementById("books");
const $empty = document.getElementById("empty");
const $count = document.getElementById("count");
const $sort = document.getElementById("sort-toggle");

function render() {
  const books = [...state.books].sort((a, b) => {
    const diff = new Date(lastAt(a)) - new Date(lastAt(b));
    return sortDesc ? -diff : diff;
  });

  $empty.hidden = books.length > 0;
  $count.textContent = books.length ? `${books.length} 冊` : "";
  $sort.textContent = sortDesc ? "新しい順 ↓" : "古い順 ↑";
  $books.innerHTML = books.map(renderBook).join("");
}

function renderBook(book) {
  const entries = [...book.entries].reverse(); // 新しい順
  const latest = entries[0];

  const latestHtml = latest
    ? `<span class="page">${latest.page}</span><span class="unit">ページまで</span>
       <time datetime="${latest.at}">${formatTime(latest.at)}</time>`
    : `<span class="none">まだ栞がありません</span>`;

  const historyHtml = entries.length
    ? `<ol class="history">${entries.map((e, i) => {
        const prev = entries[i + 1];
        const diff = prev ? e.page - prev.page : null;
        const diffHtml = diff ? `<span class="diff">(${diff > 0 ? "+" : ""}${diff})</span>` : "";
        return `<li><span class="p">${e.page} ページ${diffHtml}</span><time datetime="${e.at}">${formatTime(e.at)}</time></li>`;
      }).join("")}</ol>`
    : "";

  return `
    <li class="book${latest ? "" : " unread"}" data-id="${book.id}">
      <div class="book-head">
        <h2>${escapeHtml(book.title)}</h2>
        <button type="button" class="rename" title="タイトルを変更">✎</button>
      </div>
      <div class="latest">${latestHtml}</div>
      <form class="add-entry">
        <input type="number" name="page" min="0" step="1" inputmode="numeric" placeholder="何ページまで読んだ？" required>
        <button type="submit">栞をはさむ</button>
      </form>
      ${historyHtml}
    </li>`;
}

// ---- 操作 ----

document.getElementById("add-book").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const input = document.getElementById("book-title");
  const title = input.value.trim();
  if (!title) return;
  state.books.push({ id: uid(), title, createdAt: new Date().toISOString(), entries: [] });
  save();
  input.value = "";
  render();
});

$books.addEventListener("submit", (ev) => {
  if (!ev.target.matches(".add-entry")) return;
  ev.preventDefault();
  const id = ev.target.closest(".book").dataset.id;
  const book = state.books.find((b) => b.id === id);
  const page = parseInt(ev.target.page.value, 10);
  if (!book || Number.isNaN(page) || page < 0) return;
  book.entries.push({ page, at: new Date().toISOString() });
  save();
  render();
});

$books.addEventListener("click", (ev) => {
  if (!ev.target.matches(".rename")) return;
  const id = ev.target.closest(".book").dataset.id;
  const book = state.books.find((b) => b.id === id);
  const title = prompt("新しいタイトル", book.title);
  if (title && title.trim()) {
    book.title = title.trim();
    save();
    render();
  }
});

$sort.addEventListener("click", () => {
  sortDesc = !sortDesc;
  localStorage.setItem(SORT_KEY, sortDesc ? "desc" : "asc");
  render();
});

// ---- バックアップ ----

document.getElementById("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  const d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `shiori-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// 読み込みは「上書き」ではなく「合体」。既存の記録は消えない。
document.getElementById("import").addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.books)) throw new Error("形式が違います");
    let added = 0;
    for (const inc of data.books) {
      let book = state.books.find((b) => b.id === inc.id);
      if (!book) {
        book = { id: inc.id || uid(), title: inc.title, createdAt: inc.createdAt, entries: [] };
        state.books.push(book);
      }
      const seen = new Set(book.entries.map((e) => `${e.at}|${e.page}`));
      for (const e of inc.entries || []) {
        if (!seen.has(`${e.at}|${e.page}`)) {
          book.entries.push({ page: e.page, at: e.at });
          added++;
        }
      }
      book.entries.sort((a, b) => new Date(a.at) - new Date(b.at));
    }
    save();
    render();
    alert(`読み込みました（新しい記録 ${added} 件）`);
  } catch (err) {
    alert("読み込めませんでした: " + err.message);
  }
});

render();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
