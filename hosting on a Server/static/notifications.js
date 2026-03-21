// notifications.js (global popup)

const notif = {
  btn: document.getElementById("notif-btn"),
  badge: document.getElementById("notif-badge"),
  pop: document.getElementById("notif-pop"),
  clear: document.getElementById("notif-clear"),
  list: document.getElementById("notif-list"),
};

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function setBadge(n) {
  if (!notif.badge) return;
  const num = Number(n || 0);
  if (!num) {
    notif.badge.hidden = true;
    notif.badge.textContent = "0";
    return;
  }
  notif.badge.hidden = false;
  notif.badge.textContent = String(num);
}

function titleFor(item) {
  const u = item.from_user;
  const name = u ? escapeHtml(u.username) : "Someone";
  const eventTitle = escapeHtml(item.event_title || item.meta_event_title || "an event");

  if (item.type === "friend_request") {
    return `<strong>${name}</strong> sent you a friend request`;
  }

  if (item.type === "friend_accepted") {
    return `<strong>${name}</strong> accepted your request`;
  }

  if (item.type === "comment") {
    return `<strong>${name}</strong> commented on your post`;
  }

  if (item.type === "event_invite") {
    return `<strong>${name}</strong> invited you to <strong>${eventTitle}</strong>`;
  }

  if (item.type === "event_rsvp_yes") {
    return `<strong>${name}</strong> is going to <strong>${eventTitle}</strong>`;
  }

  if (item.type === "event_rsvp_maybe") {
    return `<strong>${name}</strong> may attend <strong>${eventTitle}</strong>`;
  }

  if (item.type === "event_rsvp_no") {
    return `<strong>${name}</strong> can’t go to <strong>${eventTitle}</strong>`;
  }

  return `Notification`;
}

function viewSpec(item) {
  if (item.type === "friend_request") {
    return { kind: "link", href: "/friends?tab=incoming", label: "View" };
  }

  if (item.type === "comment" && item.post_id) {
    return { kind: "post", post_id: item.post_id, label: "View" };
  }

  if (item.type === "event_invite") {
    if (item.event_id) {
      return { kind: "event", event_id: item.event_id, label: "View" };
    }
    return { kind: "link", href: "/events", label: "View" };
  }

  if (
    item.type === "event_rsvp_yes" ||
    item.type === "event_rsvp_maybe" ||
    item.type === "event_rsvp_no"
  ) {
    if (item.event_id) {
      return { kind: "event", event_id: item.event_id, label: "View" };
    }
    return { kind: "link", href: "/events", label: "View" };
  }

  return null;
}

function itemTemplate(item) {
  const u = item.from_user || {};
  const avatar = escapeHtml(u.avatar || "/static/assets/imgs/avatar_placeholder.png");
  const created = escapeHtml(item.created_at || "");
  const unreadClass = item.is_read ? "" : " notif-unread";
  const view = viewSpec(item);

  const eventId = item.event_id || "";
  const postId = item.post_id || "";

  const viewBtn = view
    ? `<button class="notif-view" type="button" data-action="view" data-id="${item.id}">${escapeHtml(view.label)}</button>`
    : "";

  return `
    <div
      class="notif-item${unreadClass}"
      data-id="${item.id}"
      data-type="${escapeHtml(item.type)}"
      data-post-id="${postId}"
      data-event-id="${eventId}"
    >
      <img class="notif-avatar" src="${avatar}" alt="">
      <div class="notif-text">
        <div class="notif-title">${titleFor(item)}</div>
        <div class="notif-sub">${created}</div>
      </div>
      <div class="notif-actions">
        ${viewBtn}
        <button class="notif-x" type="button" data-action="dismiss" data-id="${item.id}" aria-label="Dismiss">✕</button>
      </div>
    </div>
  `;
}

async function refreshCounts() {
  if (!notif.badge) return;
  try {
    const data = await apiGet("/notifications/counts");
    setBadge(data.total || 0);
  } catch {
    // ignore
  }
}

