/* ============================================================
 * Ripple · 실시간 채팅
 * 서버리스 실시간 채팅: 공개 MQTT 브로커(WebSocket) 사용
 * 메시지는 어디에도 저장되지 않습니다.
 * ============================================================ */

(() => {
  "use strict";

  // ---------- 설정 ----------
  const BROKER_URL = "wss://broker.emqx.io:8084/mqtt";
  const TOPIC_PREFIX = "ripple-chat/v1";
  const PRESENCE_INTERVAL = 8000;   // 하트비트 주기(ms)
  const PRESENCE_TIMEOUT = 20000;   // 이 시간 이상 응답 없으면 오프라인 처리
  const TYPING_TIMEOUT = 3000;

  // ---------- 상태 ----------
  const state = {
    client: null,
    nickname: "",
    room: "",
    userId: Math.random().toString(36).slice(2, 10),
    soundOn: true,
    peers: new Map(),          // userId -> { name, color, lastSeen }
    typingUsers: new Map(),    // userId -> { name, timer }
    lastSender: null,
    typingSentAt: 0,
  };

  // ---------- DOM ----------
  const $ = (sel) => document.querySelector(sel);
  const joinScreen = $("#join-screen");
  const chatScreen = $("#chat-screen");
  const joinForm = $("#join-form");
  const nicknameInput = $("#nickname-input");
  const roomInput = $("#room-input");
  const avatarBubble = $("#avatar-bubble");
  const avatarName = $("#avatar-name");
  const messagesEl = $("#messages");
  const messageInput = $("#message-input");
  const sendBtn = $("#send-btn");
  const roomTitle = $("#room-title");
  const presenceText = $("#presence-text");
  const connDot = $("#conn-dot");
  const typingIndicator = $("#typing-indicator");
  const typingText = $("#typing-text");
  const toastEl = $("#toast");

  // ---------- 유틸 ----------
  const AVATAR_COLORS = [
    "#ff6b6b", "#f59e0b", "#fbbf24", "#34d399", "#22d3ee",
    "#60a5fa", "#818cf8", "#a78bfa", "#e879f9", "#fb7185",
    "#2dd4bf", "#4ade80",
  ];

  function colorFor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  }

  function initialOf(name) {
    const trimmed = (name || "?").trim();
    return trimmed ? [...trimmed][0].toUpperCase() : "?";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // URL 자동 링크 처리 (escape 후 적용)
  function linkify(escaped) {
    return escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;">${url}</a>`
    );
  }

  function timeNow() {
    return new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  }

  function topic(kind) {
    return `${TOPIC_PREFIX}/${encodeURIComponent(state.room)}/${kind}`;
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove("hidden");
    requestAnimationFrame(() => toastEl.classList.add("show"));
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      toastEl.classList.remove("show");
      setTimeout(() => toastEl.classList.add("hidden"), 280);
    }, 2200);
  }

  function scrollToBottom(force) {
    const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 160;
    if (force || nearBottom) {
      requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; });
    }
  }

  // ---------- 알림음 (WebAudio, 외부 파일 불필요) ----------
  let audioCtx = null;
  function beep() {
    if (!state.soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(660, t);
      osc.frequency.exponentialRampToValueAtTime(880, t + 0.08);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.start(t); osc.stop(t + 0.24);
    } catch (_) { /* 무시 */ }
  }

  // ---------- 입장 화면 미리보기 ----------
  function updateAvatarPreview() {
    const name = nicknameInput.value.trim();
    avatarBubble.textContent = initialOf(name);
    avatarBubble.style.background = name ? colorFor(name) : "#444";
    avatarName.textContent = name || "미리보기";
  }
  nicknameInput.addEventListener("input", updateAvatarPreview);

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      roomInput.value = chip.dataset.room;
      nicknameInput.focus();
    });
  });

  // URL ?room= 자동 채우기
  const params = new URLSearchParams(location.search);
  if (params.get("room")) roomInput.value = params.get("room");
  // 저장된 닉네임 복원
  try {
    const saved = localStorage.getItem("ripple_nick");
    if (saved) { nicknameInput.value = saved; updateAvatarPreview(); }
  } catch (_) {}

  // ---------- 입장 ----------
  joinForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const nick = nicknameInput.value.trim();
    const room = roomInput.value.trim();
    if (!nick || !room) return;

    state.nickname = nick;
    state.room = room;
    try { localStorage.setItem("ripple_nick", nick); } catch (_) {}

    connect();
  });

  // ---------- MQTT 연결 ----------
  function connect() {
    joinScreen.classList.add("hidden");
    chatScreen.classList.remove("hidden");
    roomTitle.textContent = "# " + state.room;
    messageInput.focus();
    setConn("connecting");
    renderEmptyState();

    const willPayload = JSON.stringify({
      type: "leave", id: state.userId, name: state.nickname,
    });

    state.client = mqtt.connect(BROKER_URL, {
      clientId: "ripple_" + state.userId + "_" + Date.now().toString(36),
      clean: true,
      reconnectPeriod: 2500,
      connectTimeout: 12000,
      keepalive: 30,
      will: {
        topic: topic("presence"),
        payload: willPayload,
        qos: 0,
        retain: false,
      },
    });

    state.client.on("connect", () => {
      setConn("online");
      state.client.subscribe([topic("msg"), topic("presence"), topic("typing")], { qos: 0 });
      announce("join");
      sendHeartbeat();
    });

    state.client.on("reconnect", () => setConn("connecting"));
    state.client.on("close", () => setConn("offline"));
    state.client.on("error", (err) => {
      console.error("MQTT error:", err);
      setConn("offline");
    });

    state.client.on("message", (t, payload) => {
      let data;
      try { data = JSON.parse(payload.toString()); } catch (_) { return; }
      if (t === topic("msg")) onChatMessage(data);
      else if (t === topic("presence")) onPresence(data);
      else if (t === topic("typing")) onTyping(data);
    });

    // 하트비트 + 정리 루프
    clearInterval(state._hb);
    state._hb = setInterval(() => {
      sendHeartbeat();
      prunePeers();
    }, PRESENCE_INTERVAL);
  }

  function setConn(status) {
    connDot.className = "dot " + (status === "online" ? "online" : status === "offline" ? "offline" : "");
    if (status === "online") updatePresenceText();
    else if (status === "connecting") presenceText.textContent = "연결 중…";
    else presenceText.textContent = "연결 끊김 · 재연결 시도 중";
  }

  // ---------- 발신 ----------
  function publish(kind, obj) {
    if (!state.client || !state.client.connected) return;
    state.client.publish(topic(kind), JSON.stringify(obj), { qos: 0 });
  }

  function announce(type) {
    publish("presence", { type, id: state.userId, name: state.nickname });
  }

  function sendHeartbeat() {
    publish("presence", { type: "heartbeat", id: state.userId, name: state.nickname });
  }

  function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;
    const msg = {
      type: "msg",
      id: state.userId,
      name: state.nickname,
      text,
      ts: Date.now(),
    };
    publish("msg", msg);
    renderMessage(msg, true);
    messageInput.value = "";
    sendBtn.disabled = true;
    publish("typing", { type: "stop", id: state.userId, name: state.nickname });
  }

  sendBtn.addEventListener("click", sendMessage);
  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  messageInput.addEventListener("input", () => {
    sendBtn.disabled = !messageInput.value.trim();
    const now = Date.now();
    if (now - state.typingSentAt > 1500) {
      state.typingSentAt = now;
      publish("typing", { type: "start", id: state.userId, name: state.nickname });
    }
  });
  sendBtn.disabled = true;

  // ---------- 수신: 메시지 ----------
  function onChatMessage(data) {
    if (data.id === state.userId) return; // 내 메시지는 이미 렌더됨
    // 새 사용자면 presence에 등록
    if (!state.peers.has(data.id)) {
      state.peers.set(data.id, { name: data.name, color: colorFor(data.name), lastSeen: Date.now() });
      updatePresenceText();
    }
    renderMessage(data, false);
    beep();
  }

  // ---------- 수신: 접속 상태 ----------
  function onPresence(data) {
    if (data.id === state.userId) return;
    if (data.type === "leave") {
      if (state.peers.has(data.id)) {
        state.peers.delete(data.id);
        renderSystem(`${data.name || "누군가"}님이 나갔어요`);
        updatePresenceText();
      }
      return;
    }
    // join / heartbeat
    const isNew = !state.peers.has(data.id);
    state.peers.set(data.id, { name: data.name, color: colorFor(data.name), lastSeen: Date.now() });
    if (isNew) {
      renderSystem(`${data.name}님이 들어왔어요 👋`);
      // 새로 들어온 사람에게 내 존재를 즉시 알림
      announce("join");
    }
    updatePresenceText();
  }

  function prunePeers() {
    const now = Date.now();
    let changed = false;
    for (const [id, p] of state.peers) {
      if (now - p.lastSeen > PRESENCE_TIMEOUT) { state.peers.delete(id); changed = true; }
    }
    if (changed) updatePresenceText();
  }

  function updatePresenceText() {
    const count = state.peers.size + 1; // 나 포함
    presenceText.textContent = `${count}명 접속 중`;
  }

  // ---------- 수신: 타이핑 ----------
  function onTyping(data) {
    if (data.id === state.userId) return;
    if (data.type === "stop") {
      const entry = state.typingUsers.get(data.id);
      if (entry) clearTimeout(entry.timer);
      state.typingUsers.delete(data.id);
    } else {
      const existing = state.typingUsers.get(data.id);
      if (existing) clearTimeout(existing.timer);
      const timer = setTimeout(() => {
        state.typingUsers.delete(data.id);
        renderTyping();
      }, TYPING_TIMEOUT);
      state.typingUsers.set(data.id, { name: data.name, timer });
    }
    renderTyping();
  }

  function renderTyping() {
    const names = [...state.typingUsers.values()].map((u) => u.name);
    if (names.length === 0) {
      typingIndicator.classList.add("hidden");
      return;
    }
    let text;
    if (names.length === 1) text = `${names[0]}님이 입력 중…`;
    else if (names.length === 2) text = `${names[0]}, ${names[1]}님이 입력 중…`;
    else text = `${names.length}명이 입력 중…`;
    typingText.textContent = text;
    typingIndicator.classList.remove("hidden");
  }

  // ---------- 렌더링 ----------
  function renderEmptyState() {
    messagesEl.innerHTML = `
      <div class="empty-state" id="empty-state">
        <div class="big">🌊</div>
        <p><strong>${escapeHtml(state.room)}</strong> 방에 입장했어요.<br/>
        첫 메시지를 남겨보세요!<br/>
        <span style="font-size:12px;opacity:.7">상단 공유 버튼으로 친구를 초대할 수 있어요.</span></p>
      </div>`;
  }

  function clearEmptyState() {
    const es = $("#empty-state");
    if (es) es.remove();
  }

  function renderMessage(data, isMe) {
    clearEmptyState();
    const grouped = state.lastSender === (isMe ? "me" : data.id);
    state.lastSender = isMe ? "me" : data.id;

    const row = document.createElement("div");
    row.className = "msg-row " + (isMe ? "me" : "") + (grouped ? " grouped" : "");

    const color = isMe ? colorFor(state.nickname) : colorFor(data.name);

    const avatar = document.createElement("div");
    if (grouped) {
      avatar.className = "msg-avatar spacer";
    } else {
      avatar.className = "msg-avatar";
      avatar.style.background = color;
      avatar.textContent = initialOf(data.name);
    }

    const body = document.createElement("div");
    body.className = "msg-body";

    const inner = [];
    if (!isMe && !grouped) inner.push(`<div class="msg-name">${escapeHtml(data.name)}</div>`);
    inner.push(`<div class="bubble">${linkify(escapeHtml(data.text))}</div>`);
    inner.push(`<div class="msg-time">${timeNow()}</div>`);
    body.innerHTML = inner.join("");

    row.appendChild(avatar);
    row.appendChild(body);
    messagesEl.appendChild(row);
    scrollToBottom(isMe);
  }

  function renderSystem(text) {
    clearEmptyState();
    state.lastSender = null;
    const el = document.createElement("div");
    el.className = "sys-msg";
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom(false);
  }

  // ---------- 헤더 액션 ----------
  $("#leave-btn").addEventListener("click", () => {
    if (state.client) {
      announce("leave");
      setTimeout(() => { try { state.client.end(true); } catch (_) {} }, 120);
    }
    clearInterval(state._hb);
    state.peers.clear();
    state.typingUsers.clear();
    state.lastSender = null;
    chatScreen.classList.add("hidden");
    joinScreen.classList.remove("hidden");
    messagesEl.innerHTML = "";
  });

  function inviteUrl() {
    return `${location.origin}${location.pathname}?room=${encodeURIComponent(state.room)}`;
  }
  function inviteMessage() {
    return `💬 '${state.room}' 방에서 같이 떠들어요!\n가입 없이 클릭하면 바로 입장 👇\n${inviteUrl()}`;
  }

  async function copyText(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg);
    } catch (_) {
      prompt("복사해서 붙여넣으세요:", text);
    }
  }

  const shareModal = $("#share-modal");
  function openShareModal() {
    const url = inviteUrl();
    $("#share-room-name").textContent = `'${state.room}'`;
    $("#share-link-input").value = url;
    $("#invite-text").value = inviteMessage();
    // QR 코드 (외부 QR 렌더 API, 브라우저에서 직접 호출)
    $("#qr-img").src = "https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=0&data=" + encodeURIComponent(url);
    shareModal.classList.remove("hidden");
  }
  function closeShareModal() { shareModal.classList.add("hidden"); }

  $("#share-btn").addEventListener("click", openShareModal);
  $("#share-close").addEventListener("click", closeShareModal);
  shareModal.addEventListener("click", (e) => { if (e.target === shareModal) closeShareModal(); });

  $("#copy-link-btn").addEventListener("click", () => copyText(inviteUrl(), "초대 링크를 복사했어요 🔗"));
  $("#copy-msg-btn").addEventListener("click", () => copyText(inviteMessage(), "초대 멘트를 복사했어요 ✏️"));

  document.querySelectorAll(".share-target").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const net = btn.dataset.net;
      const url = inviteUrl();
      const msg = inviteMessage();
      if (net === "x") {
        window.open("https://twitter.com/intent/tweet?text=" + encodeURIComponent(msg), "_blank", "noopener");
      } else if (net === "telegram") {
        window.open("https://t.me/share/url?url=" + encodeURIComponent(url) + "&text=" + encodeURIComponent(`'${state.room}' 방에서 같이 떠들어요!`), "_blank", "noopener");
      } else if (net === "kakao") {
        // 카카오 SDK 없이: 멘트 복사 후 카톡에 붙여넣도록 안내
        await copyText(msg, "초대 멘트 복사 완료! 카톡에 붙여넣으세요 💛");
      } else { // more → 네이티브 공유 시트
        if (navigator.share) {
          try { await navigator.share({ title: "Ripple 채팅 초대", text: msg, url }); } catch (_) {}
        } else {
          await copyText(msg, "초대 멘트를 복사했어요 ✏️");
        }
      }
    });
  });

  const soundBtn = $("#sound-btn");
  soundBtn.addEventListener("click", () => {
    state.soundOn = !state.soundOn;
    $("#sound-on").classList.toggle("hidden", !state.soundOn);
    $("#sound-off").classList.toggle("hidden", state.soundOn);
    if (state.soundOn) beep();
    toast(state.soundOn ? "알림음 켜짐 🔔" : "알림음 꺼짐 🔕");
  });

  // ---------- 이모지 패널 ----------
  const EMOJIS = ["😀","😂","🥹","😊","😍","😎","🤩","🥳","😅","😭","😡","🤔","👍","👏","🙏","🔥","💯","✨","🎉","❤️","💜","💙","💚","😴","🤯","😱","🙄","😬","🤝","👀","🫶","🙌","💀","🤣","😏","😇","🥰","😘","🤗","🫡"];
  const emojiPanel = $("#emoji-panel");
  emojiPanel.innerHTML = EMOJIS.map((e) => `<button type="button">${e}</button>`).join("");
  emojiPanel.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      messageInput.value += b.textContent;
      messageInput.focus();
      sendBtn.disabled = !messageInput.value.trim();
    });
  });
  $("#emoji-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    emojiPanel.classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!emojiPanel.contains(e.target) && e.target.id !== "emoji-btn") {
      emojiPanel.classList.add("hidden");
    }
  });

  // ---------- 페이지 종료 시 정리 ----------
  window.addEventListener("beforeunload", () => {
    if (state.client && state.client.connected) announce("leave");
  });

  updateAvatarPreview();
})();
