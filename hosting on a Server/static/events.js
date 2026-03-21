// static/events.js

// ---------------- DOM ----------------
const calGrid = document.getElementById("calGrid");
const calYear = document.getElementById("calYear");
const calMonth = document.getElementById("calMonth");
const monthBanner = document.getElementById("monthBanner");

const prevBtn = document.getElementById("prevMonth");
const nextBtn = document.getElementById("nextMonth");

const createEventBtn = document.getElementById("createEventBtn");
const allMyEventsBtn = document.getElementById("allMyEventsBtn");
const discoverBtn = document.getElementById("discoverBtn");

const createModal = document.getElementById("createEventModal");
const closeCreateBtn = document.getElementById("closeCreateEvent");
const cancelCreateBtn = document.getElementById("cancelCreateEvent");
const createForm = document.getElementById("createEventForm");

const bottomEventView = document.getElementById("eventView");

const inviteFriendsModal = document.getElementById("inviteFriendsModal");
const closeInviteFriends = document.getElementById("closeInviteFriends");
const inviteFriendsList = document.getElementById("inviteFriendsList");
const inviteSearch = document.getElementById("inviteSearch");

const allMyEventsModal = document.getElementById("allMyEventsModal");
const closeAllMyEvents = document.getElementById("closeAllMyEvents");
const allEventsTabs = document.getElementById("allEventsTabs");
const allEventsGrid = document.getElementById("allEventsGrid");

const discoverEventsModal = document.getElementById("discoverEventsModal");
const closeDiscoverEvents = document.getElementById("closeDiscoverEvents");
const discoverEventsGrid = document.getElementById("discoverEventsGrid");

// ---------------- Month Names + Banners ----------------
const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const monthBanners = {
  0: "/static/assets/monthbanners/january.png",
  1: "/static/assets/monthbanners/february.png",
  2: "/static/assets/monthbanners/march.png",
  3: "/static/assets/monthbanners/april.png",
  4: "/static/assets/monthbanners/may.png",
  5: "/static/assets/monthbanners/june.png",
  6: "/static/assets/monthbanners/july.png",
  7: "/static/assets/monthbanners/august.png",
  8: "/static/assets/monthbanners/september.png",
  9: "/static/assets/monthbanners/october.png",
  10: "/static/assets/monthbanners/november.png",
  11: "/static/assets/monthbanners/december.png"
};

// ---------------- State ----------------
let events = [];
let current = new Date();
current.setDate(1);

let activeEvent = null;
let inviteFriendsCache = [];
let myEventsData = { hosting: [], invited: [], going: [] };

let activeAllEventsBucket = "hosted";
let activeAllEventsCategory = "all";

