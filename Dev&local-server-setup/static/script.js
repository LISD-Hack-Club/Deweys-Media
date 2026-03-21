document.addEventListener("DOMContentLoaded", () => {
  // =========================================================
  // CREATE POST (submit)
  // =========================================================
  const form = document.getElementById("post-form");
  const fileInput = document.getElementById("post-media");
  const preview = document.getElementById("media-preview");

  let selectedFiles = [];

  function syncInputFiles() {
    if (!fileInput) return;
    const dt = new DataTransfer();
    selectedFiles.forEach((f) => dt.items.add(f));
    fileInput.files = dt.files;
  }

  function renderPreview() {
    if (!preview) return;
    preview.innerHTML = "";

    if (selectedFiles.length === 0) {
      preview.hidden = true;
      return;
    }

    preview.hidden = false;

    selectedFiles.forEach((file, idx) => {
      const chip = document.createElement("div");
      chip.className = "preview-chip";

      const remove = document.createElement("div");
      remove.className = "preview-remove";
      remove.textContent = "×";
      remove.title = "Remove";
      remove.addEventListener("click", () => {
        selectedFiles.splice(idx, 1);
        syncInputFiles();
        renderPreview();
      });

      const url = URL.createObjectURL(file);

      if (file.type.startsWith("video/")) {
        const v = document.createElement("video");
        v.src = url;
        v.muted = true;
        v.playsInline = true;
        v.preload = "metadata";
        chip.appendChild(v);
      } else {
        const img = document.createElement("img");
        img.src = url;
        img.alt = file.name;
        chip.appendChild(img);
      }

      chip.appendChild(remove);
      preview.appendChild(chip);
    });
  }

  function resetCreatePostUI() {
    selectedFiles = [];
    syncInputFiles();
    if (preview) {
      preview.innerHTML = "";
      preview.hidden = true;
    }
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const contentEl = document.getElementById("post-content");
      const isPrivate = document.getElementById("post-private")?.checked;

      const content = (contentEl?.value || "").trim();
      if (!content) return;

      const formData = new FormData();
      formData.append("content", content);
      if (isPrivate) formData.append("private", true);

      selectedFiles.forEach((f) => formData.append("media", f));

      const res = await fetch("/create_post", { method: "POST", body: formData });

      if (res.ok) {
        form.reset();
        resetCreatePostUI();
        location.reload();
      }
    });
  }

  // =========================================================
  // CREATE POST UI (plus tray + preview)
  // =========================================================
  (() => {
    const plusBtn = document.getElementById("plus-btn");
    const tray = document.getElementById("post-tray");
    const uploadBtn = document.getElementById("tray-upload");
    const gifBtn = document.getElementById("tray-gif");
    const linkBtn = document.getElementById("tray-link");

    const privacyToggle = document.getElementById("privacy-toggle");
    const privateCheckbox = document.getElementById("post-private");

    if (!plusBtn || !tray || !fileInput || !preview || !privacyToggle || !privateCheckbox) return;

    function openTray() {
      tray.classList.add("open");
      plusBtn.classList.add("open");
      tray.setAttribute("aria-hidden", "false");
    }

    function closeTray() {
      tray.classList.remove("open");
      plusBtn.classList.remove("open");
      tray.setAttribute("aria-hidden", "true");
    }

    plusBtn.addEventListener("click", () => {
      tray.classList.contains("open") ? closeTray() : openTray();
    });

    document.addEventListener("click", (e) => {
      const clickedInside = tray.contains(e.target) || plusBtn.contains(e.target);
      if (!clickedInside) closeTray();
    });

    uploadBtn.addEventListener("click", () => {
      closeTray();
      fileInput.click();
    });

    gifBtn.addEventListener("click", () => {
      closeTray();
      alert("GIF picker coming soon.");
    });

    linkBtn.addEventListener("click", () => {
      closeTray();
      const url = prompt("Paste a link to attach:");
      if (url && url.trim()) {
        const box = document.getElementById("post-content");
        if (box) box.value = (box.value + "\n" + url.trim()).trim();
      }
    });

    fileInput.addEventListener("change", () => {
      const newFiles = Array.from(fileInput.files || []);

      newFiles.forEach((f) => {
        const exists = selectedFiles.some(
          (x) => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified
        );
        if (!exists) selectedFiles.push(f);
      });

      syncInputFiles();
      renderPreview();
    });

    function refreshPrivacyUI() {
      if (privateCheckbox.checked) {
        privacyToggle.classList.add("private");
        privacyToggle.textContent = "🔒 Private";
        privacyToggle.setAttribute("aria-pressed", "true");
      } else {
        privacyToggle.classList.remove("private");
        privacyToggle.textContent = "🌍 Public";
        privacyToggle.setAttribute("aria-pressed", "false");
      }
    }

    privacyToggle.addEventListener("click", () => {
      privateCheckbox.checked = !privateCheckbox.checked;
      refreshPrivacyUI();
    });

    refreshPrivacyUI();
  })();

  // =========================================================
  // CAROUSEL (per post)
  // =========================================================
  document.querySelectorAll(".media-carousel").forEach((carousel) => {
    const track = carousel.querySelector(".carousel-track");
    if (!track) return;

    const items = Array.from(track.querySelectorAll(".carousel-item"));
    const prevBtn = carousel.querySelector(".prev");
    const nextBtn = carousel.querySelector(".next");

    if (items.length <= 1) return;

    let index = 0;

    function update() {
      track.style.transform = `translateX(${-index * 100}%)`;
      items.forEach((el, i) => {
        if (el.tagName === "VIDEO" && i !== index) el.pause();
      });
    }

    prevBtn?.addEventListener("click", () => {
      index = (index - 1 + items.length) % items.length;
      update();
    });

    nextBtn?.addEventListener("click", () => {
      index = (index + 1) % items.length;
      update();
    });

    update();
  });

  // =========================================================
  // REACTIONS (hover + click)
  // =========================================================
  document.querySelectorAll(".reaction-btn-container").forEach((container) => {
    const btn = container.querySelector(".reaction-main-btn");
    const popup = container.querySelector(".reaction-popup");
    if (!btn || !popup) return;

    btn.addEventListener("mouseenter", () => (popup.style.display = "flex"));
    container.addEventListener("mouseleave", () => (popup.style.display = "none"));

    popup.querySelectorAll(".reaction-item").forEach((item) => {
      item.addEventListener("click", async () => {
        const reaction = item.dataset.reaction;
        const postId = btn.dataset.postId;
        const emojiImg = item.querySelector("img")?.src;

        const res = await fetch(`/react_post/${postId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reaction }),
        });

        if (res.ok) {
          if (emojiImg) btn.innerHTML = `<img src="${emojiImg}" class="selected-emoji" alt="Reaction">`;
          location.reload();
        }
      });
    });
  });

  // =========================================================
  // COMMENTS (post)
  // =========================================================
  document.querySelectorAll(".post-comment-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const postId = btn.dataset.postId;
      const input = btn.parentElement.querySelector(".comment-text");
      const content = (input?.value || "").trim();
      if (!content) return;

      const res = await fetch(`/add_comment/${postId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (res.ok) location.reload();
    });
  });

  // =========================================================
  // COMMENTS TOGGLE (Home + My Page)
  // =========================================================
  document.querySelectorAll(".post-card").forEach((card) => {
    const commentSection = card.querySelector(".comment-section");
    if (!commentSection) return;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn ghost-btn comment-toggle-btn";
    toggle.textContent = "💬 Comments";

    commentSection.parentElement.insertBefore(toggle, commentSection);

    commentSection.style.display = "none";

    toggle.addEventListener("click", () => {
      const open = commentSection.style.display !== "none";
      commentSection.style.display = open ? "none" : "block";
    });
  });

  // =========================================================
  // IMAGE MODAL PREVIEW (images only)
  // =========================================================
  const modal = document.getElementById("image-modal");
  const modalImg = document.getElementById("modal-img");
  const closeBtn = document.querySelector(".image-close");

  document.addEventListener("click", (e) => {
    const t = e.target;

    const isImage =
      t.classList?.contains("post-media-img") ||
      (t.classList?.contains("carousel-item") && t.tagName === "IMG");

    if (!isImage || !modal || !modalImg) return;

    modal.style.display = "flex";
    modalImg.src = t.src;
  });

  closeBtn?.addEventListener("click", () => {
    if (modal) modal.style.display = "none";
  });

  modal?.addEventListener("click", (e) => {
    if (e.target.id === "image-modal") modal.style.display = "none";
  });

  // =========================================================
  // MY PAGE: EDIT BIO + CHANGE AVATAR
  // =========================================================
  const editBioBtn = document.getElementById("edit-bio-btn");
  const bioEl = document.getElementById("profile-bio");

  const changeAvatarBtn = document.getElementById("change-avatar-btn");
  const avatarInput = document.getElementById("avatar-input");
  const profileAvatar = document.getElementById("profile-avatar");

  if (editBioBtn && bioEl) {
    editBioBtn.addEventListener("click", async () => {
      const current = (bioEl.textContent || "").trim();
      const start = current === "Add a bio…" ? "" : current;
      const newBio = prompt("Edit your bio (max 160 chars):", start);
      if (newBio === null) return;

      const res = await fetch("/update_bio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bio: newBio }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.error || "Failed to update bio");

      bioEl.textContent = data.bio || "Add a bio…";
    });
  }

  if (changeAvatarBtn && avatarInput) {
    changeAvatarBtn.addEventListener("click", () => avatarInput.click());
  }

  if (avatarInput) {
    avatarInput.addEventListener("change", async () => {
      const file = avatarInput.files && avatarInput.files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append("avatar", file);

      const res = await fetch("/change_avatar", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.error || "Failed to upload avatar");

      if (profileAvatar) profileAvatar.src = data.avatar_url + "?v=" + Date.now();

      const headerAvatar = document.querySelector(".header-avatar");
      if (headerAvatar) headerAvatar.src = data.avatar_url + "?v=" + Date.now();

      avatarInput.value = "";
    });
  }

  // =========================================================
  // EDIT + DELETE (FROG MODALS) — uses GET /get_post/<id>
  // IMPORTANT: your Flask MUST include /get_post/<id> (you added it)
  // =========================================================
  (() => {
    const editModal = document.getElementById("edit-modal");
    const deleteModal = document.getElementById("delete-modal");

    const editClose = document.getElementById("edit-close");
    const editCancel = document.getElementById("edit-cancel");
    const editSave = document.getElementById("edit-save");

    const editContent = document.getElementById("edit-content");
    const existingWrap = document.getElementById("edit-existing-media");
    const newWrap = document.getElementById("edit-new-media");

    const editPlusBtn = document.getElementById("edit-plus-btn");
    const editTray = document.getElementById("edit-tray");
    const editUpload = document.getElementById("edit-upload");
    const editGif = document.getElementById("edit-gif");
    const editLink = document.getElementById("edit-link");
    const editMediaInput = document.getElementById("edit-media-input");

    const deleteCancel = document.getElementById("delete-cancel");
    const deleteConfirm = document.getElementById("delete-confirm");

    // If you’re on a page without the modals, don't crash the whole script
    if (!editModal || !deleteModal) return;

    let activePostId = null;
    let existingMedia = [];              // [{id, url, type}]
    let removedExistingIds = new Set();  // media IDs to delete
    let newFiles = [];                   // File objects to add
    let deletePostId = null;

    function openModal(modal) {
      modal.hidden = false;
      modal.style.display = "flex";
      document.body.style.overflow = "hidden";
    }

    function closeModal(modal) {
      modal.hidden = true;
      modal.style.display = "none";
      document.body.style.overflow = "";
    }

    function renderExisting() {
      if (!existingWrap) return;
      existingWrap.innerHTML = "";

      const visible = existingMedia.filter((m) => !removedExistingIds.has(String(m.id)));
      if (visible.length === 0) {
        existingWrap.innerHTML = `<div style="font-weight:800;color:var(--muted);">No media</div>`;
        return;
      }

      visible.forEach((m) => {
        const chip = document.createElement("div");
        chip.className = "preview-chip";

        const remove = document.createElement("div");
        remove.className = "preview-remove";
        remove.textContent = "×";
        remove.title = "Remove";
        remove.addEventListener("click", () => {
          removedExistingIds.add(String(m.id));
          renderExisting();
        });

        if (m.type === "video") {
          const v = document.createElement("video");
          v.src = m.url;
          v.controls = true;
          v.playsInline = true;
          chip.appendChild(v);
        } else {
          const img = document.createElement("img");
          img.src = m.url;
          img.alt = "media";
          chip.appendChild(img);
        }

        chip.appendChild(remove);
        existingWrap.appendChild(chip);
      });
    }

    function syncEditInputFiles() {
      if (!editMediaInput) return;
      const dt = new DataTransfer();
      newFiles.forEach((f) => dt.items.add(f));
      editMediaInput.files = dt.files;
    }

    function renderNew() {
      if (!newWrap) return;
      newWrap.innerHTML = "";

      if (newFiles.length === 0) {
        newWrap.hidden = true;
        return;
      }
      newWrap.hidden = false;

      newFiles.forEach((file, idx) => {
        const chip = document.createElement("div");
        chip.className = "preview-chip";

        const remove = document.createElement("div");
        remove.className = "preview-remove";
        remove.textContent = "×";
        remove.title = "Remove";
        remove.addEventListener("click", () => {
          newFiles.splice(idx, 1);
          syncEditInputFiles();
          renderNew();
        });

        const url = URL.createObjectURL(file);

        if (file.type.startsWith("video/")) {
          const v = document.createElement("video");
          v.src = url;
          v.muted = true;
          v.playsInline = true;
          v.preload = "metadata";
          chip.appendChild(v);
        } else {
          const img = document.createElement("img");
          img.src = url;
          img.alt = file.name;
          chip.appendChild(img);
        }

        chip.appendChild(remove);
        newWrap.appendChild(chip);
      });
    }

    function resetEditState() {
      activePostId = null;
      existingMedia = [];
      removedExistingIds = new Set();
      newFiles = [];
      if (editContent) editContent.value = "";
      if (existingWrap) existingWrap.innerHTML = "";
      if (newWrap) {
        newWrap.innerHTML = "";
        newWrap.hidden = true;
      }
      if (editMediaInput) editMediaInput.value = "";
      editTray?.classList.remove("open");
      editPlusBtn?.classList.remove("open");
    }

    // ----- Edit tray inside modal -----
    function openTray() {
      editTray?.classList.add("open");
      editPlusBtn?.classList.add("open");
      editTray?.setAttribute("aria-hidden", "false");
    }
    function closeTray() {
      editTray?.classList.remove("open");
      editPlusBtn?.classList.remove("open");
      editTray?.setAttribute("aria-hidden", "true");
    }

    editPlusBtn?.addEventListener("click", () => {
      editTray?.classList.contains("open") ? closeTray() : openTray();
    });

    document.addEventListener("click", (e) => {
      if (editModal.hidden) return;
      const inside = editTray?.contains(e.target) || editPlusBtn?.contains(e.target);
      if (!inside) closeTray();
    });

    editUpload?.addEventListener("click", () => {
      closeTray();
      editMediaInput?.click();
    });

    editGif?.addEventListener("click", () => {
      closeTray();
      alert("GIF picker coming soon.");
    });

    editLink?.addEventListener("click", () => {
      closeTray();
      const url = prompt("Paste a link to attach:");
      if (url && url.trim() && editContent) {
        editContent.value = (editContent.value + "\n" + url.trim()).trim();
      }
    });

    editMediaInput?.addEventListener("change", () => {
      const incoming = Array.from(editMediaInput.files || []);
      incoming.forEach((f) => {
        const exists = newFiles.some(
          (x) => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified
        );
        if (!exists) newFiles.push(f);
      });
      syncEditInputFiles();
      renderNew();
    });

    // ----- Open edit modal -----
    document.querySelectorAll(".edit-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const postId = btn.dataset.postId;
        if (!postId) return;

        activePostId = postId;

        const res = await fetch(`/get_post/${postId}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return alert(data.error || "Could not load post.");

        if (editContent) editContent.value = (data.content || "").trim();
        existingMedia = data.media || [];
        removedExistingIds = new Set();
        newFiles = [];
        if (editMediaInput) editMediaInput.value = "";

        renderExisting();
        renderNew();
        openModal(editModal);
        editContent?.focus();
      });
    });

    // ----- Save edit -----
    editSave?.addEventListener("click", async () => {
      if (!activePostId) return;

      const content = (editContent?.value || "").trim();
      if (!content) return alert("Post cannot be empty.");

      const fd = new FormData();
      fd.append("content", content);

      // matches Flask: request.form.get("remove_media_ids")
      fd.append("remove_media_ids", Array.from(removedExistingIds).join(","));

      newFiles.forEach((f) => fd.append("media", f));

      const res = await fetch(`/edit_post/${activePostId}`, {
        method: "POST",
        body: fd,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.error || "Failed to edit post.");

      closeModal(editModal);
      resetEditState();
      location.reload();
    });

    // ----- Close edit modal -----
    editClose?.addEventListener("click", () => {
      closeModal(editModal);
      resetEditState();
    });

    editCancel?.addEventListener("click", () => {
      closeModal(editModal);
      resetEditState();
    });

    editModal.addEventListener("click", (e) => {
      if (e.target === editModal) {
        closeModal(editModal);
        resetEditState();
      }
    });

    // ----- Delete modal open -----
    document.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        deletePostId = btn.dataset.postId || null;
        if (!deletePostId) return;
        openModal(deleteModal);
      });
    });

    // ----- Delete modal close -----
    deleteCancel?.addEventListener("click", () => {
      deletePostId = null;
      closeModal(deleteModal);
    });

    deleteModal.addEventListener("click", (e) => {
      if (e.target === deleteModal) {
        deletePostId = null;
        closeModal(deleteModal);
      }
    });

    // ----- Confirm delete -----
    deleteConfirm?.addEventListener("click", async () => {
      if (!deletePostId) return;

      const res = await fetch(`/delete_post/${deletePostId}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.error || "Failed to delete.");

      closeModal(deleteModal);
      location.reload();
    });
  })();
});

document.addEventListener("DOMContentLoaded", () => {
  const tabs = document.querySelectorAll(".settings-tab");
  const panels = document.querySelectorAll(".settings-panel");
  const darkModeToggle = document.getElementById("darkModeToggle");

  // ---------------- TABS ----------------
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;

      tabs.forEach(t => t.classList.remove("active"));
      panels.forEach(panel => panel.classList.remove("active"));

      tab.classList.add("active");

      const selectedPanel = document.getElementById(target);
      if (selectedPanel) {
        selectedPanel.classList.add("active");
      }
    });
  });

  // ---------------- LOAD DARK MODE ----------------
  const savedDarkMode = localStorage.getItem("darkMode");

  if (savedDarkMode === "true") {
    document.body.classList.add("dark-mode");
    if (darkModeToggle) darkModeToggle.checked = true;
  } else {
    document.body.classList.remove("dark-mode");
    if (darkModeToggle) darkModeToggle.checked = false;
  }

  // ---------------- TOGGLE DARK MODE ----------------
  if (darkModeToggle) {
    darkModeToggle.addEventListener("change", () => {
      if (darkModeToggle.checked) {
        document.body.classList.add("dark-mode");
        localStorage.setItem("darkMode", "true");
      } else {
        document.body.classList.remove("dark-mode");
        localStorage.setItem("darkMode", "false");
      }
    });
  }
});

