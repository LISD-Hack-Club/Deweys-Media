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
  const callSubtitle = document.getElementById("callSubtitle");
  const callStatus = document.getElementById("callStatus");
  const callAvatar = document.getElementById("callAvatar");
  const endCallBtn = document.getElementById("endCallBtn");
  const hangupBottomBtn = document.getElementById("hangupBottomBtn");
  const toggleMuteBtn = document.getElementById("toggleMuteBtn");
  const toggleCamBtn = document.getElementById("toggleCamBtn");
  const localVideo = document.getElementById("localVideo");
  const remoteVideo = document.getElementById("remoteVideo");

  const typingRow = document.getElementById("typingRow");
  const typingName = document.getElementById("typingName");

  const incomingCallPopup = document.getElementById("incomingCallPopup");
  const incomingCallAvatar = document.getElementById("incomingCallAvatar");
  const incomingCallName = document.getElementById("incomingCallName");
  const incomingCallType = document.getElementById("incomingCallType");
  const acceptIncomingCallBtn = document.getElementById("acceptIncomingCallBtn");
  const declineIncomingCallBtn = document.getElementById("declineIncomingCallBtn");

  let socket = null;


  const incomingCallRingtone = document.getElementById("incomingCallRingtone");

  const isMessagesPage =
    !!conversationList &&
    !!chatForm &&
    !!chatInput &&
    !!chatBody;


  window.CURRENT_USER_ID = Number(
    document.getElementById("currentUserId")?.dataset.id || 0
  );

  let allFriends = [];
  const params = new URLSearchParams(window.location.search);
  const openUserId = params.get("user");
  let selectedFriendId = null;
  let selectedFriendName = "";

  let localStream = null;
  let peerConnection = null;
  let currentCallType = "audio";
  let currentRoom = null;
  let currentCallPeerUserId = null;
  let isEndingCall = false;
  let isStartingCall = false;
  let typingStopTimer = null;
  let isMuted = false;
  let isCameraOff = false;
  let pendingIncomingCall = null;
  let pendingIceCandidates = [];
  let remoteStream = null;

  const rtcConfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  };

  function connectWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${protocol}://${window.location.host}/ws`);

    socket.onopen = () => {
      console.log("WebSocket connected");
      sendWs("join", {});
    };

    socket.onmessage = async (event) => {
      try {
        const packet = JSON.parse(event.data);
        const type = packet.event;
        const data = packet.data || {};

        if (type === "ws_ready") {
          console.log("WebSocket ready for user:", data.user_id);
        }

        else if (type === "incoming_message") {
          if (Number(data.from_user_id) === Number(selectedFriendId)) {
            appendMessageRow(data.message, false);
            await markThreadRead(selectedFriendId);
          }
          await loadFriends();
        }

        else if (type === "typing_start") {
          if (Number(data.from_user_id) === Number(selectedFriendId)) {
            showTypingIndicator(data.from_name || selectedFriendName || "Friend");
          }
        }

        else if (type === "typing_stop") {
          if (Number(data.from_user_id) === Number(selectedFriendId)) {
            hideTypingIndicator();
          }
        }

        else if (type === "messages_read") {
          if (Number(data.by_user_id) === Number(selectedFriendId)) {
            if (Array.isArray(data.message_ids) && data.message_ids.length) {
              data.message_ids.forEach((id) => updateMessageReceipt(id, "read"));
            } else {
              updateAllMyReceiptsToRead();
            }
          }
        }

        else if (type === "message_delivered") {
          if (data.message_id) {
            updateMessageReceipt(data.message_id, "delivered");
          }
        }

        else if (type === "incoming_call") {
          if (!data) return;

          if (Number(data.caller_id) === Number(window.CURRENT_USER_ID)) {
            console.log("Ignoring my own incoming_call event");
            return;
          }

          if (hasActiveCall() || isStartingCall) {
            sendWs("reject_call", {
              room: data.room,
              target_user_id: data.caller_id
            });
            return;
          }

          showIncomingCallPopup(data);
        }

        else if (type === "call_answered") {
          try {
            if (!peerConnection) {
              console.warn("Received answer but no peerConnection exists");
              return;
            }

            if (data?.room && currentRoom && data.room !== currentRoom) {
              console.warn("Ignoring answer for another room:", data.room);
              return;
            }

            if (peerConnection.signalingState !== "have-local-offer") {
              console.warn("Ignoring answer in wrong signaling state:", peerConnection.signalingState);
              return;
            }

            console.log("Call answered:", data.answer);

            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            await flushPendingIceCandidates();

            if (callStatus) callStatus.textContent = "Connected";
            if (callSubtitle) callSubtitle.textContent = "Live now";
          } catch (err) {
            console.error("Error setting remote answer:", err);
          }
        }

        else if (type === "ice_candidate") {
          try {
            console.log("ICE received from websocket:", data);

            if (data?.room && currentRoom && data.room !== currentRoom) {
              console.log("Ignoring ICE for another room");
              return;
            }

            if (!data.candidate) {
              console.log("No candidate in payload");
              return;
            }

            if (!peerConnection) {
              console.log("No peerConnection yet, queueing ICE");
              pendingIceCandidates.push(data.candidate);
              return;
            }

            if (!peerConnection.remoteDescription?.type) {
              console.log("Queueing ICE candidate until remoteDescription is set");
              pendingIceCandidates.push(data.candidate);
              return;
            }

            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            console.log("Added ICE candidate immediately");
          } catch (err) {
            console.error("Error adding ICE candidate:", err);
          }
        }

        else if (type === "call_rejected") {
          if (data?.room && currentRoom && data.room !== currentRoom) {
            console.log("Ignoring call_rejected for another room");
            return;
          }

          hideIncomingCallPopup();

          if (callStatus) callStatus.textContent = "Call rejected.";
          if (callSubtitle) callSubtitle.textContent = "They declined";

          setTimeout(() => {
            endCall(false);
          }, 800);
        }

        else if (type === "call_ended") {
          if (data?.room && currentRoom && data.room !== currentRoom) {
            console.log("Ignoring call_ended for another room");
            return;
          }

          hideIncomingCallPopup();
          endCall(false);
        }
      } catch (err) {
        console.error("WebSocket message error:", err);
      }
    };

    socket.onclose = () => {
      console.log("WebSocket closed, retrying...");
      setTimeout(connectWebSocket, 2000);
    };

    socket.onerror = (err) => {
      console.error("WebSocket error:", err);
    };
  }

  function sendWs(event, data = {}) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.warn("WebSocket not open. Event not sent:", event);
      return;
    }

    socket.send(JSON.stringify({ event, data }));
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text || "";
    return div.innerHTML;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function clearChat() {
    chatBody.innerHTML = `<div class="date-divider">Messages</div>`;
    hideTypingIndicator();
  }

  function makeRoomId(a, b) {
    return [String(a), String(b)].sort().join("_");
  }

  function getReceiptLabel(status) {
    const s = (status || "").toLowerCase();
    if (s === "read") return "Seen";
    if (s === "delivered") return "Delivered";
    return "Sent";
  }

  function getReceiptIcon(status) {
    const s = (status || "").toLowerCase();
    if (s === "read") return "✓✓";
    if (s === "delivered") return "✓✓";
    return "✓";
  }

  function showTypingIndicator(name = "Friend") {
    if (!typingRow || !typingName) return;
    typingName.textContent = name;
    typingRow.hidden = false;
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  function hideTypingIndicator() {
    if (!typingRow) return;
    typingRow.hidden = true;
  }

  function showCallModal() {
    if (callModal) callModal.classList.add("show");
  }

  function hideCallModal() {
    if (callModal) callModal.classList.remove("show");
  }

  function showIncomingCallPopup(data) {
    pendingIncomingCall = data || null;
    if (!incomingCallPopup || !pendingIncomingCall) return;

    if (incomingCallName) {
      incomingCallName.textContent = pendingIncomingCall.caller_name || "Someone";
    }

    if (incomingCallType) {
      incomingCallType.textContent =
        pendingIncomingCall.type === "video" ? "Video call" : "Audio call";
    }

    if (incomingCallAvatar) {
      incomingCallAvatar.src =
        pendingIncomingCall.caller_avatar || "/static/assets/imgs/avatar_placeholder.png";
    }

    incomingCallPopup.hidden = false;
  }

  function hideIncomingCallPopup() {
    pendingIncomingCall = null;
    if (incomingCallPopup) incomingCallPopup.hidden = true;
  }

  function updateCallControlButtons() {
    if (toggleMuteBtn) {
      toggleMuteBtn.textContent = isMuted ? "🔇" : "🎤";
      toggleMuteBtn.classList.toggle("off", isMuted);
    }

    if (toggleCamBtn) {
      toggleCamBtn.textContent = isCameraOff ? "🚫" : "📷";
      toggleCamBtn.classList.toggle("off", isCameraOff);
      toggleCamBtn.disabled = currentCallType !== "video";
    }
  }

  function setCallUi(name, avatar, type, subtitleText, statusText) {
    if (callTitle) {
      callTitle.textContent =
        type === "video" ? `Video chat with ${name}` : `Call with ${name}`;
    }

    if (callSubtitle) {
      callSubtitle.textContent = subtitleText || "Connecting...";
    }

    if (callStatus) {
      callStatus.textContent = statusText || "Ready";
    }

    if (callAvatar) {
      callAvatar.src = avatar || "/static/assets/imgs/avatar_placeholder.png";
    }

    updateCallControlButtons();
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

  function buildReceiptHtml(msg, isMe) {
    if (!isMe) return "";
    const status = msg.read_status || msg.status || "sent";

    return `
      <span class="read-receipt ${escapeHtml(String(status).toLowerCase())}" data-message-id="${msg.id || ""}">
        <span class="receipt-icon">${getReceiptIcon(status)}</span>
        <span class="receipt-label">${getReceiptLabel(status)}</span>
      </span>
    `;
  }

  function appendMessageRow(msg, isMe = true) {
    const row = document.createElement("div");
    row.className = `message-row ${isMe ? "me" : "them"}`;

    if (msg.id) {
      row.dataset.messageId = String(msg.id);
    }

    row.innerHTML = `
      <div class="message-stack">
        <div class="message-bubble">${buildMessageContent(msg)}</div>
        <div class="message-meta">
          <div class="message-time">${escapeHtml(msg.time_only || "Now")}</div>
          ${buildReceiptHtml(msg, isMe)}
        </div>
      </div>
    `;

    chatBody.appendChild(row);
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  function updateMessageReceipt(messageId, status) {
    if (!messageId) return;

    const receipt = document.querySelector(`.read-receipt[data-message-id="${messageId}"]`);
    if (!receipt) return;

    receipt.className = `read-receipt ${String(status || "sent").toLowerCase()}`;
    receipt.innerHTML = `
      <span class="receipt-icon">${getReceiptIcon(status)}</span>
      <span class="receipt-label">${getReceiptLabel(status)}</span>
    `;
  }

  function updateAllMyReceiptsToRead() {
    document.querySelectorAll(".message-row.me .read-receipt").forEach((receipt) => {
      const id = receipt.dataset.messageId;
      updateMessageReceipt(id, "read");
    });
  }

  function makeConversationItem(friend) {
    const item = document.createElement("div");
    item.className = "conversation-item";
    item.dataset.userId = String(friend.id);

    item.innerHTML = `
      <div class="conversation-avatar-wrap">
        <img src="${friend.avatar}" class="conversation-avatar" alt="${escapeHtml(friend.username)}">
        ${friend.is_online ? `<span class="online-dot"></span>` : ""}
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
    if (!conversationList) return;

    conversationList.innerHTML = "";

    if (!friends.length) {
      conversationList.innerHTML = `<div class="empty-state">No friends yet.</div>`;
      return;
    }

    friends.forEach((friend) => {
      conversationList.appendChild(makeConversationItem(friend));
    });
  }

  async function loadFriends() {
    try {
      const res = await fetch("/api/messages/friends");
      const data = await res.json();

      if (!Array.isArray(data)) {
        if (conversationList) {
          conversationList.innerHTML = `<div class="empty-state">Could not load friends.</div>`;
        }
        return;
      }

      allFriends = data;
      renderFriendList(allFriends);

    if (allFriends.length && !selectedFriendId) {
      if (openUserId) {
         openThread(Number(openUserId));
           } else {
         openThread(allFriends[0].id);
       }
     }
    } catch (err) {
      if (conversationList) {
        conversationList.innerHTML = `<div class="empty-state">Error loading friends.</div>`;
      }
    }
  }

  async function markThreadRead(friendId) {
    if (!friendId) return;

    try {
      const res = await fetch(`/api/messages/read/${friendId}`, {
        method: "POST"
      });

      const data = await res.json().catch(() => null);

      sendWs("messages_read", {
        friend_id: friendId,
        message_ids: Array.isArray(data?.message_ids) ? data.message_ids : []
      });
    } catch (err) {
      console.error("Could not mark as read", err);
    }
  }

  async function openThread(friendId) {
    try {
      const res = await fetch(`/api/messages/thread/${friendId}`);
      const data = await res.json();

      if (!res.ok) {
        clearChat();
        if (chatUserName) chatUserName.textContent = "Messages";
        if (chatUserStatus) chatUserStatus.textContent = data.error || "Could not load chat";
        return;
      }

      selectedFriendId = friendId;
      selectedFriendName = data.friend.username || "";

      document.querySelectorAll(".conversation-item").forEach((item) => {
        item.classList.toggle("active", item.dataset.userId === String(friendId));
      });

      if (chatUserName) chatUserName.textContent = data.friend.username;
      if (chatUserStatus) chatUserStatus.textContent = data.friend.is_online ? "Online" : "Friend";
      if (chatUserAvatar) chatUserAvatar.src = data.friend.avatar;

      clearChat();

      if (!data.messages.length) {
        const row = document.createElement("div");
        row.className = "message-row them";
        row.innerHTML = `
          <div class="message-stack">
            <div class="message-bubble">No messages yet. Say hi 👋</div>
            <div class="message-meta">
              <div class="message-time">Now</div>
            </div>
          </div>
        `;
        chatBody.appendChild(row);
      } else {
        data.messages.forEach((msg) => {
          appendMessageRow(msg, !!msg.is_me);
        });
      }

      chatBody.scrollTop = chatBody.scrollHeight;
      hideTypingIndicator();

      await markThreadRead(friendId);
      await loadFriends();
    } catch (err) {
      clearChat();
      if (chatUserName) chatUserName.textContent = "Messages";
      if (chatUserStatus) chatUserStatus.textContent = "Error loading thread";
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
    sendTypingStop();
    await loadFriends();
  }

  function sendTypingStart() {
    if (!selectedFriendId) return;
    sendWs("typing_start", { to_user_id: selectedFriendId });
  }

  function sendTypingStop() {
    if (!selectedFriendId) return;
    sendWs("typing_stop", { to_user_id: selectedFriendId });
  }

  function clearRemoteVideo() {
    remoteStream = null;

    if (!remoteVideo) return;

    try {
      remoteVideo.pause();
    } catch (e) {}

    remoteVideo.srcObject = null;
    remoteVideo.onloadedmetadata = null;
    remoteVideo.onplaying = null;
  }

  function clearLocalVideo() {
    if (localVideo) {
      try {
        localVideo.pause();
      } catch (e) {}
      localVideo.srcObject = null;
    }
  }

  function stopLocalStream() {
    if (!localStream) return;
    localStream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (e) {}
    });
    localStream = null;
  }

  function hasActiveCall() {
    return !!(
      peerConnection &&
      peerConnection.signalingState !== "closed" &&
      peerConnection.connectionState !== "closed"
    );
  }

  async function flushPendingIceCandidates() {
    if (!peerConnection || !peerConnection.remoteDescription?.type) return;
    if (!pendingIceCandidates.length) return;

    const queued = [...pendingIceCandidates];
    pendingIceCandidates = [];

    for (const candidate of queued) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log("Added queued ICE candidate");
      } catch (err) {
        console.error("Error adding queued ICE candidate:", err);
      }
    }
  }

  async function createPeerConnection() {
    if (peerConnection) {
      try {
        peerConnection.close();
      } catch (e) {}
      peerConnection = null;
    }

    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = (event) => {
      console.log("onicecandidate fired:", event.candidate);

      if (!event.candidate) {
        console.log("ICE gathering finished");
        return;
      }

      if (!currentCallPeerUserId) {
        console.log("ICE not sent: currentCallPeerUserId missing");
        return;
      }

      if (!currentRoom) {
        console.log("ICE not sent: currentRoom missing");
        return;
      }

      console.log("Sending ICE candidate to:", currentCallPeerUserId, "room:", currentRoom);

      sendWs("ice_candidate", {
        room: currentRoom,
        target_user_id: currentCallPeerUserId,
        candidate: event.candidate
      });
    };

    peerConnection.ontrack = async (event) => {
      console.log("ontrack fired:", event.track.kind);
      console.log("track enabled:", event.track.enabled);
      console.log("track muted:", event.track.muted);
      console.log("track readyState:", event.track.readyState);

      if (!remoteStream) {
        remoteStream = new MediaStream();
      }

      const alreadyHasTrack = remoteStream
        .getTracks()
        .some((t) => t.id === event.track.id);

      if (!alreadyHasTrack) {
        remoteStream.addTrack(event.track);
      }

      console.log(
        "Remote stream tracks now:",
        remoteStream.getTracks().map((t) => ({
          kind: t.kind,
          id: t.id,
          enabled: t.enabled,
          muted: t.muted,
          readyState: t.readyState
        }))
      );

      if (remoteVideo) {
        if (remoteVideo.srcObject !== remoteStream) {
          remoteVideo.srcObject = remoteStream;
        }

        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        remoteVideo.muted = false;
        remoteVideo.setAttribute("autoplay", "true");
        remoteVideo.setAttribute("playsinline", "true");

        remoteVideo.onloadedmetadata = async () => {
          console.log(
            "remoteVideo metadata loaded:",
            remoteVideo.videoWidth,
            remoteVideo.videoHeight,
            "client:",
            remoteVideo.clientWidth,
            remoteVideo.clientHeight
          );

          try {
            await remoteVideo.play();
            console.log("remoteVideo.play success after metadata");
          } catch (err) {
            console.log("remoteVideo.play failed after metadata:", err);
          }
        };

        try {
          await remoteVideo.play();
          console.log("remoteVideo.play success");
        } catch (err) {
          console.log("remoteVideo.play failed:", err);
        }
      }

      event.track.onunmute = async () => {
        console.log("Remote track unmuted:", event.track.kind);
        try {
          await remoteVideo?.play();
        } catch (err) {
          console.log("play after unmute failed:", err);
        }
      };

      event.track.onmute = () => {
        console.log("Remote track muted:", event.track.kind);
      };

      event.track.onended = () => {
        console.log("Remote track ended:", event.track.kind);
      };
    };

    peerConnection.onconnectionstatechange = () => {
      console.log("Peer connection state:", peerConnection?.connectionState);
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log("ICE connection state:", peerConnection?.iceConnectionState);
    };

    peerConnection.onicegatheringstatechange = () => {
      console.log("ICE gathering state:", peerConnection?.iceGatheringState);
    };

    peerConnection.onsignalingstatechange = () => {
      console.log("Signaling state:", peerConnection?.signalingState);
    };

    if (localStream) {
      localStream.getTracks().forEach((track) => {
        console.log(
          "Adding local track to peer connection:",
          track.kind,
          track.id,
          track.enabled,
          track.readyState
        );
        peerConnection.addTrack(track, localStream);
      });
    }
  }

  async function startCall(type) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      alert("WebSocket is not connected.");
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

    if (isStartingCall || hasActiveCall()) {
      console.log("Call blocked: already starting or active");
      return;
    }

    isStartingCall = true;
    currentCallType = type;
    currentRoom = makeRoomId(window.CURRENT_USER_ID, selectedFriendId);
    currentCallPeerUserId = selectedFriendId;
    isEndingCall = false;
    isMuted = false;
    isCameraOff = false;

    hideIncomingCallPopup();
    showCallModal();
    clearRemoteVideo();

    setCallUi(
      selectedFriendName,
      chatUserAvatar?.src || "/static/assets/imgs/avatar_placeholder.png",
      type,
      type === "video" ? "Starting video..." : "Starting call...",
      "Starting..."
    );

    try {
      stopLocalStream();

      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: type === "video"
      });

      console.log("Local stream tracks:", localStream.getTracks());
      console.log("LOCAL VIDEO TRACKS:", localStream.getVideoTracks());
      console.log("LOCAL AUDIO TRACKS:", localStream.getAudioTracks());

      if (localVideo) {
        localVideo.srcObject = localStream;
        localVideo.muted = true;
        localVideo.autoplay = true;
        localVideo.playsInline = true;
        localVideo.setAttribute("autoplay", "true");
        localVideo.setAttribute("playsinline", "true");
        localVideo.play().catch((err) => console.log("localVideo play blocked:", err));
      }

      await wait(150);
      await createPeerConnection();

      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: type === "video"
      });

      console.log("Created offer:", offer);

      await peerConnection.setLocalDescription(offer);

      sendWs("call_user", {
        room: currentRoom,
        target_user_id: selectedFriendId,
        type: type,
        caller_avatar: chatUserAvatar?.src || "",
        offer: peerConnection.localDescription
      });

      if (callStatus) callStatus.textContent = "Calling...";
      if (callSubtitle) callSubtitle.textContent = "Ringing...";
      updateCallControlButtons();
    } catch (err) {
      console.error("Could not start call:", err);
      if (callStatus) callStatus.textContent = "Could not start call.";
      if (callSubtitle) {
        callSubtitle.textContent = err?.message || "Microphone or camera unavailable";
      }
      endCall(false);
    } finally {
      isStartingCall = false;
    }
  }

  async function acceptIncomingCall(data) {
    if (!data) return;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      alert("WebSocket is not connected.");
      return;
    }

    if (isStartingCall || hasActiveCall()) {
      console.log("Accept blocked: already starting or active");
      return;
    }

    isStartingCall = true;
    currentRoom = data.room;
    currentCallType = data.type;
    currentCallPeerUserId = data.caller_id;
    isEndingCall = false;
    isMuted = false;
    isCameraOff = false;

    showCallModal();
    clearRemoteVideo();

    setCallUi(
      data.caller_name || "Someone",
      data.caller_avatar || "/static/assets/imgs/avatar_placeholder.png",
      data.type,
      data.type === "video" ? "Incoming video chat" : "Incoming call",
      "Connecting..."
    );

    try {
      stopLocalStream();

      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: data.type === "video"
      });

      console.log("Accepted call local stream tracks:", localStream.getTracks());
      console.log("LOCAL VIDEO TRACKS:", localStream.getVideoTracks());
      console.log("LOCAL AUDIO TRACKS:", localStream.getAudioTracks());

      if (localVideo) {
        localVideo.srcObject = localStream;
        localVideo.muted = true;
        localVideo.autoplay = true;
        localVideo.playsInline = true;
        localVideo.setAttribute("autoplay", "true");
        localVideo.setAttribute("playsinline", "true");
        localVideo.play().catch((err) => console.log("localVideo play blocked:", err));
      }

      await wait(150);
      await createPeerConnection();

      console.log("Setting remote description from offer:", data.offer);
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
      await flushPendingIceCandidates();

      const answer = await peerConnection.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: data.type === "video"
      });

      console.log("Created answer:", answer);

      await peerConnection.setLocalDescription(answer);

      sendWs("answer_call", {
        room: data.room,
        target_user_id: data.caller_id,
        answer: peerConnection.localDescription
      });

      if (callStatus) callStatus.textContent = "Connected";
      if (callSubtitle) callSubtitle.textContent = "Live now";
      updateCallControlButtons();
    } catch (err) {
      console.error("Connection failed:", err);
      if (callStatus) callStatus.textContent = "Connection failed.";
      if (callSubtitle) callSubtitle.textContent = err?.message || "Could not connect";
      endCall(false);
    } finally {
      isStartingCall = false;
    }
  }

  function endCall(emitToSocket = true) {
    if (isEndingCall) return;
    isEndingCall = true;

    hideIncomingCallPopup();

    if (peerConnection) {
      try {
        peerConnection.onicecandidate = null;
        peerConnection.ontrack = null;
        peerConnection.onconnectionstatechange = null;
        peerConnection.oniceconnectionstatechange = null;
        peerConnection.onicegatheringstatechange = null;
        peerConnection.onsignalingstatechange = null;
        peerConnection.close();
      } catch (e) {}
      peerConnection = null;
    }

    stopLocalStream();
    clearLocalVideo();
    clearRemoteVideo();

    hideCallModal();

    if (callStatus) callStatus.textContent = "Ended";
    if (callSubtitle) callSubtitle.textContent = "Call ended";

    if (emitToSocket && currentRoom && currentCallPeerUserId) {
      sendWs("end_call", {
        room: currentRoom,
        target_user_id: currentCallPeerUserId
      });
    }

    currentRoom = null;
    currentCallType = "audio";
    currentCallPeerUserId = null;
    isMuted = false;
    isCameraOff = false;
    pendingIceCandidates = [];
    isStartingCall = false;
    updateCallControlButtons();

    setTimeout(() => {
      isEndingCall = false;
    }, 150);
  }

  function toggleMute() {
    if (!localStream) return;
    const audioTracks = localStream.getAudioTracks();
    if (!audioTracks.length) return;

    isMuted = !isMuted;
    audioTracks.forEach((track) => {
      track.enabled = !isMuted;
    });

    updateCallControlButtons();
  }

  function toggleCamera() {
    if (!localStream || currentCallType !== "video") return;
    const videoTracks = localStream.getVideoTracks();
    if (!videoTracks.length) return;

    isCameraOff = !isCameraOff;
    videoTracks.forEach((track) => {
      track.enabled = !isCameraOff;
    });

    updateCallControlButtons();
  }

  if (chatForm) {
    chatForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = (chatInput.value || "").trim();
      if (!text) return;
      await sendMessage(text);
    });
  }

  if (chatInput) {
    chatInput.addEventListener("input", () => {
      if (!selectedFriendId) return;

      const value = chatInput.value.trim();

      if (value) {
        sendTypingStart();

        clearTimeout(typingStopTimer);
        typingStopTimer = setTimeout(() => {
          sendTypingStop();
        }, 1200);
      } else {
        clearTimeout(typingStopTimer);
        sendTypingStop();
      }
    });

    chatInput.addEventListener("blur", () => {
      clearTimeout(typingStopTimer);
      sendTypingStop();
    });
  }

  if (messagesSearch) {
    messagesSearch.addEventListener("input", () => {
      const q = messagesSearch.value.trim().toLowerCase();

      const filtered = allFriends.filter((friend) => {
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

    emojiPicker.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        chatInput.value += btn.textContent;
        chatInput.focus();
        emojiPicker.hidden = true;
      });
    });

    document.addEventListener("click", (e) => {
      if (!emojiPicker.hidden && !emojiPicker.contains(e.target) && e.target !== emojiBtn) {
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

        const payload = data.message || {
          id: data.message_id || "",
          media_url: data.url,
          media_type: data.kind,
          file_name: data.filename,
          time_only: data.time_only || "Now",
          read_status: "sent"
        };

        appendMessageRow(payload, true);
        mediaInput.value = "";
        await loadFriends();
      } catch (err) {
        alert("Upload failed");
      }
    });
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

  if (hangupBottomBtn) {
    hangupBottomBtn.addEventListener("click", () => endCall(true));
  }

  if (toggleMuteBtn) {
    toggleMuteBtn.addEventListener("click", toggleMute);
  }

  if (toggleCamBtn) {
    toggleCamBtn.addEventListener("click", toggleCamera);
  }

  if (declineIncomingCallBtn) {
    declineIncomingCallBtn.addEventListener("click", () => {
      if (!pendingIncomingCall) return;

      sendWs("reject_call", {
        room: pendingIncomingCall.room,
        target_user_id: pendingIncomingCall.caller_id
      });

      hideIncomingCallPopup();
    });
  }

  if (acceptIncomingCallBtn) {
    acceptIncomingCallBtn.addEventListener("click", async () => {
      if (!pendingIncomingCall) return;

      const data = pendingIncomingCall;
      hideIncomingCallPopup();
      await acceptIncomingCall(data);
    });
  }

  if (callModal) {
    callModal.addEventListener("click", (e) => {
      if (e.target === callModal) {
        endCall(true);
      }
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && selectedFriendId) {
      markThreadRead(selectedFriendId);
    }
  });

  setInterval(() => {
    if (remoteVideo) {
      console.log("remoteVideo debug:", {
        hasSrcObject: !!remoteVideo.srcObject,
        readyState: remoteVideo.readyState,
        paused: remoteVideo.paused,
        currentTime: remoteVideo.currentTime,
        videoWidth: remoteVideo.videoWidth,
        videoHeight: remoteVideo.videoHeight,
        clientWidth: remoteVideo.clientWidth,
        clientHeight: remoteVideo.clientHeight
      });
    }
  }, 2000);

  connectWebSocket();
  loadFriends();
});