// ---------------- Helpers ----------------
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function ymd(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getEventsForDay(dateStr) {
  return events.filter((e) => e.date === dateStr);
}

function visLabel(v) {
  v = (v || "public").toLowerCase();
  if (v === "friends") return "Friends only";
  if (v === "private") return "Private";
  return "Public";
}

function cap(s) {
  s = (s || "").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function themeKey(t) {
  t = (t || "").trim().toLowerCase();
  const allowed = new Set(["birthday", "wedding", "prom", "concert", "church"]);
  return allowed.has(t) ? t : "";
}

function timePretty(t) {
  return (t || "").trim();
}

function rsvpLabel(val) {
  const v = String(val || "").toLowerCase();
  if (v === "yes") return "Going";
  if (v === "no") return "Can’t go";
  return "Maybe";
}

function closeAllMenus() {
  document.querySelectorAll(".menu-pop").forEach((p) => p.remove());
}

function lockBodyScroll() {
  document.body.style.overflow = "hidden";
}

function unlockBodyScroll() {
  document.body.style.overflow = "";
}

function anyModalOpen() {
  const eventModal = document.getElementById("eventPopupModal");
  const createOpen = createModal && !createModal.hidden;
  const eventOpen = eventModal && !eventModal.hidden;
  const inviteOpen = inviteFriendsModal && !inviteFriendsModal.hidden;
  const allMineOpen = allMyEventsModal && !allMyEventsModal.hidden;
  const discoverOpen = discoverEventsModal && !discoverEventsModal.hidden;
  return !!(createOpen || eventOpen || inviteOpen || allMineOpen || discoverOpen);
}

// ---------------- Create Event Modal ----------------
function openCreateModal() {
  if (!createModal) return;
  createModal.hidden = false;
  lockBodyScroll();
}

function closeCreateModal() {
  if (!createModal) return;
  createModal.hidden = true;
  if (!anyModalOpen()) unlockBodyScroll();
}

// ---------------- Invite Friends Modal ----------------
function openInviteFriendsModal() {
  if (!inviteFriendsModal || !activeEvent) return;
  inviteFriendsModal.hidden = false;
  lockBodyScroll();

  if (inviteSearch) inviteSearch.value = "";
  loadInviteFriends(activeEvent.id);
}

function closeInviteFriendsModal() {
  if (!inviteFriendsModal) return;
  inviteFriendsModal.hidden = true;
  if (!anyModalOpen()) unlockBodyScroll();
}

function renderInviteFriends(list) {
  if (!inviteFriendsList) return;

  if (!list || !list.length) {
    inviteFriendsList.innerHTML = `<div class="invite-empty">No friends found.</div>`;
    return;
  }

  inviteFriendsList.innerHTML = list.map((friend) => {
    const invited = !!friend.invited;
    const canInvite = !!friend.can_invite;
    const avatar = friend.avatar || "/static/assets/imgs/avatar_placeholder.png";

    let buttonHtml = "";
    if (invited) {
      buttonHtml = `<button class="invite-btn2 sent" type="button" disabled>Invited</button>`;
    } else if (!canInvite) {
      buttonHtml = `<button class="invite-btn2 disabled" type="button" disabled>Can't Invite</button>`;
    } else {
      buttonHtml = `<button class="invite-btn2 primary send-invite-btn" type="button" data-user-id="${friend.id}">Invite</button>`;
    }

    return `
      <div class="invite-row">
        <div class="invite-left">
          <img class="invite-avatar" src="${escapeHtml(avatar)}" alt="">
          <div class="invite-meta">
            <div class="invite-name">${escapeHtml(friend.username || "Unknown User")}</div>
            <div class="invite-sub">${escapeHtml(friend.name || "Friend")}</div>
          </div>
        </div>

        <div class="invite-actions">
          ${buttonHtml}
        </div>
      </div>
    `;
  }).join("");
}

async function loadInviteFriends(eventId) {
  if (!inviteFriendsList || !eventId) return;

  inviteFriendsList.innerHTML = `<div class="invite-empty">Loading friends...</div>`;

  try {
    const res = await fetch(`/api/events/${eventId}/invite-friends`);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || "Failed to load friends");
    }

    inviteFriendsCache = Array.isArray(data.friends) ? data.friends : [];
    renderInviteFriends(inviteFriendsCache);
  } catch (err) {
    inviteFriendsList.innerHTML = `<div class="invite-empty">${escapeHtml(err.message || "Could not load friends.")}</div>`;
  }
}

// ---------------- Guest List ----------------
function renderGuestList(list) {
  const guestList = document.getElementById("guestList");
  const guestListCount = document.getElementById("guestListCount");

  if (!guestList || !guestListCount) return;

  const guests = Array.isArray(list) ? list : [];
  guestListCount.textContent = String(guests.length);

  if (!guests.length) {
    guestList.innerHTML = `<div class="empty-updates">No invited guests yet.</div>`;
    return;
  }

  guestList.innerHTML = guests.map((guest) => {
    const avatar = guest.avatar || "/static/assets/imgs/avatar_placeholder.png";
    const rsvp = String(guest.rsvp || "maybe").toLowerCase();
    const sub = guest.invite_status === "host" ? "Host" : "Invited";

    return `
      <div class="guest-row">
        <div class="guest-left">
          <img class="guest-avatar" src="${escapeHtml(avatar)}" alt="">
          <div class="guest-meta">
            <div class="guest-name">${escapeHtml(guest.username || "Unknown User")}</div>
            <div class="guest-sub">${escapeHtml(sub)}</div>
          </div>
        </div>

        <div class="guest-rsvp ${escapeHtml(rsvp)}">${escapeHtml(rsvpLabel(rsvp))}</div>
      </div>
    `;
  }).join("");
}