//-------- Forgot Password --------

document.addEventListener("DOMContentLoaded", () => {
  const forgotModal = document.getElementById("forgotModal");
  const openForgotModal = document.getElementById("openForgotModal");
  const closeForgotModal = document.getElementById("closeForgotModal");

  const stepEmail = document.getElementById("step-email");
  const stepCode = document.getElementById("step-code");
  const stepPassword = document.getElementById("step-password");

  const resetEmail = document.getElementById("resetEmail");
  const resetCode = document.getElementById("resetCode");
  const newPassword = document.getElementById("newPassword");
  const confirmPassword = document.getElementById("confirmPassword");

  const sendCodeBtn = document.getElementById("sendCodeBtn");
  const verifyCodeBtn = document.getElementById("verifyCodeBtn");
  const resetPasswordBtn = document.getElementById("resetPasswordBtn");
  const backToEmailBtn = document.getElementById("backToEmailBtn");

  const fpStatus = document.getElementById("fpStatus");

  function showStep(step) {
    stepEmail.classList.remove("active");
    stepCode.classList.remove("active");
    stepPassword.classList.remove("active");
    step.classList.add("active");
    fpStatus.textContent = "";
  }

  function setStatus(message, isError = false) {
    fpStatus.textContent = message;
    fpStatus.classList.toggle("error", isError);
    fpStatus.classList.toggle("success", !isError);
  }

  function openModal() {
    forgotModal.classList.add("show");
    showStep(stepEmail);
    resetEmail.value = "";
    resetCode.value = "";
    newPassword.value = "";
    confirmPassword.value = "";
  }

  function closeModal() {
    forgotModal.classList.remove("show");
  }

  openForgotModal.addEventListener("click", openModal);
  closeForgotModal.addEventListener("click", closeModal);

  forgotModal.addEventListener("click", (e) => {
    if (e.target === forgotModal) closeModal();
  });

  backToEmailBtn.addEventListener("click", () => showStep(stepEmail));

  sendCodeBtn.addEventListener("click", async () => {
    const email = resetEmail.value.trim();

    if (!email) {
      setStatus("Please enter your email.", true);
      return;
    }

    try {
      const res = await fetch("/forgot-password/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus(data.error || "Could not send code.", true);
        return;
      }

      setStatus(data.message || "Code sent.");
      showStep(stepCode);
    } catch (err) {
      setStatus("Something went wrong. Try again.", true);
    }
  });

  verifyCodeBtn.addEventListener("click", async () => {
    const email = resetEmail.value.trim();
    const code = resetCode.value.trim();

    if (!code || code.length !== 6) {
      setStatus("Please enter the 6-digit code.", true);
      return;
    }

    try {
      const res = await fetch("/forgot-password/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code })
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus(data.error || "Invalid code.", true);
        return;
      }

      setStatus(data.message || "Code verified.");
      showStep(stepPassword);
    } catch (err) {
      setStatus("Something went wrong. Try again.", true);
    }
  });

  resetPasswordBtn.addEventListener("click", async () => {
    const password = newPassword.value;
    const confirm = confirmPassword.value;

    if (!password || !confirm) {
      setStatus("Please fill out both password fields.", true);
      return;
    }

    if (password.length < 6) {
      setStatus("Password must be at least 6 characters.", true);
      return;
    }

    if (password !== confirm) {
      setStatus("Passwords do not match.", true);
      return;
    }

    try {
      const res = await fetch("/forgot-password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirm_password: confirm })
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus(data.error || "Could not reset password.", true);
        return;
      }

      setStatus(data.message || "Password updated.");
      setTimeout(() => {
        closeModal();
      }, 1200);
    } catch (err) {
      setStatus("Something went wrong. Try again.", true);
    }
  });
});
document.addEventListener("DOMContentLoaded", () => {
  const editInfoBtn = document.getElementById("edit-info-btn");
  const editInfoModal = document.getElementById("edit-info-modal");
  const editInfoClose = document.getElementById("edit-info-close");
  const editInfoCancel = document.getElementById("edit-info-cancel");
  const editInfoForm = document.getElementById("edit-info-form");

  function openInfoModal() {
    if (editInfoModal) editInfoModal.hidden = false;
  }

  function closeInfoModal() {
    if (editInfoModal) editInfoModal.hidden = true;
  }

  if (editInfoBtn) editInfoBtn.addEventListener("click", openInfoModal);
  if (editInfoClose) editInfoClose.addEventListener("click", closeInfoModal);
  if (editInfoCancel) editInfoCancel.addEventListener("click", closeInfoModal);

  if (editInfoModal) {
    editInfoModal.addEventListener("click", (e) => {
      if (e.target === editInfoModal) closeInfoModal();
    });
  }

  if (editInfoForm) {
    editInfoForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const formData = new FormData(editInfoForm);

      try {
        const res = await fetch("/update_info", {
          method: "POST",
          body: formData
        });

        const data = await res.json();

        if (data.success) {
          window.location.reload();
        } else {
          alert(data.error || "Failed to save info.");
        }
      } catch (err) {
        alert("Something went wrong saving your info.");
        console.error(err);
      }
    });
  }
});