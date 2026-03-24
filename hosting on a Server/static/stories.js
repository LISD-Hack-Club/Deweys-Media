document.addEventListener("DOMContentLoaded", () => {
  const storiesRow = document.getElementById("storiesRow");
  const addStoryBtn = document.getElementById("addStoryBtn");
  const storyUploadInput = document.getElementById("storyUploadInput");

  const storyCreateModal = document.getElementById("storyCreateModal");
  const storyCreateClose = document.getElementById("storyCreateClose");
  const storyCreateCancel = document.getElementById("storyCreateCancel");
  const storyChooseMediaBtn = document.getElementById("storyChooseMediaBtn");
  const storyClearMediaBtn = document.getElementById("storyClearMediaBtn");
  const storyCaptionInput = document.getElementById("storyCaptionInput");
  const storyTextOverlayInput = document.getElementById("storyTextOverlayInput");
  const storyBgColorInput = document.getElementById("storyBgColorInput");
  const storyPublishBtn = document.getElementById("storyPublishBtn");
  const storyPreviewImg = document.getElementById("storyPreviewImg");
  const storyPreviewVideo = document.getElementById("storyPreviewVideo");
  const storyPreviewText = document.getElementById("storyPreviewText");
  const storySelectedFileName = document.getElementById("storySelectedFileName");

  const storyViewer = document.getElementById("storyViewer");
  const storyViewerBackdrop = document.getElementById("storyViewerBackdrop");
  const storyCloseBtn = document.getElementById("storyCloseBtn");
  const storyViewerAvatar = document.getElementById("storyViewerAvatar");
  const storyViewerName = document.getElementById("storyViewerName");
  const storyViewerTime = document.getElementById("storyViewerTime");
  const storyViewerImg = document.getElementById("storyViewerImg");
  const storyViewerVideo = document.getElementById("storyViewerVideo");
  const storyViewerBody = document.getElementById("storyViewerBody");
  const storyDeleteBtn = document.getElementById("storyDeleteBtn");
  const storyPrevBtn = document.getElementById("storyPrevBtn");
  const storyNextBtn = document.getElementById("storyNextBtn");
  const storyProgressWrap = document.getElementById("storyProgressWrap");

  const currentUserIdEl = document.getElementById("currentUserId");
  const currentUserId = Number(currentUserIdEl?.dataset?.id || 0);

  if (!storiesRow || !storyViewer || !storyViewerBody) {
    return;
  }

  let storyGroups = [];
  let filteredStoryGroups = [];
  let selectedStoryFile = null;
  let selectedStoryFileUrl = null;

  let activeGroupIndex = 0;
  let activeStoryIndex = 0;
  let storyTimer = null;
  let progressTimer = null;
  let progressPercent = 0;

  const STORY_IMAGE_DURATION = 5000;
  const STORY_PROGRESS_INTERVAL = 50;

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatStoryTime(isoString) {
    if (!isoString) return "Just now";

    const d = new Date(isoString);
    const now = new Date();
    const diffMs = now - d;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);

    if (diffSec < 60) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;

    return d.toLocaleDateString();
  }

  function normalizeStoryUrl(url, userId = null) {
    if (!url) return "";

    let clean = String(url).trim();
    if (!clean) return "";

    if (clean.startsWith("http://") || clean.startsWith("https://")) {
      return clean;
    }

    if (clean.startsWith("/static/")) {
      return clean;
    }

    if (clean.includes("/static/")) {
      return clean.slice(clean.indexOf("/static/"));
    }

    if (clean.startsWith("static/")) {
      return `/${clean}`;
    }

    if (!clean.startsWith("/")) {
      if (userId) {
        return `/static/story_uploads/${userId}/${clean}`;
      }
      return `/static/story_uploads/${clean}`;
    }

    return clean;
  }

  function resetStoryPreview() {
    if (selectedStoryFileUrl) {
      URL.revokeObjectURL(selectedStoryFileUrl);
      selectedStoryFileUrl = null;
    }

    selectedStoryFile = null;

    if (storyUploadInput) storyUploadInput.value = "";

    if (storyPreviewImg) {
      storyPreviewImg.hidden = true;
      storyPreviewImg.src = "";
    }

    if (storyPreviewVideo) {
      storyPreviewVideo.hidden = true;
      storyPreviewVideo.pause();
      storyPreviewVideo.src = "";
      storyPreviewVideo.load?.();
    }

    if (storyPreviewText) {
      storyPreviewText.hidden = false;
      storyPreviewText.textContent = storyTextOverlayInput?.value.trim() || "Text Preview";
      storyPreviewText.style.background = storyBgColorInput?.value || "#66c23a";
    }

    if (storySelectedFileName) {
      storySelectedFileName.textContent = "No media selected";
    }
  }

  function updateStoryPreview() {
    const overlayText = storyTextOverlayInput?.value.trim() || "";
    const bgColor = storyBgColorInput?.value || "#66c23a";

    if (storyPreviewText) {
      storyPreviewText.textContent = overlayText || "Text Preview";
      storyPreviewText.style.background = bgColor;
    }

    if (!selectedStoryFile) {
      if (storyPreviewText) storyPreviewText.hidden = false;
      if (storyPreviewImg) storyPreviewImg.hidden = true;
      if (storyPreviewVideo) storyPreviewVideo.hidden = true;
      return;
    }

    const isVideo = selectedStoryFile.type.startsWith("video/");
    const isImage = selectedStoryFile.type.startsWith("image/");

    if (isImage) {
      if (storyPreviewText) storyPreviewText.hidden = !overlayText;
      if (storyPreviewImg) storyPreviewImg.hidden = false;
      if (storyPreviewVideo) storyPreviewVideo.hidden = true;
    } else if (isVideo) {
      if (storyPreviewText) storyPreviewText.hidden = !overlayText;
      if (storyPreviewImg) storyPreviewImg.hidden = true;
      if (storyPreviewVideo) storyPreviewVideo.hidden = false;
    }
  }

  function openStoryCreateModal() {
    if (!storyCreateModal) return;
    storyCreateModal.hidden = false;
    document.body.classList.add("modal-open");
    updateStoryPreview();
  }

  function closeStoryCreateModal() {
    if (!storyCreateModal) return;
    storyCreateModal.hidden = true;
    document.body.classList.remove("modal-open");

    if (storyCaptionInput) storyCaptionInput.value = "";
    if (storyTextOverlayInput) storyTextOverlayInput.value = "";
    if (storyBgColorInput) storyBgColorInput.value = "#66c23a";

    resetStoryPreview();
  }

  function renderStoryCards() {
    const oldCards = storiesRow.querySelectorAll(".story-card.generated-story-card");
    oldCards.forEach(card => card.remove());

    filteredStoryGroups.forEach((group, groupIndex) => {
      const firstStory = group.stories?.[0];
      if (!firstStory) return;

      const card = document.createElement("button");
      card.type = "button";
      card.className = "story-card generated-story-card";
      card.dataset.groupIndex = String(groupIndex);

      const isViewed = !!group.all_viewed && !group.is_own;
      if (isViewed) card.classList.add("viewed");
      if (group.is_own) card.classList.add("own-story");

      card.innerHTML = `
        <div class="story-avatar-ring ${isViewed ? "seen" : ""}">
          <img
            class="story-avatar"
            src="${escapeHtml(group.profile_pic || "/static/assets/imgs/avatar_placeholder.png")}"
            alt="${escapeHtml(group.username)}"
          >
        </div>
        <div class="story-name">${escapeHtml(group.username)}</div>
      `;

      card.addEventListener("click", () => {
        openStoryViewer(groupIndex, 0);
      });

      storiesRow.appendChild(card);
    });
  }

  function getVisibleStoryGroups(groups) {
    return (groups || []).filter(group => {
      if (!group || !Array.isArray(group.stories) || group.stories.length === 0) return false;
      if (group.is_own) return true;
      return !group.all_viewed;
    });
  }

  async function loadStories() {
    try {
      const res = await fetch("/api/stories");
      const data = await res.json();

      if (!res.ok || !data.success) return;

      storyGroups = Array.isArray(data.stories) ? data.stories : [];
      filteredStoryGroups = getVisibleStoryGroups(storyGroups);
      renderStoryCards();
    } catch (err) {
      console.error("Failed to load stories:", err);
    }
  }

  async function publishStory() {
    const caption = storyCaptionInput?.value.trim() || "";
    const textOverlay = storyTextOverlayInput?.value.trim() || "";
    const bgColor = storyBgColorInput?.value || "#66c23a";

    if (!selectedStoryFile && !caption && !textOverlay) {
      alert("Add a photo, video, caption, or text first.");
      return;
    }

    const formData = new FormData();
    formData.append("caption", caption);
    formData.append("text_overlay", textOverlay);
    formData.append("bg_color", bgColor);

    if (selectedStoryFile) {
      formData.append("media", selectedStoryFile);
    }

    if (storyPublishBtn) {
      storyPublishBtn.disabled = true;
      storyPublishBtn.textContent = "Sharing...";
    }

    try {
      const res = await fetch("/api/stories/create", {
        method: "POST",
        body: formData
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        alert(data.error || "Could not create story.");
        return;
      }

      closeStoryCreateModal();
      await loadStories();
    } catch (err) {
      console.error(err);
      alert("Something went wrong while creating the story.");
    } finally {
      if (storyPublishBtn) {
        storyPublishBtn.disabled = false;
        storyPublishBtn.textContent = "Share Story";
      }
    }
  }

  function clearViewerMedia() {
    if (storyViewerImg) {
      storyViewerImg.hidden = true;
      storyViewerImg.removeAttribute("src");
      storyViewerImg.onerror = null;
    }

    if (storyViewerVideo) {
      storyViewerVideo.hidden = true;
      storyViewerVideo.pause();
      storyViewerVideo.removeAttribute("src");
      storyViewerVideo.onloadedmetadata = null;
      storyViewerVideo.onended = null;
      storyViewerVideo.load?.();
    }
  }

  function stopStoryTimers() {
    if (storyTimer) {
      clearTimeout(storyTimer);
      storyTimer = null;
    }
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    progressPercent = 0;
  }

  function removeTextSlide() {
    const existing = document.getElementById("storyTextSlide");
    if (existing) existing.remove();
  }

  function closeStoryViewer() {
    stopStoryTimers();
    clearViewerMedia();
    removeTextSlide();
    storyViewer.hidden = true;
    document.body.classList.remove("story-open");
  }

  function buildProgressBars(group) {
    if (!storyProgressWrap) return;

    storyProgressWrap.innerHTML = "";

    (group.stories || []).forEach((_, idx) => {
      const outer = document.createElement("div");
      outer.className = "story-progress-segment";

      const inner = document.createElement("div");
      inner.className = "story-progress-bar";
      inner.dataset.index = String(idx);
      inner.style.width = idx < activeStoryIndex ? "100%" : "0%";

      outer.appendChild(inner);
      storyProgressWrap.appendChild(outer);
    });
  }

  function updateProgressBar(index, percent) {
    if (!storyProgressWrap) return;

    const bar = storyProgressWrap.querySelector(`.story-progress-bar[data-index="${index}"]`);
    if (bar) {
      bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    }
  }

  async function markStoryViewed(storyId) {
    try {
      await fetch(`/api/stories/${storyId}/view`, { method: "POST" });
    } catch (err) {
      console.error("Failed to mark story viewed:", err);
    }
  }

  function refreshViewedStateForActiveGroup() {
    const group = filteredStoryGroups[activeGroupIndex];
    if (!group || group.is_own) return;

    const currentStory = group.stories?.[activeStoryIndex];
    if (currentStory) {
      currentStory.viewed = true;
    }

    group.all_viewed = group.stories.every(s => s.viewed);
  }

  function advanceToNextStory() {
    const group = filteredStoryGroups[activeGroupIndex];
    if (!group) {
      closeStoryViewer();
      return;
    }

    if (activeStoryIndex < group.stories.length - 1) {
      activeStoryIndex += 1;
      showActiveStory();
      return;
    }

    if (activeGroupIndex < filteredStoryGroups.length - 1) {
      activeGroupIndex += 1;
      activeStoryIndex = 0;
      showActiveStory();
      return;
    }

    closeStoryViewer();
    loadStories();
  }

  function goToPrevStory() {
    if (activeStoryIndex > 0) {
      activeStoryIndex -= 1;
      showActiveStory();
      return;
    }

    if (activeGroupIndex > 0) {
      activeGroupIndex -= 1;
      const prevGroup = filteredStoryGroups[activeGroupIndex];
      activeStoryIndex = Math.max((prevGroup?.stories?.length || 1) - 1, 0);
      showActiveStory();
    }
  }

  function startImageStoryTimer() {
    stopStoryTimers();

    progressPercent = 0;
    updateProgressBar(activeStoryIndex, 0);

    progressTimer = setInterval(() => {
      progressPercent += (STORY_PROGRESS_INTERVAL / STORY_IMAGE_DURATION) * 100;
      updateProgressBar(activeStoryIndex, progressPercent);
    }, STORY_PROGRESS_INTERVAL);

    storyTimer = setTimeout(() => {
      stopStoryTimers();
      advanceToNextStory();
    }, STORY_IMAGE_DURATION);
  }

  function startVideoStoryTimer() {
    stopStoryTimers();

    const duration = storyViewerVideo?.duration;
    if (!duration || !isFinite(duration)) {
      if (storyViewerVideo) {
        storyViewerVideo.onloadedmetadata = () => {
          startVideoStoryTimer();
        };
      }
      return;
    }

    updateProgressBar(activeStoryIndex, 0);

    progressTimer = setInterval(() => {
      const d = storyViewerVideo.duration || 1;
      const c = storyViewerVideo.currentTime || 0;
      const pct = (c / d) * 100;
      updateProgressBar(activeStoryIndex, pct);
    }, STORY_PROGRESS_INTERVAL);

    storyViewerVideo.onended = () => {
      stopStoryTimers();
      advanceToNextStory();
    };
  }

  function showTextStory(text, bgColor) {
    clearViewerMedia();
    removeTextSlide();

    const textDiv = document.createElement("div");
    textDiv.className = "story-text-slide";
    textDiv.id = "storyTextSlide";
    textDiv.style.background = bgColor || "#66c23a";
    textDiv.textContent = text || "";

    storyViewerBody.appendChild(textDiv);
    startImageStoryTimer();
  }

  function addOverlayText(text) {
    if (!text) return;

    removeTextSlide();

    const overlay = document.createElement("div");
    overlay.className = "story-overlay-text";
    overlay.id = "storyTextSlide";
    overlay.textContent = text;
    storyViewerBody.appendChild(overlay);
  }

  async function showActiveStory() {
    stopStoryTimers();
    clearViewerMedia();
    removeTextSlide();

    const group = filteredStoryGroups[activeGroupIndex];
    if (!group) {
      closeStoryViewer();
      return;
    }

    const story = group.stories?.[activeStoryIndex];
    if (!story) {
      closeStoryViewer();
      return;
    }

    buildProgressBars(group);

    for (let i = 0; i < activeStoryIndex; i++) {
      updateProgressBar(i, 100);
    }

    if (storyViewerAvatar) {
      storyViewerAvatar.src = group.profile_pic || "/static/assets/imgs/avatar_placeholder.png";
    }
    if (storyViewerName) {
      storyViewerName.textContent = group.username || "User";
    }
    if (storyViewerTime) {
      storyViewerTime.textContent = formatStoryTime(story.created_at);
    }

    if (storyDeleteBtn) {
      storyDeleteBtn.hidden = !story.is_own;
      storyDeleteBtn.dataset.storyId = String(story.id);
    }

    if (!story.is_own && !story.viewed) {
      await markStoryViewed(story.id);
      story.viewed = true;
      refreshViewedStateForActiveGroup();
      renderStoryCards();
    }

    const mediaUrl = normalizeStoryUrl(story.media_url, story.user_id);

    if (story.media_type === "image" && mediaUrl) {
      storyViewerImg.hidden = false;
      storyViewerImg.src = mediaUrl;
      storyViewerImg.onerror = () => {
        console.error("Failed to load story image:", mediaUrl);
        showTextStory(story.text_overlay || story.caption || "Story image failed to load.", story.bg_color || "#66c23a");
      };
      if (story.text_overlay) addOverlayText(story.text_overlay);
      startImageStoryTimer();
      return;
    }

    if (story.media_type === "video" && mediaUrl) {
      storyViewerVideo.hidden = false;
      storyViewerVideo.src = mediaUrl;
      storyViewerVideo.currentTime = 0;
      storyViewerVideo.onerror = () => {
        console.error("Failed to load story video:", mediaUrl);
        showTextStory(story.text_overlay || story.caption || "Story video failed to load.", story.bg_color || "#66c23a");
      };
      storyViewerVideo.play().catch(() => {});
      if (story.text_overlay) addOverlayText(story.text_overlay);
      startVideoStoryTimer();
      return;
    }

    showTextStory(story.text_overlay || story.caption || "", story.bg_color || "#66c23a");
  }

  function openStoryViewer(groupIndex, storyIndex = 0) {
    if (!filteredStoryGroups[groupIndex]) return;

    activeGroupIndex = groupIndex;
    activeStoryIndex = storyIndex;

    storyViewer.hidden = false;
    document.body.classList.add("story-open");
    showActiveStory();
  }

  async function deleteCurrentStory() {
    const storyId = Number(storyDeleteBtn?.dataset?.storyId || 0);
    if (!storyId) return;

    const ok = window.confirm("Delete this story?");
    if (!ok) return;

    try {
      const res = await fetch(`/api/stories/${storyId}/delete`, {
        method: "POST"
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        alert(data.error || "Could not delete story.");
        return;
      }

      closeStoryViewer();
      await loadStories();
    } catch (err) {
      console.error(err);
      alert("Could not delete story.");
    }
  }

  addStoryBtn?.addEventListener("click", openStoryCreateModal);
  storyCreateClose?.addEventListener("click", closeStoryCreateModal);
  storyCreateCancel?.addEventListener("click", closeStoryCreateModal);

  storyChooseMediaBtn?.addEventListener("click", () => {
    storyUploadInput?.click();
  });

  storyClearMediaBtn?.addEventListener("click", () => {
    resetStoryPreview();
    updateStoryPreview();
  });

  storyUploadInput?.addEventListener("change", () => {
    const file = storyUploadInput.files?.[0];
    if (!file) return;

    selectedStoryFile = file;
    if (storySelectedFileName) {
      storySelectedFileName.textContent = file.name;
    }

    if (selectedStoryFileUrl) {
      URL.revokeObjectURL(selectedStoryFileUrl);
    }

    selectedStoryFileUrl = URL.createObjectURL(file);

    if (file.type.startsWith("image/")) {
      if (storyPreviewImg) {
        storyPreviewImg.src = selectedStoryFileUrl;
        storyPreviewImg.hidden = false;
      }
      if (storyPreviewVideo) {
        storyPreviewVideo.hidden = true;
        storyPreviewVideo.pause();
        storyPreviewVideo.src = "";
      }
    } else if (file.type.startsWith("video/")) {
      if (storyPreviewVideo) {
        storyPreviewVideo.src = selectedStoryFileUrl;
        storyPreviewVideo.hidden = false;
      }
      if (storyPreviewImg) {
        storyPreviewImg.hidden = true;
        storyPreviewImg.src = "";
      }
    }

    updateStoryPreview();
  });

  storyTextOverlayInput?.addEventListener("input", updateStoryPreview);
  storyBgColorInput?.addEventListener("input", updateStoryPreview);
  storyPublishBtn?.addEventListener("click", publishStory);

  storyCloseBtn?.addEventListener("click", closeStoryViewer);
  storyViewerBackdrop?.addEventListener("click", closeStoryViewer);
  storyPrevBtn?.addEventListener("click", goToPrevStory);
  storyNextBtn?.addEventListener("click", advanceToNextStory);
  storyDeleteBtn?.addEventListener("click", deleteCurrentStory);

  document.addEventListener("keydown", (e) => {
    if (storyViewer.hidden) return;

    if (e.key === "Escape") closeStoryViewer();
    if (e.key === "ArrowRight") advanceToNextStory();
    if (e.key === "ArrowLeft") goToPrevStory();
  });

  loadStories();
});