async function loadGuestList(eventId) {
  const guestList = document.getElementById("guestList");
  const guestListCount = document.getElementById("guestListCount");

  if (guestList) guestList.innerHTML = `<div class="empty-updates">Loading guests…</div>`;
  if (guestListCount) guestListCount.textContent = "…";

  try {
    const res = await fetch(`/api/events/${eventId}/guests`);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || "Failed to load guests");
    }

    renderGuestList(data.guests || []);
  } catch (err) {
    if (guestList) {
      guestList.innerHTML = `<div class="empty-updates">${escapeHtml(err.message || "Failed to load guests.")}</div>`;
    }
    if (guestListCount) {
      guestListCount.textContent = "0";
    }
  }
}

// ---------------- All My Events ----------------
function openAllMyEventsModal() {
  if (!allMyEventsModal) return;
  allMyEventsModal.hidden = false;
  lockBodyScroll();
  loadMyEvents();
}

function closeAllMyEventsModal() {
  if (!allMyEventsModal) return;
  allMyEventsModal.hidden = true;
  if (!anyModalOpen()) unlockBodyScroll();
}

function getEventsBucket(bucket) {
  if (bucket === "invited") {
    return Array.isArray(myEventsData.invited) ? myEventsData.invited : [];
  }

  if (bucket === "going") {
    return Array.isArray(myEventsData.going) ? myEventsData.going : [];
  }

  return Array.isArray(myEventsData.hosting) ? myEventsData.hosting : [];
}

function getFilteredMyEvents() {
  const list = getEventsBucket(activeAllEventsBucket);

  if (activeAllEventsCategory === "all") {
    return list;
  }

  if (activeAllEventsCategory === "other") {
    return list.filter((e) => {
      const rawTheme = String(e.theme || "").trim().toLowerCase();
      return !["birthday", "wedding", "prom", "concert", "church"].includes(rawTheme);
    });
  }

  return list.filter((e) => {
    const rawTheme = String(e.theme || "").trim().toLowerCase();
    return rawTheme === activeAllEventsCategory;
  });
}

function renderAllMyEventsTabs() {
  if (!allMyEventsModal) return;

  allMyEventsModal.querySelectorAll("[data-bucket]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.bucket === activeAllEventsBucket);
  });

  allMyEventsModal.querySelectorAll("[data-category]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.category === activeAllEventsCategory);
  });
}

function renderAllMyEventsGrid() {
  if (!allEventsGrid) return;

  const list = getFilteredMyEvents();

  if (!list.length) {
    let emptyText = "No events in this section yet.";

    if (activeAllEventsBucket === "hosted") emptyText = "You have not hosted any events here yet.";
    if (activeAllEventsBucket === "invited") emptyText = "You do not have any invited events here yet.";
    if (activeAllEventsBucket === "going") emptyText = "You do not have any RSVP'd events here yet.";

    allEventsGrid.innerHTML = `<div class="empty-updates">${escapeHtml(emptyText)}</div>`;
    return;
  }

  allEventsGrid.innerHTML = list.map((e) => {
    const bannerHtml = e.banner_image
      ? `<img class="all-event-banner" src="${escapeHtml(e.banner_image)}" alt="">`
      : "";

    const theme = themeKey(e.theme);
    const themeLabel = theme ? cap(theme) : "Other";

    let bucketLabel = "Hosted";
    if (activeAllEventsBucket === "invited") bucketLabel = "Invited";
    if (activeAllEventsBucket === "going") bucketLabel = "Going";

    let rsvpTag = "";
    if (e.rsvp && !e.is_host) {
      rsvpTag = `<div class="all-event-tag">${escapeHtml(rsvpLabel(e.rsvp))}</div>`;
    }

    return `
      <div class="all-event-card" data-event-id="${escapeHtml(e.id)}" data-bucket="${escapeHtml(activeAllEventsBucket)}">
        ${bannerHtml}
        <div class="all-event-content">
          <div class="all-event-title">${escapeHtml(e.title || "Event")}</div>

          <div class="all-event-meta">
            <div class="all-event-line"><span>Host:</span>${escapeHtml(e.host_name || "—")}</div>
            <div class="all-event-line"><span>Location:</span>${escapeHtml((e.location || "").trim() || "—")}</div>
            <div class="all-event-line"><span>Date:</span>${escapeHtml(e.date || "—")}</div>
            <div class="all-event-line"><span>Start:</span>${escapeHtml(timePretty(e.start_time || e.time || "") || "—")}</div>
          </div>

          <div class="all-event-tags">
            <div class="all-event-tag">${escapeHtml(bucketLabel)}</div>
            <div class="all-event-tag">${escapeHtml(themeLabel)}</div>
            <div class="all-event-tag">${escapeHtml(visLabel(e.visibility))}</div>
            ${rsvpTag}
          </div>
        </div>
      </div>
    `;
  }).join("");

  allEventsGrid.querySelectorAll(".all-event-card").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.dataset.eventId;
      const bucket = card.dataset.bucket || "hosted";
      const listForBucket = getEventsBucket(bucket);
      const found = listForBucket.find((e) => String(e.id) === String(id));
      if (!found) return;

      closeAllMyEventsModal();
      openEventPopup(found);
    });
  });
}

