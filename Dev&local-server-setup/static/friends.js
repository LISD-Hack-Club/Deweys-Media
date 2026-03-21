// friends.js (page-only JS)

const els = {
  search: document.getElementById("friends-search"),
  refresh: document.getElementById("friends-refresh"),
  tabs: Array.from(document.querySelectorAll(".friends-tab")),
  panels: Array.from(document.querySelectorAll(".friends-panel")),
  toast: document.getElementById("friends-toast"),

  listSuggestions: document.getElementById("list-suggestions"),
  listIncoming: document.getElementById("list-incoming"),
  listOutgoing: document.getElementById("list-outgoing"),
  listFriends: document.getElementById("list-friends"),

  cSug: document.getElementById("count-suggestions"),
  cIn: document.getElementById("count-incoming"),
  cOut: document.getElementById("count-outgoing"),
  cFr: document.getElementById("count-friends"),
};

let state = {
  suggestions: [],
  incoming: [],
  outgoing: [],
  friends: [],
  q: "",
};

function toast(msg) {
  if (!els.toast) return;
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (els.toast.hidden = true), 2200);
}

function setTab(tabName) {
  els.tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === tabName));
  els.panels.forEach((p) => {
    const on = p.dataset.panel === tabName;
    p.hidden = !on;
  });

  try {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tabName);
    history.replaceState(null, "", url.toString());
  } catch {}
}

function initFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  const validTabs = ["suggestions", "incoming", "outgoing", "friends"];

  if (tab && validTabs.includes(tab)) setTab(tab);
  else setTab("suggestions");
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function rowTemplate(user, actionsHtml, subText) {
  return `
    <div class="user-row" data-user-id="${user.id}">
      <div class="user-left">
        <img class="user-avatar" src="${escapeHtml(user.avatar)}" alt="">
        <div class="user-meta">
          <div class="user-name">${escapeHtml(user.username)}</div>
          <div class="user-sub">${escapeHtml(subText || "")}</div>
        </div>
      </div>
      <div class="user-actions">
        ${actionsHtml}
      </div>
    </div>
  `;
}

function emptyTemplate(text) {
  return `<div class="empty-state">${escapeHtml(text)}</div>`;
}

function applyFilter(list) {
  const q = (state.q || "").trim().toLowerCase();
  if (!q) return list;
  return list.filter((x) => (x.username || "").toLowerCase().includes(q));
}

function render() {
  const sug = applyFilter(state.suggestions);
  const inc = applyFilter(state.incoming);
  const out = applyFilter(state.outgoing);
  const fr = applyFilter(state.friends);

  els.cSug.textContent = String(state.suggestions.length);
  els.cIn.textContent = String(state.incoming.length);
  els.cOut.textContent = String(state.outgoing.length);
  els.cFr.textContent = String(state.friends.length);

  if (sug.length === 0) {
    els.listSuggestions.innerHTML = emptyTemplate("No suggestions right now.");
  } else {
    els.listSuggestions.innerHTML = sug
      .map((u) =>
        rowTemplate(
          u,
          `<button class="mini-btn primary" data-action="send">Add Friend</button>`,
          "Tap to send a request"
        )
      )
      .join("");
  }

  if (inc.length === 0) {
    els.listIncoming.innerHTML = emptyTemplate("No requests yet.");
  } else {
    els.listIncoming.innerHTML = inc
      .map((r) =>
        rowTemplate(
          r.user,
          `
            <button class="mini-btn primary" data-action="accept" data-req-id="${r.id}">Accept</button>
            <button class="mini-btn danger" data-action="decline" data-req-id="${r.id}">Decline</button>
          `,
          "Sent you a request"
        )
      )
      .join("");
  }

  if (out.length === 0) {
    els.listOutgoing.innerHTML = emptyTemplate("You haven’t sent any requests.");
  } else {
    els.listOutgoing.innerHTML = out
      .map((r) =>
        rowTemplate(
          r.user,
          `<button class="mini-btn danger" data-action="cancel" data-req-id="${r.id}">Cancel</button>`,
          "Pending"
        )
      )
      .join("");
  }

  if (fr.length === 0) {
    els.listFriends.innerHTML = emptyTemplate("No friends yet — add some people!");
  } else {
    els.listFriends.innerHTML = fr
      .map((u) => {
        const mutual = Number(u.mutual_count || 0);
        const since = u.friends_since ? `Friends since ${u.friends_since}` : "";
        const mutualText = mutual > 0 ? `${mutual} mutual friend${mutual === 1 ? "" : "s"}` : "";
        const sub = [mutualText, since].filter(Boolean).join(" • ") || "Friend";

        return rowTemplate(
          u,
          `
            <button class="mini-btn" data-action="message">Message</button>
            <button class="mini-btn danger" data-action="unfriend">Remove</button>
          `,
          sub
        );
      })
      .join("");
  }
}

async function apiGet(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function refresh() {
  const data = await apiGet("/friends/data");
  state.suggestions = data.suggestions || [];
  state.incoming = data.incoming || [];
  state.outgoing = data.outgoing || [];
  state.friends = data.friends || [];
  render();
}

function onClickList(e) {
  const btn = e.target.closest("button");
  if (!btn) return;

  const row = e.target.closest(".user-row");
  const action = btn.dataset.action;
  const userId = row ? Number(row.dataset.userId) : null;
  const reqId = btn.dataset.reqId ? Number(btn.dataset.reqId) : null;

  (async () => {
    try {
      if (action === "send" && userId) {
        await apiPost(`/friend_request/send/${userId}`);
        toast("Request sent ✅");
        await refresh();
        setTab("outgoing");
      }

      if ((action === "accept" || action === "decline") && reqId) {
        await apiPost(`/friend_request/respond/${reqId}`, { action });
        toast(action === "accept" ? "Accepted ✅" : "Declined ✅");
        await refresh();
        setTab("friends");
      }

      if (action === "cancel" && reqId) {
        await apiPost(`/friend_request/cancel/${reqId}`, {});
        toast("Request canceled ✅");
        await refresh();
      }

      if (action === "unfriend" && userId) {
        if (!confirm("Remove this friend?")) return;
        await apiPost(`/friend_request/unfriend/${userId}`, {});
        toast("Friend removed ✅");
        await refresh();
      }

      if (action === "message" && userId) {
        window.location.href = `/messages?user=${userId}`;
      }
    } catch (err) {
      toast(err.message || "Something went wrong");
    }
  })();
}

function wire() {
  els.tabs.forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));

  els.search.addEventListener("input", () => {
    state.q = els.search.value || "";
    render();
  });

  els.refresh.addEventListener("click", () => refresh().catch((err) => toast(err.message)));

  els.listSuggestions.addEventListener("click", onClickList);
  els.listIncoming.addEventListener("click", onClickList);
  els.listOutgoing.addEventListener("click", onClickList);
  els.listFriends.addEventListener("click", onClickList);
}

wire();
initFromUrl();
refresh().catch((err) => toast(err.message));