async function loadList() {
  if (!notif.list) return;

  notif.list.innerHTML = `<div class="empty-state">Loading…</div>`;

  try {
    const data = await apiGet("/notifications/list");
    const items = data.items || [];

    if (items.length === 0) {
      notif.list.innerHTML = `<div class="empty-state">No notifications 🎉</div>`;
      return;
    }

    notif.list.innerHTML = items.map(itemTemplate).join("");
  } catch (err) {
    notif.list.innerHTML = `<div class="empty-state">${escapeHtml(err.message || "Failed to load")}</div>`;
  }
}

function openPop() {
  if (!notif.pop) return;
  notif.pop.hidden = false;
  loadList();
}

function closePop() {
  if (!notif.pop) return;
  notif.pop.hidden = true;
}

function togglePop() {
  if (!notif.pop) return;
  if (notif.pop.hidden) openPop();
  else closePop();
}

function clickOutside(e) {
  if (!notif.pop || !notif.btn) return;
  if (notif.pop.hidden) return;

  if (!notif.pop.contains(e.target) && !notif.btn.contains(e.target)) {
    closePop();
  }
}

function highlightPost(postId) {
  const el = document.getElementById(`post-${postId}`);
  if (!el) return false;

  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.add("post-highlight");
  setTimeout(() => el.classList.remove("post-highlight"), 2600);
  return true;
}

async function handleView(itemEl, notifId) {
  try {
    await apiPost(`/notifications/mark_one_read/${notifId}`, {});
  } catch {}

  await refreshCounts();
  await loadList();

  const type = itemEl?.dataset?.type || "";
  const postId = Number(itemEl?.dataset?.postId || 0);
  const eventId = Number(itemEl?.dataset?.eventId || 0);

  if (type === "friend_request") {
    closePop();
    window.location.href = "/friends?tab=incoming";
    return;
  }

  if (type === "comment" && postId) {
    closePop();

    if (window.location.pathname !== "/") {
      window.location.href = `/?focus_post=${encodeURIComponent(postId)}`;
      return;
    }

    const ok = highlightPost(postId);
    if (!ok) {
      window.location.href = `/?focus_post=${encodeURIComponent(postId)}`;
    }
    return;
  }

  if (
    type === "event_invite" ||
    type === "event_rsvp_yes" ||
    type === "event_rsvp_maybe" ||
    type === "event_rsvp_no"
  ) {
    closePop();

    if (eventId) {
      window.location.href = `/events?open_event=${encodeURIComponent(eventId)}`;
      return;
    }

    window.location.href = "/events";
    return;
  }

  closePop();
}

async function handleDismiss(notifId) {
  await apiPost(`/notifications/dismiss/${notifId}`, {});
  await refreshCounts();
  await loadList();
}

function wire() {
  if (notif.btn) {
    notif.btn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePop();
    });
  }

  document.addEventListener("click", clickOutside);

  if (notif.clear) {
    notif.clear.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await apiPost("/notifications/mark_all_read", {});
        await refreshCounts();
        await loadList();
      } catch {
        // ignore
      }
    });
  }

  if (notif.list) {
    notif.list.addEventListener("click", async (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;

      const action = btn.dataset.action;
      const id = Number(btn.dataset.id || 0);
      if (!id) return;

      const itemEl = btn.closest(".notif-item");

      try {
        if (action === "view") await handleView(itemEl, id);
        if (action === "dismiss") await handleDismiss(id);
      } catch {
        // ignore
      }
    });
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const focusPost = Number(params.get("focus_post") || 0);

    if (focusPost && window.location.pathname === "/") {
      setTimeout(() => {
        highlightPost(focusPost);
        params.delete("focus_post");
        const newUrl = params.toString() ? `/?${params.toString()}` : "/";
        history.replaceState(null, "", newUrl);
      }, 250);
    }
  } catch {}
}

wire();
refreshCounts();
setInterval(refreshCounts, 12000);