async function loadMyEvents() {
  if (!allEventsGrid) return;

  allEventsGrid.innerHTML = `<div class="empty-updates">Loading events…</div>`;

  try {
    const res = await fetch("/api/events/mine");
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || "Failed to load your events");
    }

    myEventsData = {
      hosting: Array.isArray(data.hosting) ? data.hosting : [],
      invited: Array.isArray(data.invited) ? data.invited : [],
      going: Array.isArray(data.going) ? data.going : []
    };

    renderAllMyEventsTabs();
    renderAllMyEventsGrid();
  } catch (err) {
    allEventsGrid.innerHTML = `<div class="empty-updates">${escapeHtml(err.message || "Failed to load your events.")}</div>`;
  }
}

// ---------------- Discover Events ----------------
function openDiscoverEventsModal() {
  if (!discoverEventsModal) return;
  discoverEventsModal.hidden = false;
  lockBodyScroll();
  loadDiscoverEvents();
}

function closeDiscoverEventsModal() {
  if (!discoverEventsModal) return;
  discoverEventsModal.hidden = true;
  if (!anyModalOpen()) unlockBodyScroll();
}

async function loadDiscoverEvents() {
  if (!discoverEventsGrid) return;

  discoverEventsGrid.innerHTML = `<div class="empty-updates">Loading events…</div>`;

  try {
    const res = await fetch("/api/events/discover");
    const data = await res.json().catch(() => ([]));

    if (!res.ok) {
      throw new Error(data.error || "Failed to load discover events");
    }

    const list = Array.isArray(data) ? data : [];

    if (!list.length) {
      discoverEventsGrid.innerHTML = `<div class="empty-updates">No public events to discover right now.</div>`;
      return;
    }

    discoverEventsGrid.innerHTML = list.map((e) => {
      const bannerHtml = e.banner_image
        ? `<img class="all-event-banner" src="${escapeHtml(e.banner_image)}" alt="">`
        : "";

      const theme = themeKey(e.theme);
      const themeLabel = theme ? cap(theme) : "Other";

      return `
        <div class="all-event-card" data-event-id="${escapeHtml(e.id)}">
          ${bannerHtml}
          <div class="all-event-content">
            <div class="all-event-title">${escapeHtml(e.title || "Event")}</div>

            <div class="all-event-meta">
              <div class="all-event-line"><span>Host:</span>${escapeHtml(e.host_name || "—")}</div>
              <div class="all-event-line"><span>Location:</span>${escapeHtml((e.location || "").trim() || "—")}</div>
              <div class="all-event-line"><span>Date:</span>${escapeHtml(e.date || "—")}</div>
              <div class="all-event-line"><span>Start:</span>${escapeHtml(timePretty(e.start_time || e.time || "") || "—")}</div>
            </div>

            <div class="all-event-tags">
              <div class="all-event-tag">${escapeHtml(themeLabel)}</div>
              <div class="all-event-tag">${escapeHtml(visLabel(e.visibility))}</div>
            </div>
          </div>
        </div>
      `;
    }).join("");

    discoverEventsGrid.querySelectorAll(".all-event-card").forEach((card) => {
      card.addEventListener("click", () => {
        const id = card.dataset.eventId;
        const found = list.find((e) => String(e.id) === String(id));
        if (!found) return;

        closeDiscoverEventsModal();
        openEventPopup(found);
      });
    });
  } catch (err) {
    discoverEventsGrid.innerHTML = `<div class="empty-updates">${escapeHtml(err.message || "Failed to load discover events.")}</div>`;
  }
}

