document.addEventListener("DOMContentLoaded", () => {
  const conversationList = document.getElementById("conversationList");
  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");
  const chatBody = document.getElementById("chatBody");
  const messagesSearch = document.getElementById("messagesSearch");

  const chatUserName = document.getElementById("chatUserName");
  const chatUserStatus = document.getElementById("chatUserStatus");
  const chatUserAvatar = document.getElementById("chatUserAvatar");

  const attachBtn = document.getElementById("attachBtn");
  const mediaInput = document.getElementById("mediaInput");

  const emojiBtn = document.getElementById("emojiBtn");
  const emojiPicker = document.getElementById("emojiPicker");

  const callBtn = document.getElementById("callBtn");
  const videoBtn = document.getElementById("videoBtn");

  const callModal = document.getElementById("callModal");
  const callTitle = document.getElementById("callTitle");
  const callStatus = document.getElementById("callStatus");
  const endCallBtn = document.getElementById("endCallBtn");
  const localVideo = document.getElementById("localVideo");
  const remoteVideo = document.getElementById("remoteVideo");

  const socket = typeof io !== "undefined" ? io() : null;

  window.CURRENT_USER_ID = Number(
    document.getElementById("currentUserId")?.dataset.id || 0
  );

  let allFriends = [];
  let selectedFriendId = null;
  let selectedFriendName = "";
  let localStream = null;
  let peerConnection = null;
  let currentCallType = "audio";
  let currentRoom = null;
  let isEndingCall = false;

  const rtcConfig = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" }
    ]
  };

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text || "";
    return div.innerHTML;
  }

  function clearChat() {
    chatBody.innerHTML = `<div class="date-divider">Messages</div>`;
  }

  function makeRoomId(a, b) {
    return [String(a), String(b)].sort().join("_");
  }

  function showCallModal() {
    if (callModal) {
      callModal.classList.add("show");
    }
  }

  function hideCallModal() {
    if (callModal) {
      callModal.classList.remove("show");
    }
  }

  function buildMessageContent(msg) {
    if (msg.media_url) {
      if (msg.media_type === "image") {
        return `<img src="${msg.media_url}" class="chat-media-img" alt="upload">`;
      }

      if (msg.media_type === "video") {
        return `<video class="chat-media-video" controls src="${msg.media_url}"></video>`;
      }

      if (msg.media_type === "audio") {
        return `<audio class="chat-media-audio" controls src="${msg.media_url}"></audio>`;
      }

      return `<a class="message-file-link" href="${msg.media_url}" target="_blank">📎 ${escapeHtml(msg.file_name || "Open file")}</a>`;
    }

    return escapeHtml(msg.body || "");
  }

  function appendMessageRow(msg, isMe = true) {
    const row = document.createElement("div");
    row.className = `message-row ${isMe ? "me" : "them"}`;
    row.innerHTML = `
      <div>
        <div class="message-bubble">${buildMessageContent(msg)}</div>
        <div class="message-time">${escapeHtml(msg.time_only || "Now")}</div>
      </div>
    `;
    chatBody.appendChild(row);
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  function makeConversationItem(friend) {
    const item = document.createElement("div");
    item.className = "conversation-item";
    item.dataset.userId = String(friend.id);

    item.innerHTML = `
      <div class="conversation-avatar-wrap">
        <img src="${friend.avatar}" class="conversation-avatar" alt="${escapeHtml(friend.username)}">
      </div>

      <div class="conversation-meta">
        <div class="conversation-top">
          <div class="conversation-name">${escapeHtml(friend.username)}</div>
          <div class="conversation-time">${escapeHtml(friend.last_message_time || "")}</div>
        </div>
        <div class="conversation-preview">${escapeHtml(friend.last_message || "No messages yet")}</div>
      </div>

      ${friend.unread_count > 0 ? `<div class="conversation-badge">${friend.unread_count}</div>` : ""}
    `;

    item.addEventListener("click", () => openThread(friend.id));
    return item;
  }

  function renderFriendList(friends) {
    conversationList.innerHTML = "";

    if (!friends.length) {
      conversationList.innerHTML = `<div class="empty-state">No friends yet.</div>`;
      return;
    }

    friends.forEach(friend => {
      conversationList.appendChild(makeConversationItem(friend));
    });
  }

  async function loadFriends() {
    try {
      const res = await fetch("/api/messages/friends");
      const data = await res.json();

      if (!Array.isArray(data)) {
        conversationList.innerHTML = `<div class="empty-state">Could not load friends.</div>`;
        return;
      }

      allFriends = data;
      renderFriendList(allFriends);

      if (allFriends.length && !selectedFriendId) {
        openThread(allFriends[0].id);
      }
    } catch (err) {
      conversationList.innerHTML = `<div class="empty-state">Error loading friends.</div>`;
    }
  }

  async function openThread(friendId) {
    try {
      const res = await fetch(`/api/messages/thread/${friendId}`);
      const data = await res.json();

      if (!res.ok) {
        clearChat();
        chatUserName.textContent = "Messages";
        chatUserStatus.textContent = data.error || "Could not load chat";
        return;
      }

      selectedFriendId = friendId;
      selectedFriendName = data.friend.username || "";

      document.querySelectorAll(".conversation-item").forEach(item => {
        item.classList.toggle("active", item.dataset.userId === String(friendId));
      });

      chatUserName.textContent = data.friend.username;
      chatUserStatus.textContent = "Friend";
      chatUserAvatar.src = data.friend.avatar;

      clearChat();

      if (!data.messages.length) {
        const row = document.createElement("div");
        row.className = "message-row them";
        row.innerHTML = `
          <div>
            <div class="message-bubble">No messages yet. Say hi 👋</div>
            <div class="message-time">Now</div>
          </div>
        `;
        chatBody.appendChild(row);
      } else {
        data.messages.forEach(msg => {
          appendMessageRow(msg, !!msg.is_me);
        });
      }

      chatBody.scrollTop = chatBody.scrollHeight;
      await loadFriends();
    } catch (err) {
      clearChat();
      chatUserName.textContent = "Messages";
      chatUserStatus.textContent = "Error loading thread";
    }
  }

  async function sendMessage(text) {
    if (!selectedFriendId) return;

    const res = await fetch("/api/messages/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        friend_id: selectedFriendId,
        body: text
      })
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || "Could not send message");
      return;
    }

    const msg = data.message;
    appendMessageRow(msg, true);

    chatInput.value = "";
    await loadFriends();
  }

  if (chatForm) {
    chatForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = (chatInput.value || "").trim();
      if (!text) return;
      await sendMessage(text);
    });
  }

  if (messagesSearch) {
    messagesSearch.addEventListener("input", () => {
      const q = messagesSearch.value.trim().toLowerCase();

      const filtered = allFriends.filter(friend => {
        const name = (friend.username || "").toLowerCase();
        const preview = (friend.last_message || "").toLowerCase();
        return name.includes(q) || preview.includes(q);
      });

      renderFriendList(filtered);
    });
  }

  if (emojiBtn && emojiPicker) {
    emojiBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      emojiPicker.hidden = !emojiPicker.hidden;
    });

    emojiPicker.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => {
        chatInput.value += btn.textContent;
        chatInput.focus();
        emojiPicker.hidden = true;
      });
    });

    document.addEventListener("click", (e) => {
      if (
        !emojiPicker.hidden &&
        !emojiPicker.contains(e.target) &&
        e.target !== emojiBtn
      ) {
        emojiPicker.hidden = true;
      }
    });
  }

  if (attachBtn && mediaInput) {
    attachBtn.addEventListener("click", () => {
      if (!selectedFriendId) {
        alert("Pick a friend first.");
        return;
      }
      mediaInput.click();
    });

    mediaInput.addEventListener("change", async () => {
      const file = mediaInput.files[0];
      if (!file || !selectedFriendId) return;

      const formData = new FormData();
      formData.append("media", file);
      formData.append("friend_id", selectedFriendId);

      try {
        const res = await fetch("/api/messages/upload", {
          method: "POST",
          body: formData
        });

        const data = await res.json();

        if (!res.ok || !data.ok) {
          alert(data.error || "Upload failed");
          return;
        }

        appendMessageRow({
          media_url: data.url,
          media_type: data.kind,
          file_name: data.filename,
          time_only: data.time_only || "Now"
        }, true);

        mediaInput.value = "";
        await loadFriends();
      } catch (err) {
        alert("Upload failed");
      }
    });
  }

  async function createPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && currentRoom && socket) {
        socket.emit("ice_candidate", {
          room: currentRoom,
          candidate: event.candidate
        });
      }
    };

    peerConnection.ontrack = (event) => {
      if (remoteVideo) {
        remoteVideo.srcObject = event.streams[0];
      }
    };

    if (localStream) {
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });
    }
  }

  async function startCall(type) {
    if (!socket) {
      alert("Socket.IO is not loaded.");
      return;
    }

    if (!selectedFriendId) {
      alert("Pick a friend first.");
      return;
    }

    if (window.CURRENT_USER_ID <= 0) {
      alert("Missing CURRENT_USER_ID in page.");
      return;
    }

    currentCallType = type;
    currentRoom = makeRoomId(window.CURRENT_USER_ID, selectedFriendId);
    isEndingCall = false;

    showCallModal();

    if (callTitle) {
      callTitle.textContent = type === "video"
        ? `Video chat with ${selectedFriendName}`
        : `Call with ${selectedFriendName}`;
    }

    if (callStatus) {
      callStatus.textContent = "Starting...";
    }

    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: type === "video"
      });

      if (localVideo) {
        localVideo.srcObject = localStream;
      }

      await createPeerConnection();

      socket.emit("join_call_room", {
        room: currentRoom
      });

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      socket.emit("call_user", {
        room: currentRoom,
        target_user_id: selectedFriendId,
        caller_name: chatUserName.textContent || "Someone",
        type: type,
        offer: offer
      });

      if (callStatus) {
        callStatus.textContent = "Calling...";
      }
    } catch (err) {
      console.error(err);
      if (callStatus) {
        callStatus.textContent = "Could not start call.";
      }
    }
  }

  function endCall(emitToSocket = true) {
    if (isEndingCall) return;
    isEndingCall = true;

    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }

    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }

    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;

    hideCallModal();

    if (callStatus) {
      callStatus.textContent = "Ended";
    }

    if (emitToSocket && socket && currentRoom) {
      socket.emit("end_call", { room: currentRoom });
    }

    currentRoom = null;
    currentCallType = "audio";

    setTimeout(() => {
      isEndingCall = false;
    }, 100);
  }

  if (callBtn) {
    callBtn.addEventListener("click", () => startCall("audio"));
  }

  if (videoBtn) {
    videoBtn.addEventListener("click", () => startCall("video"));
  }

  if (endCallBtn) {
    endCallBtn.addEventListener("click", () => endCall(true));
  }

  if (callModal) {
    callModal.addEventListener("click", (e) => {
      if (e.target === callModal) {
        endCall(true);
      }
    });
  }

  if (socket) {
    socket.on("incoming_call", async (data) => {
      const accept = confirm(`${data.caller_name} is calling you. Accept?`);

      if (!accept) {
        socket.emit("reject_call", {
          room: data.room
        });
        return;
      }

      currentRoom = data.room;
      currentCallType = data.type;
      isEndingCall = false;

      showCallModal();

      if (callTitle) {
        callTitle.textContent = data.type === "video"
          ? "Incoming Video Chat"
          : "Incoming Call";
      }

      if (callStatus) {
        callStatus.textContent = "Connecting...";
      }

      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: data.type === "video"
        });

        if (localVideo) {
          localVideo.srcObject = localStream;
        }

        await createPeerConnection();
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socket.emit("answer_call", {
          room: data.room,
          answer: answer
        });

        if (callStatus) {
          callStatus.textContent = "Connected";
        }
      } catch (err) {
        console.error(err);
        if (callStatus) {
          callStatus.textContent = "Connection failed.";
        }
      }
    });

    socket.on("call_answered", async (data) => {
      try {
        if (!peerConnection) return;
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        if (callStatus) {
          callStatus.textContent = "Connected";
        }
      } catch (err) {
        console.error(err);
      }
    });

    socket.on("ice_candidate", async (data) => {
      try {
        if (peerConnection && data.candidate) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      } catch (err) {
        console.error(err);
      }
    });

    socket.on("call_rejected", () => {
      if (callStatus) {
        callStatus.textContent = "Call rejected.";
      }

      setTimeout(() => {
        endCall(false);
      }, 1000);
    });

    socket.on("call_ended", () => {
      endCall(false);
    });
  }

  loadFriends();
});