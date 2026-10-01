"use strict";

const STORAGE_KEY = "shiori:data:v1";
const SORT_KEY = "shiori:sort";
const WHEEL_ITEM_H = 40; // style.css の .wheel li の高さと合わせる

// データ構造: { books: [{ id, title, createdAt, totalPages?, entries: [{ page, at }] }] }
// entries は追記のみ。削除する手段は用意しない。
let state = load();
let sortDesc = localStorage.getItem(SORT_KEY) !== "asc";
let openId = null; // いま開いている本（一度に一冊だけ）

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

// 全角数字は半角にし、数字以外は取り除く
function digitsOnly(s) {
  return String(s)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\D/g, "");
}

function parsePages(s) {
  const n = parseInt(digitsOnly(s), 10);
  return Number.isNaN(n) ? null : n;
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
  $books.querySelectorAll(".wheel").forEach(initWheel);
}

function renderBook(book) {
  const entries = [...book.entries].reverse(); // 新しい順
  const latest = entries[0];
  const total = book.totalPages;

  const latestHtml = latest
    ? `<span class="page">${latest.page}</span><span class="unit">${total ? `/ ${total} ` : ""}ページまで</span>
       <time datetime="${latest.at}">${formatTime(latest.at)}</time>`
    : `<span class="none">まだ栞がありません</span>`;

  const open = book.id === openId;
  const summaryHtml = `
      <div class="summary" role="button" tabindex="0" aria-expanded="${open}">
        <h2>${escapeHtml(book.title)}</h2>
        <div class="latest">${latestHtml}</div>
      </div>`;

  // 閉じているときはタイトル・ページ数・最後の日時だけ
  if (!open) {
    return `<li class="book${latest ? "" : " unread"}" data-id="${book.id}">${summaryHtml}</li>`;
  }

  const pct = total && latest ? Math.min(100, Math.round((latest.page / total) * 100)) : null;
  const progressHtml = pct !== null
    ? `<div class="progress" aria-label="${pct}%"><div style="width:${pct}%"></div><span>${pct}%</span></div>`
    : "";

  const inputHtml = total
    ? renderWheel(total, Math.min(total, Math.max(1, latest ? latest.page : 1)))
    : `<input type="text" name="page" inputmode="numeric" pattern="[0-9]*" autocomplete="off"
         class="digits" placeholder="何ページまで読んだ？" required>`;

  const totalBtn = total
    ? `全 ${total} ページ（変更）`
    : `全ページ数を設定すると、スクロールで選べます`;

  const historyHtml = entries.length
    ? `<ol class="history">${entries.map((e, i) => {
        const prev = entries[i + 1];
        const diff = prev ? e.page - prev.page : null;
        const diffHtml = diff ? `<span class="diff">(${diff > 0 ? "+" : ""}${diff})</span>` : "";
        return `<li><span class="p">${e.page} ページ${diffHtml}</span><time datetime="${e.at}">${formatTime(e.at)}</time></li>`;
      }).join("")}</ol>`
    : "";

  return `
    <li class="book open${latest ? "" : " unread"}" data-id="${book.id}">
      ${summaryHtml}
      ${progressHtml}
      <form class="add-entry${total ? " with-wheel" : ""}">
        ${inputHtml}
        <button type="submit">栞をはさむ</button>
      </form>
      <div class="actions">
        <button type="button" class="set-total">${totalBtn}</button>
        <button type="button" class="rename">タイトルを変更</button>
      </div>
      ${historyHtml}
    </li>`;
}

// ---- スクロールで選ぶホイール ----

function renderWheel(total, start) {
  let items = "";
  for (let i = 1; i <= total; i++) items += `<li>${i}</li>`;
  return `<div class="wheel" data-start="${start}">
      <ol>${items}</ol>
      <span class="wheel-unit">ページ</span>
    </div>`;
}

function wheelValue(wheel) {
  const list = wheel.querySelector("ol");
  const max = list.children.length;
  return Math.min(max, Math.max(1, Math.round(list.scrollTop / WHEEL_ITEM_H) + 1));
}

function initWheel(wheel) {
  const list = wheel.querySelector("ol");
  let current = null;
  const mark = () => {
    const v = wheelValue(wheel);
    if (v === current) return;
    if (current) list.children[current - 1]?.classList.remove("selected");
    list.children[v - 1].classList.add("selected");
    current = v;
  };
  list.scrollTop = (Number(wheel.dataset.start) - 1) * WHEEL_ITEM_H;
  mark();

  let ticking = false;
  list.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; mark(); });
  }, { passive: true });

  // 数字をタップするとそこまで回す
  list.addEventListener("click", (ev) => {
    const li = ev.target.closest("li");
    if (!li) return;
    const idx = [...list.children].indexOf(li);
    list.scrollTo({ top: idx * WHEEL_ITEM_H, behavior: "smooth" });
  });
}

// ---- 操作 ----

function findBook(el) {
  const id = el.closest(".book").dataset.id;
  return state.books.find((b) => b.id === id);
}

// 数字入力欄は数字以外を入れられないようにする
document.addEventListener("input", (ev) => {
  if (!ev.target.matches("input.digits")) return;
  const cleaned = digitsOnly(ev.target.value);
  if (cleaned !== ev.target.value) ev.target.value = cleaned;
});

document.getElementById("add-book").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const input = document.getElementById("book-title");
  const totalInput = document.getElementById("book-total");
  const title = input.value.trim();
  if (!title) return;
  const book = { id: uid(), title, createdAt: new Date().toISOString(), entries: [] };
  const total = parsePages(totalInput.value);
  if (total) book.totalPages = total;
  state.books.push(book);
  openId = book.id; // 追加した本はすぐ栞をはさめるように開いておく
  save();
  input.value = "";
  totalInput.value = "";
  render();
});

$books.addEventListener("submit", (ev) => {
  if (!ev.target.matches(".add-entry")) return;
  ev.preventDefault();
  const book = findBook(ev.target);
  const wheel = ev.target.querySelector(".wheel");
  const page = wheel ? wheelValue(wheel) : parsePages(ev.target.page.value);
  if (!book || page === null) return;
  book.entries.push({ page, at: new Date().toISOString() });
  save();
  render();
});

function toggleBook(summary) {
  const id = summary.closest(".book").dataset.id;
  openId = openId === id ? null : id;
  render();
  if (openId) {
    $books.querySelector(`.book[data-id="${openId}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

$books.addEventListener("keydown", (ev) => {
  if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches(".summary")) {
    ev.preventDefault();
    toggleBook(ev.target);
  }
});

$books.addEventListener("click", (ev) => {
  const summary = ev.target.closest(".summary");
  if (summary) {
    toggleBook(summary);
  } else if (ev.target.matches(".rename")) {
    const book = findBook(ev.target);
    const title = prompt("新しいタイトル", book.title);
    if (title && title.trim()) {
      book.title = title.trim();
      save();
      render();
    }
  } else if (ev.target.matches(".set-total")) {
    const book = findBook(ev.target);
    const answer = prompt("この本の全ページ数（空にすると解除）", book.totalPages || "");
    if (answer === null) return;
    const total = parsePages(answer);
    if (total) book.totalPages = total;
    else delete book.totalPages;
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
      if (!book.totalPages && inc.totalPages) book.totalPages = inc.totalPages;
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