// ---------------- Popup modal for viewing event ----------------
function ensureEventPopup() {
  const wrap = document.getElementById("eventPopupModal");
  if (!wrap) return null;

  if (wrap.dataset.bound === "1") return wrap;
  wrap.dataset.bound = "1";

  wrap.querySelector("#closeEventPopup")?.addEventListener("click", () => {
    wrap.hidden = true;
    activeEvent = null;
    closeAllMenus();
    if (!anyModalOpen()) unlockBodyScroll();
  });

  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) {
      wrap.hidden = true;
      activeEvent = null;
      closeAllMenus();
      if (!anyModalOpen()) unlockBodyScroll();
    }
  });

  wrap.querySelector(".frog-modal-card")?.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menu")) closeAllMenus();
  });

  wrap.querySelector("#inviteBtn")?.addEventListener("click", () => {
    if (!activeEvent) return;
    openInviteFriendsModal();
  });

  wrap.querySelector("#rsvpSelect")?.addEventListener("change", async (ev) => {
    if (!activeEvent) return;
    const val = ev.target.value;

    const res = await fetch(`/api/events/${activeEvent.id}/rsvp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rsvp: val })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || "RSVP failed");
      return;
    }

    const idx = events.findIndex((x) => String(x.id) === String(activeEvent.id));
    if (idx >= 0) events[idx].rsvp = data.rsvp;
    activeEvent.rsvp = data.rsvp;

    await loadEvents();
    await loadGuestList(activeEvent.id);
    await loadMyEvents();
  });

  const photoInput = wrap.querySelector("#updatePhoto");
  const preview = wrap.querySelector("#photoPreview");
  const previewImg = wrap.querySelector("#photoPreviewImg");

  photoInput?.addEventListener("change", () => {
    const f = photoInput.files?.[0];
    if (!f) {
      if (preview) preview.style.display = "none";
      if (previewImg) previewImg.src = "";
      return;
    }

    const url = URL.createObjectURL(f);
    if (previewImg) previewImg.src = url;
    if (preview) preview.style.display = "block";
  });

  wrap.querySelector("#removePreview")?.addEventListener("click", () => {
    if (photoInput) photoInput.value = "";
    if (preview) preview.style.display = "none";
    if (previewImg) previewImg.src = "";
  });

  wrap.querySelector("#postUpdateBtn")?.addEventListener("click", async () => {
    if (!activeEvent) return;

    const msg = wrap.querySelector("#hostMsg");
    if (msg) msg.textContent = "";

    const text = (wrap.querySelector("#updateText")?.value || "").trim();
    const photo = wrap.querySelector("#updatePhoto")?.files?.[0];

    if (!text && !photo) {
      if (msg) msg.textContent = "Type something or add a photo.";
      return;
    }

    const fd = new FormData();
    fd.append("text", text);
    if (photo) fd.append("photo", photo);

    const res = await fetch(`/api/events/${activeEvent.id}/updates/create`, {
      method: "POST",
      body: fd
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (msg) msg.textContent = data.error || "Failed to post.";
      return;
    }

    const updateText = wrap.querySelector("#updateText");
    const updatePhoto = wrap.querySelector("#updatePhoto");
    const photoPreview = wrap.querySelector("#photoPreview");
    const photoPreviewImg = wrap.querySelector("#photoPreviewImg");

    if (updateText) updateText.value = "";
    if (updatePhoto) updatePhoto.value = "";
    if (photoPreview) photoPreview.style.display = "none";
    if (photoPreviewImg) photoPreviewImg.src = "";

    await loadAndRenderUpdates(activeEvent.id);
  });

  return wrap;
}

function applyThemeClass(cardEl, theme) {
  const all = ["birthday", "wedding", "prom", "concert", "church"];
  all.forEach((t) => cardEl.classList.remove(`theme-${t}`));
  if (theme) cardEl.classList.add(`theme-${theme}`);
}

function renderBadges(e) {
  const badges = document.getElementById("eventBadges");
  if (!badges) return;

  badges.innerHTML = "";

  const b1 = document.createElement("div");
  b1.className = "badge";
  b1.textContent = visLabel(e.visibility);
  badges.appendChild(b1);

  const t = themeKey(e.theme);
  const b2 = document.createElement("div");
  b2.className = `badge badge-theme ${t ? "t-" + t : ""}`;
  b2.textContent = t ? cap(t) : "No theme";
  badges.appendChild(b2);

  if (e.host_name) {
    const b3 = document.createElement("div");
    b3.className = "badge";
    b3.textContent = `Host: ${e.host_name}`;
    badges.appendChild(b3);
  }
}

async function loadAndRenderUpdates(eventId) {
  const modal = ensureEventPopup();
  if (!modal) return;

  const list = modal.querySelector("#updatesList");
  if (!list) return;

  list.innerHTML = `<div class="empty-updates">Loading…</div>`;

  const res = await fetch(`/api/events/${eventId}/updates`);
  const data = await res.json().catch(() => ([]));

  if (!res.ok) {
    list.innerHTML = `<div class="empty-updates">Failed to load updates.</div>`;
    return;
  }

  if (!Array.isArray(data) || data.length === 0) {
    list.innerHTML = `<div class="empty-updates">No updates yet.</div>`;
    return;
  }

  list.innerHTML = "";

  data.forEach((u) => {
    const card = document.createElement("div");
    card.className = "update-card";

    const photoHtml = u.photo_url
      ? `<img class="update-photo" src="${escapeHtml(u.photo_url)}" alt="">`
      : "";

    const menuHtml = u.can_edit
      ? `
      <div class="menu">
        <button class="dots-btn" type="button">•••</button>
      </div>
    `
      : "";

    card.innerHTML = `
      <div class="update-top">
        <div class="update-meta">
          <div class="update-author">${escapeHtml(u.author || "Host")}</div>
          <div class="update-time">${escapeHtml(u.created_at || "")}</div>
        </div>
        ${menuHtml}
      </div>

      <div class="update-text">${escapeHtml(u.text || "")}</div>
      ${photoHtml}
    `;

    if (u.can_edit) {
      const dots = card.querySelector(".dots-btn");
      dots.addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeAllMenus();

        const pop = document.createElement("div");
        pop.className = "menu-pop";
        pop.innerHTML = `
          <button type="button" data-act="edit">Edit</button>
          <button type="button" data-act="delete">Delete</button>
        `;

        card.querySelector(".menu").appendChild(pop);

        pop.addEventListener("click", async (e2) => {
          const btn = e2.target.closest("button[data-act]");
          if (!btn) return;

          const act = btn.dataset.act;

          if (act === "delete") {
            if (!confirm("Delete this update?")) return;

            const r = await fetch(`/api/events/${activeEvent.id}/updates/${u.id}/delete`, {
              method: "POST"
            });
            const d = await r.json().catch(() => ({}));

            if (!r.ok) {
              alert(d.error || "Delete failed");
              return;
            }

            await loadAndRenderUpdates(activeEvent.id);
          }

          if (act === "edit") {
            const newText = prompt("Edit update text:", u.text || "");
            if (newText == null) return;

            const r = await fetch(`/api/events/${activeEvent.id}/updates/${u.id}/edit`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text: newText })
            });
            const d = await r.json().catch(() => ({}));

            if (!r.ok) {
              alert(d.error || "Edit failed");
              return;
            }

            await loadAndRenderUpdates(activeEvent.id);
          }

          closeAllMenus();
        });
      });
    }

    list.appendChild(card);
  });
}

function openEventPopup(e) {
  activeEvent = e;

  const modal = ensureEventPopup();
  if (!modal) return;

  const card = modal.querySelector("#eventPopupCard");
  const title = modal.querySelector("#eventPopTitle");
  const dateLine = modal.querySelector("#eventPopDateLine");

  const bannerWrap = modal.querySelector("#eventPopBanner");
  const bannerImg = modal.querySelector("#eventPopBannerImg");

  const kvLoc = modal.querySelector("#kvLoc");
  const kvDate = modal.querySelector("#kvDate");
  const kvStart = modal.querySelector("#kvStart");
  const kvEnd = modal.querySelector("#kvEnd");

  const desc = modal.querySelector("#eventPopDesc");

  const inviteBtn = modal.querySelector("#inviteBtn");
  const rsvpWrap = modal.querySelector("#rsvpWrap");
  const rsvpSelect = modal.querySelector("#rsvpSelect");
  const hostComposer = modal.querySelector("#hostComposer");

  if (title) title.textContent = e.title || "Event";
  if (dateLine) dateLine.textContent = e.date ? e.date : "";

  const t = themeKey(e.theme);
  if (card) applyThemeClass(card, t);

  if (bannerWrap && bannerImg) {
    if (e.banner_image) {
      bannerImg.src = e.banner_image;
      bannerWrap.style.display = "block";
    } else {
      bannerWrap.style.display = "none";
      bannerImg.src = "";
    }
  }

  renderBadges(e);

  if (kvLoc) kvLoc.textContent = (e.location || "").trim() || "—";
  if (kvDate) kvDate.textContent = e.date || "—";
  if (kvStart) kvStart.textContent = timePretty(e.start_time || e.time || "") || "—";
  if (kvEnd) kvEnd.textContent = timePretty(e.end_time || "") || "—";

  if (desc) desc.textContent = e.description || "No description.";

  const isHost = !!e.is_host;
  const isInvited = !!e.is_invited;

  const canInvite =
    isHost ||
    String(e.visibility).toLowerCase() === "public" ||
    isInvited;

  if (inviteBtn) inviteBtn.style.display = canInvite ? "inline-flex" : "none";

  if (rsvpWrap && rsvpSelect) {
    if (isInvited && !isHost) {
      rsvpWrap.style.display = "flex";
      const val = (e.rsvp || "maybe").toLowerCase();
      rsvpSelect.value = ["yes", "no", "maybe"].includes(val) ? val : "maybe";
    } else {
      rsvpWrap.style.display = "none";
    }
  }

  if (hostComposer) hostComposer.style.display = isHost ? "block" : "none";

  modal.hidden = false;
  lockBodyScroll();
  closeAllMenus();

  loadAndRenderUpdates(e.id);
  loadGuestList(e.id);
}

// ---------------- Load Events ----------------
async function loadEvents() {
  const res = await fetch("/api/events");
  events = await res.json().catch(() => ([]));
  renderCalendar();
}

// ---------------- Calendar ----------------
function renderCalendar() {
  if (!calGrid || !calYear || !calMonth || !monthBanner) return;

  calGrid.innerHTML = "";

  const year = current.getFullYear();
  const month = current.getMonth();

  calYear.textContent = year;
  calMonth.textContent = monthNames[month];

  const bannerSrc = monthBanners[month] || "";
  monthBanner.src = bannerSrc;
  monthBanner.style.display = bannerSrc ? "block" : "none";

  const firstDay = new Date(year, month, 1);
  const startDow = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const totalCells = startDow + daysInMonth;
  const rows = Math.ceil(totalCells / 7);
  const cellsToRender = rows * 7;

  for (let i = 0; i < cellsToRender; i++) {
    const cell = document.createElement("div");
    cell.className = "day";

    const dayNum = i - startDow + 1;

    if (dayNum < 1 || dayNum > daysInMonth) {
      cell.classList.add("muted");
      cell.innerHTML = `<div class="day-num"></div>`;
      calGrid.appendChild(cell);
      continue;
    }

    const thisDate = new Date(year, month, dayNum);
    const dateStr = ymd(thisDate);
    const dayEvents = getEventsForDay(dateStr);

    cell.innerHTML = `
      <div class="day-num">${dayNum}</div>
      <div class="events-mini">
        ${
          dayEvents
            .slice(0, 2)
            .map(
              (ev) => `
            <div class="mini-event" data-id="${ev.id}">
              ${escapeHtml(ev.title)}
            </div>
          `
            )
            .join("")
        }
        ${dayEvents.length > 2 ? `<div class="mini-event">+${dayEvents.length - 2} more</div>` : ""}
      </div>
    `;

    cell.addEventListener("click", (ev) => {
      const mini = ev.target.closest(".mini-event");

      if (mini && mini.dataset.id) {
        const found = events.find((x) => String(x.id) === String(mini.dataset.id));
        if (found) openEventPopup(found);
        return;
      }

      if (dayEvents.length > 0) {
        openEventPopup(dayEvents[0]);
      }
    });

    calGrid.appendChild(cell);
  }

  if (bottomEventView) bottomEventView.hidden = true;
}

// ---------------- Month nav ----------------
if (prevBtn) {
  prevBtn.addEventListener("click", () => {
    current.setMonth(current.getMonth() - 1);
    renderCalendar();
  });
}

if (nextBtn) {
  nextBtn.addEventListener("click", () => {
    current.setMonth(current.getMonth() + 1);
    renderCalendar();
  });
}

// ---------------- Create Event modal open/close ----------------
if (createEventBtn) {
  createEventBtn.addEventListener("click", openCreateModal);
}

if (closeCreateBtn) {
  closeCreateBtn.addEventListener("click", closeCreateModal);
}

if (cancelCreateBtn) {
  cancelCreateBtn.addEventListener("click", closeCreateModal);
}

if (createModal) {
  createModal.addEventListener("click", (e) => {
    if (e.target === createModal) {
      closeCreateModal();
    }
  });
}

// ---------------- All My Events ----------------
if (allMyEventsBtn) {
  allMyEventsBtn.addEventListener("click", openAllMyEventsModal);
}

if (closeAllMyEvents) {
  closeAllMyEvents.addEventListener("click", closeAllMyEventsModal);
}

if (allMyEventsModal) {
  allMyEventsModal.addEventListener("click", (e) => {
    if (e.target === allMyEventsModal) {
      closeAllMyEventsModal();
      return;
    }

    const btn = e.target.closest(".all-events-tab");
    if (!btn) return;

    if (btn.dataset.bucket) {
      activeAllEventsBucket = btn.dataset.bucket;
    }

    if (btn.dataset.category) {
      activeAllEventsCategory = btn.dataset.category;
    }

    renderAllMyEventsTabs();
    renderAllMyEventsGrid();
  });
}

// ---------------- Discover Events ----------------
if (discoverBtn) {
  discoverBtn.addEventListener("click", openDiscoverEventsModal);
}

if (closeDiscoverEvents) {
  closeDiscoverEvents.addEventListener("click", closeDiscoverEventsModal);
}

if (discoverEventsModal) {
  discoverEventsModal.addEventListener("click", (e) => {
    if (e.target === discoverEventsModal) {
      closeDiscoverEventsModal();
    }
  });
}

// ---------------- Invite modal events ----------------
if (closeInviteFriends) {
  closeInviteFriends.addEventListener("click", closeInviteFriendsModal);
}

if (inviteFriendsModal) {
  inviteFriendsModal.addEventListener("click", (e) => {
    if (e.target === inviteFriendsModal) {
      closeInviteFriendsModal();
    }
  });
}

if (inviteSearch) {
  inviteSearch.addEventListener("input", () => {
    const q = inviteSearch.value.trim().toLowerCase();

    const filtered = inviteFriendsCache.filter((friend) => {
      const username = (friend.username || "").toLowerCase();
      const name = (friend.name || "").toLowerCase();
      return username.includes(q) || name.includes(q);
    });

    renderInviteFriends(filtered);
  });
}

if (inviteFriendsList) {
  inviteFriendsList.addEventListener("click", async (e) => {
    const btn = e.target.closest(".send-invite-btn");
    if (!btn || !activeEvent) return;

    const userId = btn.dataset.userId;
    if (!userId) return;

    btn.disabled = true;
    btn.textContent = "Sending...";

    try {
      const res = await fetch(`/api/events/${activeEvent.id}/invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ user_id: userId })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Failed to send invite");
      }

      inviteFriendsCache = inviteFriendsCache.map((friend) => {
        if (String(friend.id) === String(userId)) {
          return { ...friend, invited: true };
        }
        return friend;
      });

      renderInviteFriends(inviteFriendsCache);
      await loadEvents();
      await loadGuestList(activeEvent.id);
      await loadMyEvents();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Invite";
      alert(err.message || "Failed to send invite");
    }
  });
}

// ---------------- Escape key closes modals ----------------
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;

  const eventModal = document.getElementById("eventPopupModal");

  if (inviteFriendsModal && !inviteFriendsModal.hidden) {
    closeInviteFriendsModal();
    return;
  }

  if (allMyEventsModal && !allMyEventsModal.hidden) {
    closeAllMyEventsModal();
    return;
  }

  if (discoverEventsModal && !discoverEventsModal.hidden) {
    closeDiscoverEventsModal();
    return;
  }

  if (createModal && !createModal.hidden) {
    closeCreateModal();
    return;
  }

  if (eventModal && !eventModal.hidden) {
    eventModal.hidden = true;
    activeEvent = null;
    closeAllMenus();
    if (!anyModalOpen()) unlockBodyScroll();
  }
});

// ---------------- Submit Create Event ----------------
if (createForm) {
  createForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const formData = new FormData(createForm);

    const res = await fetch("/api/events/create", {
      method: "POST",
      body: formData
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || "Failed to create event");
      return;
    }

    closeCreateModal();
    createForm.reset();
    await loadEvents();
    await loadMyEvents();
  });
}

// ---------------- Init ----------------
ensureEventPopup();
loadEvents();