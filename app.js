/* ============================================================
 * 블러챗(BlurChat) · 랜덤 1:1 채팅
 * - 서버리스 매칭: 공개 MQTT 브로커(WebSocket) 위에서 로비/핸드셰이크
 * - 음성 메시지: MediaRecorder → MQTT 전송 → 재생
 * - 접속자 수: 관리자(?admin=KEY)만 보는 플로팅 배지
 * 메시지는 어디에도 저장되지 않습니다.
 * ============================================================ */
(() => {
  "use strict";

  // ---------- 설정 ----------
  const BROKER_URL = "wss://broker.emqx.io:8084/mqtt";
  const P = "ripple-chat/v2";
  const ADMIN_KEY = "ripple-admin-2026";   // ⚠️ 운영 시 반드시 변경하세요
  const ONLINE_INTERVAL = 6000;            // 전역 접속 하트비트
  const ONLINE_TIMEOUT = 15000;
  const WAIT_INTERVAL = 1500;              // 로비 대기 announce 주기
  const WAIT_TIMEOUT = 4500;               // 이 시간 지난 대기자는 제외
  const INVITE_TIMEOUT = 3000;             // 초대 응답 대기
  const TYPING_TIMEOUT = 3000;
  const VOICE_MAX_BYTES = 200 * 1024;      // 음성 최대 크기(약 200KB)
  const VOICE_MAX_SEC = 60;
  const PAIR_PING_INTERVAL = 4000;         // 대화 중 생존 핑 주기
  const PAIR_TIMEOUT = 14000;              // 핑이 이 시간 끊기면 상대 나감 처리

  // ---------- 상태 ----------
  const ST = { IDLE: "idle", SEARCHING: "searching", INVITING: "inviting", CHATTING: "chatting" };
  const state = {
    client: null,
    nickname: "익명",
    id: Math.random().toString(36).slice(2, 10),
    soundOn: true,
    phase: ST.IDLE,
    partnerId: null,
    partnerName: "상대방",
    partnerLastSeen: 0,        // 상대 마지막 신호 시각 (이탈 감지)
    pairTopic: null,
    pendingInvite: null,       // { to, room, timer }
    waiting: new Map(),        // id -> { name, lastSeen }
    blocked: new Set(),        // 이번 세션 동안 차단한 상대 id (새로고침 시 초기화)
    online: new Map(),         // id -> { st, lastSeen }  (관리자용)
    typingTimer: null,
    lastSender: null,
    typingSentAt: 0,
    isAdmin: false,
    sendTimes: [],     // 최근 전송 시각 (도배 방지)
    recvTimes: [],     // 최근 수신 시각 (폭주 방어)
    lastText: "",
    repeat: 0,
    connected: null,   // MQTT 연결 상태
  };

  // ---------- DOM ----------
  const $ = (s) => document.querySelector(s);
  const startScreen = $("#start-screen");
  const searchScreen = $("#search-screen");
  const chatScreen = $("#chat-screen");
  const startForm = $("#start-form");
  const nicknameInput = $("#nickname-input");
  const avatarBubble = $("#avatar-bubble");
  const avatarName = $("#avatar-name");
  const messagesEl = $("#messages");
  const messageInput = $("#message-input");
  const sendBtn = $("#send-btn");
  const micBtn = $("#mic-btn");
  const partnerTitle = $("#partner-title");
  const presenceText = $("#presence-text");
  const connDot = $("#conn-dot");
  const typingIndicator = $("#typing-indicator");
  const toastEl = $("#toast");
  const leftOverlay = $("#left-overlay");
  const recordingBar = $("#recording-bar");
  const recTime = $("#rec-time");
  const composer = $("#composer");

  // ---------- 유틸 ----------
  const COLORS = ["#ff6b6b","#f59e0b","#fbbf24","#34d399","#22d3ee","#60a5fa","#818cf8","#a78bfa","#e879f9","#fb7185","#2dd4bf","#4ade80"];
  function colorFor(name) {
    let h = 0; for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
    return COLORS[Math.abs(h) % COLORS.length];
  }
  function initialOf(name) { const t = (name || "?").trim(); return t ? [...t][0].toUpperCase() : "?"; }
  function escapeHtml(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
  function linkify(e) { return e.replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;">${u}</a>`); }
  function timeNow() { return new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }); }
  // 금칙어 필터 (badwords.js). 로드 실패 시 원문 그대로 통과.
  function clean(text) {
    try { return window.RippleFilter ? window.RippleFilter.filter(text) : { text, hit: false }; }
    catch (_) { return { text, hit: false }; }
  }
  const inbox = (id) => `${P}/u/${id}`;
  const LOBBY = `${P}/lobby`;
  const ONLINE = `${P}/online`;
  const pairTopicOf = (room) => `${P}/p/${room}`;
  const roomIdOf = (a, b) => [a, b].sort().join("_");

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove("hidden");
    requestAnimationFrame(() => toastEl.classList.add("show"));
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toastEl.classList.remove("show"); setTimeout(() => toastEl.classList.add("hidden"), 280); }, 2400);
  }
  function scrollToBottom(force) {
    const near = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 160;
    if (force || near) requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; });
  }

  // ---------- 알림음 ----------
  let audioCtx = null;
  function beep() {
    if (!state.soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime, osc = audioCtx.createOscillator(), g = audioCtx.createGain();
      osc.connect(g); g.connect(audioCtx.destination); osc.type = "sine";
      osc.frequency.setValueAtTime(660, t); osc.frequency.exponentialRampToValueAtTime(880, t + 0.08);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.start(t); osc.stop(t + 0.24);
    } catch (_) {}
  }

  // ---------- 골든아워(매칭 피크 타임) ----------
  // 분 단위(자정 기준) 피크 구간. 운영하며 실제 트래픽에 맞춰 조정하세요.
  const PEAKS = [
    { start: 12 * 60, end: 13 * 60 },   // 점심 12:00~13:00
    { start: 21 * 60, end: 24 * 60 },   // 야간 21:00~24:00
  ];
  function pad2(n) { return String(n).padStart(2, "0"); }
  function hhmm(min) { return pad2(Math.floor(min / 60) % 24) + ":" + pad2(min % 60); }
  function updateGoldenHour() {
    const el = $("#golden-hour");
    if (!el) return;
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    // 현재 피크 안인가?
    for (const p of PEAKS) {
      if (mins >= p.start && mins < p.end) {
        el.classList.remove("hidden"); el.classList.add("active");
        el.innerHTML = `🔥 <b>지금 매칭 피크 타임!</b> 평소보다 사람이 많아요 (~${hhmm(p.end)})`;
        return;
      }
    }
    // 다음 피크 시각 계산
    let nextStart = null;
    for (const p of PEAKS) if (p.start > mins) { nextStart = p.start; break; }
    const target = new Date(now);
    if (nextStart === null) { target.setDate(target.getDate() + 1); nextStart = PEAKS[0].start; }
    target.setHours(Math.floor(nextStart / 60), nextStart % 60, 0, 0);
    let diff = Math.max(0, Math.floor((target - now) / 1000));
    const h = Math.floor(diff / 3600), m = Math.floor((diff % 3600) / 60), s = diff % 60;
    el.classList.remove("hidden", "active");
    el.innerHTML = `⏰ 다음 매칭 피크 <b>${hhmm(nextStart)}</b> 까지 <b>${pad2(h)}:${pad2(m)}:${pad2(s)}</b>`;
  }

  // ---------- 백그라운드 대기: 매칭 알림 ----------
  const ORIG_TITLE = document.title;
  let titleBlink = null;
  function startTitleAlert(msg) {
    if (titleBlink) return;
    let on = false;
    titleBlink = setInterval(() => { document.title = on ? ORIG_TITLE : msg; on = !on; }, 900);
  }
  function stopTitleAlert() { if (titleBlink) { clearInterval(titleBlink); titleBlink = null; } document.title = ORIG_TITLE; }
  window.addEventListener("focus", stopTitleAlert);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) stopTitleAlert(); });

  function notifyMatch() {
    beep();
    const away = document.hidden || (document.hasFocus && !document.hasFocus());
    if (!away) return;
    startTitleAlert("💬 상대 연결됨!");
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        const n = new Notification("블러챗 · 매칭 완료", {
          body: "상대를 찾았어요! 들어와서 대화하세요 👋", icon: "icon-192.png", tag: "ripple-match",
        });
        n.onclick = () => { window.focus(); stopTitleAlert(); n.close(); };
      }
    } catch (_) {}
  }

  // ---------- 시작 화면 미리보기 ----------
  function curNick() { return (nicknameInput.value.trim() || "익명"); }
  function updatePreview() {
    const n = curNick();
    avatarBubble.textContent = initialOf(n);
    avatarBubble.style.background = colorFor(n);
    avatarName.textContent = n;
  }
  nicknameInput.addEventListener("input", updatePreview);
  try { const s = localStorage.getItem("ripple_nick"); if (s) nicknameInput.value = s; } catch (_) {}
  updatePreview();

  // ---------- 화면 전환 ----------
  function show(screen) {
    startScreen.classList.toggle("hidden", screen !== "start");
    searchScreen.classList.toggle("hidden", screen !== "search");
    chatScreen.classList.toggle("hidden", screen !== "chat");
  }

  // 연결 상태를 UI에 반영
  function updateConnUI() {
    const ok = state.connected === true;
    const startBtn = $("#start-btn");
    if (startBtn) {
      startBtn.disabled = !ok;
      const span = startBtn.querySelector("span");
      if (span) span.textContent = ok ? "🎲 랜덤 매칭 시작" : "🔌 연결 중…";
    }
    if (state.phase === ST.CHATTING) setConn(ok);
    if (state.phase === ST.SEARCHING) {
      const sub = $("#search-sub");
      if (sub) sub.textContent = ok
        ? "잠시만 기다려 주세요. 접속자가 적으면 시간이 걸릴 수 있어요."
        : "연결이 끊겨 재연결 중이에요…";
    }
  }

  // ---------- MQTT 연결 (페이지 로드 시) ----------
  function connect() {
    state.client = mqtt.connect(BROKER_URL, {
      clientId: "ripple_" + state.id + "_" + Date.now().toString(36),
      clean: true, reconnectPeriod: 2500, connectTimeout: 12000, keepalive: 30,
      will: { topic: inbox("_gone"), payload: JSON.stringify({ id: state.id }), qos: 0 },
    });
    state.client.on("connect", () => {
      const wasDown = state.connected === false;
      state.connected = true;
      updateConnUI();
      state.client.subscribe(inbox(state.id), { qos: 0 });
      if (state.isAdmin) state.client.subscribe(ONLINE, { qos: 0 });  // 접속자 집계는 관리자만 구독
      // 재연결 복구: 진행 중이던 상태의 구독을 되살림
      if (state.phase === ST.SEARCHING) { state.client.subscribe(LOBBY, { qos: 0 }); announceWait(); }
      else if (state.phase === ST.CHATTING && state.pairTopic) { state.client.subscribe(state.pairTopic, { qos: 0 }); }
      if (wasDown) toast("다시 연결됐어요 ✅");
      sendOnline();
    });
    state.client.on("reconnect", () => { state.connected = false; updateConnUI(); });
    state.client.on("close", () => { state.connected = false; updateConnUI(); });
    state.client.on("offline", () => { state.connected = false; updateConnUI(); });
    state.client.on("message", (t, payload) => {
      let d; try { d = JSON.parse(payload.toString()); } catch (_) { return; }
      if (t === inbox(state.id)) onInbox(d);
      else if (t === LOBBY) onLobby(d);
      else if (t === ONLINE) onOnline(d);
      else if (state.pairTopic && t === state.pairTopic) onPair(d);
    });
    state.client.on("error", (e) => { console.error("MQTT error", e); state.connected = false; updateConnUI(); });

    // 전역 접속 하트비트
    setInterval(() => { sendOnline(); pruneOnline(); }, ONLINE_INTERVAL);
  }

  function publish(topic, obj) {
    if (state.client && state.client.connected) state.client.publish(topic, JSON.stringify(obj), { qos: 0 });
  }
  function sendOnline() { publish(ONLINE, { id: state.id, st: state.phase, t: Date.now() }); }

  // ============================================================
  //  매칭 (로비 + 핸드셰이크)
  // ============================================================
  let waitTimer = null, evalTimer = null, searchTimer = null;

  function startSearching() {
    state.phase = ST.SEARCHING;
    state.partnerId = null; state.pairTopic = null; state.pendingInvite = null;
    state.waiting.clear();
    // 백그라운드 대기 알림 권한 요청 (사용자 제스처 시점)
    try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch (_) {}
    show("search");
    state.client.subscribe(LOBBY, { qos: 0 });
    announceWait();
    clearInterval(waitTimer); waitTimer = setInterval(announceWait, WAIT_INTERVAL);
    clearInterval(evalTimer); evalTimer = setInterval(evaluateMatch, 1000);
    // 경과 시간 안내
    const t0 = Date.now();
    const sub = $("#search-sub");
    clearInterval(searchTimer);
    searchTimer = setInterval(() => {
      if (state.phase !== ST.SEARCHING || !state.connected) return;
      const s = Math.floor((Date.now() - t0) / 1000);
      if (sub) sub.textContent = `벌써 ${s}초째 찾고 있어요. 접속자가 적으면 시간이 걸릴 수 있어요.`;
    }, 1000);
    sendOnline();
  }

  function stopSearching() {
    clearInterval(waitTimer); clearInterval(evalTimer); clearInterval(searchTimer);
    waitTimer = evalTimer = searchTimer = null;
    publish(LOBBY, { t: "unwait", id: state.id });
    try { state.client.unsubscribe(LOBBY); } catch (_) {}
  }

  function announceWait() {
    if (state.phase !== ST.SEARCHING) return;
    publish(LOBBY, { t: "wait", id: state.id, name: state.nickname });
  }

  function onLobby(d) {
    if (!d || d.id === state.id) return;
    if (d.t === "wait") state.waiting.set(d.id, { name: d.name || "익명", lastSeen: Date.now() });
    else if (d.t === "unwait") state.waiting.delete(d.id);
  }

  function evaluateMatch() {
    if (state.phase !== ST.SEARCHING) return;
    // 오래된 대기자 제거
    const now = Date.now();
    for (const [id, w] of state.waiting) if (now - w.lastSeen > WAIT_TIMEOUT) state.waiting.delete(id);
    if (state.waiting.size === 0) return;
    // 가장 작은 id 후보 선택 (차단한 상대 제외)
    let cand = null;
    for (const id of state.waiting.keys()) {
      if (state.blocked.has(id)) continue;
      if (cand === null || id < cand) cand = id;
    }
    if (cand === null) return;
    // 내 id가 더 작으면 내가 초대, 아니면 초대를 기다림
    if (state.id < cand) sendInvite(cand);
  }

  function sendInvite(toId) {
    const room = roomIdOf(state.id, toId);
    state.phase = ST.INVITING;
    const timer = setTimeout(() => {
      if (state.phase === ST.INVITING) {
        state.pendingInvite = null;
        state.waiting.delete(toId);     // 응답 없는 상대 제외
        state.phase = ST.SEARCHING;
      }
    }, INVITE_TIMEOUT);
    state.pendingInvite = { to: toId, room, timer };
    publish(inbox(toId), { t: "invite", from: state.id, name: state.nickname, room });
  }

  function onInbox(d) {
    if (!d || !d.t) return;
    // 차단한 상대의 초대/수락은 거절 (busy 응답으로 상대도 다음 후보로 넘어가게)
    if (state.blocked.has(d.from) && (d.t === "invite" || d.t === "accept")) {
      publish(inbox(d.from), { t: "busy", from: state.id });
      return;
    }
    switch (d.t) {
      case "invite": {
        if (state.phase === ST.SEARCHING) {
          publish(inbox(d.from), { t: "accept", from: state.id, name: state.nickname, room: d.room });
          beginChat(d.room, d.from, d.name);
        } else if (state.phase === ST.INVITING) {
          // 더 작은 id 초대자를 우선 → 내 초대 취소하고 수락
          if (d.from < state.id && state.pendingInvite) {
            publish(inbox(state.pendingInvite.to), { t: "cancel", from: state.id });
            clearTimeout(state.pendingInvite.timer); state.pendingInvite = null;
            publish(inbox(d.from), { t: "accept", from: state.id, name: state.nickname, room: d.room });
            beginChat(d.room, d.from, d.name);
          } else {
            publish(inbox(d.from), { t: "busy", from: state.id });
          }
        } else {
          publish(inbox(d.from), { t: "busy", from: state.id });
        }
        break;
      }
      case "accept": {
        if (state.phase === ST.INVITING && state.pendingInvite && d.from === state.pendingInvite.to) {
          const room = state.pendingInvite.room;
          clearTimeout(state.pendingInvite.timer); state.pendingInvite = null;
          beginChat(room, d.from, d.name);
        } else {
          publish(inbox(d.from), { t: "busy", from: state.id });   // 이미 매칭됨
        }
        break;
      }
      case "busy":
      case "cancel": {
        if (state.phase === ST.INVITING && state.pendingInvite && d.from === state.pendingInvite.to) {
          clearTimeout(state.pendingInvite.timer);
          state.waiting.delete(d.from);
          state.pendingInvite = null;
          state.phase = ST.SEARCHING;
        }
        break;
      }
    }
  }

  function beginChat(room, partnerId, partnerName) {
    stopSearching();
    state.phase = ST.CHATTING;
    state.partnerId = partnerId;
    state.partnerName = clean(partnerName || "상대방").text;
    state.pairTopic = pairTopicOf(room);
    state.lastSender = null;
    state.sendTimes = []; state.recvTimes = []; state.lastText = ""; state.repeat = 0;
    state.client.subscribe(state.pairTopic, { qos: 0 });
    startPairTimers();
    messagesEl.innerHTML = "";
    partnerTitle.textContent = state.partnerName;
    setConn(true);
    renderSystem("상대와 연결되었어요! 인사를 건네보세요 👋");
    show("chat");
    messageInput.focus();
    notifyMatch();   // 백그라운드 대기 중이었다면 소리/웹알림/탭 제목으로 호출
    sendOnline();
    // 차별점(음성 변조) 발견성: 첫 매칭 때 1회 안내
    if (!state.hintShown) {
      state.hintShown = true;
      setTimeout(() => { if (state.phase === ST.CHATTING) toast("🎤 음성은 변조(굵게·높게·로봇)해서 보낼 수 있어요!"); }, 1400);
    }
    // 인사용 핑(상대가 내 이름 알도록)
    publish(state.pairTopic, { t: "hello", from: state.id, name: state.nickname });
  }

  function setConn(ok) {
    connDot.className = "dot " + (ok ? "online" : "offline");
    presenceText.textContent = ok ? "익명으로 연결됨" : "연결 끊김";
  }

  // ============================================================
  //  1:1 채팅
  // ============================================================
  // 대화 중 생존 핑: 상대가 페이지를 나가면 핑이 끊겨 자동 이탈 처리
  let pairPingTimer = null, pairCheckTimer = null;
  function startPairTimers() {
    state.partnerLastSeen = Date.now();
    clearInterval(pairPingTimer); clearInterval(pairCheckTimer);
    pairPingTimer = setInterval(() => {
      if (state.phase === ST.CHATTING) publish(state.pairTopic, { t: "ping", from: state.id });
    }, PAIR_PING_INTERVAL);
    pairCheckTimer = setInterval(() => {
      if (state.phase !== ST.CHATTING) return;
      if (!state.connected) { state.partnerLastSeen = Date.now(); return; }  // 내 연결 끊김은 제외
      if (Date.now() - state.partnerLastSeen > PAIR_TIMEOUT) partnerLeft();
    }, 3000);
  }
  function clearPairTimers() {
    clearInterval(pairPingTimer); clearInterval(pairCheckTimer);
    pairPingTimer = pairCheckTimer = null;
  }

  function onPair(d) {
    if (!d || d.from === state.id) return;
    state.partnerLastSeen = Date.now();   // 상대 신호 수신 → 생존 갱신
    switch (d.t) {
      case "ping": break;
      case "hello": {
        const nm = clean(d.name || "").text;
        if (nm && nm !== state.partnerName) { state.partnerName = nm; partnerTitle.textContent = nm; }
        break;
      }
      case "msg": {
        // 상대 폭주 방어: 5초 15개 초과는 드랍
        const now = Date.now();
        state.recvTimes = state.recvTimes.filter((t) => now - t < 5000);
        if (state.recvTimes.length >= 15) return;
        state.recvTimes.push(now);
        renderMessage(d, false); beep(); break;
      }
      case "voice": renderVoice(d, false); beep(); break;
      case "typing": onTyping(d); break;
      case "bye": partnerLeft(); break;
    }
  }

  function sendMessage() {
    const raw = messageInput.value.trim();
    if (!raw || state.phase !== ST.CHATTING) return;
    if (!state.connected) { toast("연결이 끊겨 메시지를 보낼 수 없어요 🔌"); return; }
    // 도배 방지: 5초에 6개 초과 차단
    const now = Date.now();
    state.sendTimes = state.sendTimes.filter((t) => now - t < 5000);
    if (state.sendTimes.length >= 6) { toast("조금 천천히 보내주세요 ⏳"); return; }
    // 같은 메시지 반복 차단
    if (raw === state.lastText) {
      if (state.repeat >= 2) { toast("같은 메시지를 반복해서 보낼 수 없어요 🙅"); return; }
      state.repeat++;
    } else { state.repeat = 0; state.lastText = raw; }
    state.sendTimes.push(now);
    const { text, hit } = clean(raw);
    if (hit) toast("부적절한 표현은 가려져요 🙅");
    const msg = { t: "msg", from: state.id, name: state.nickname, text, ts: Date.now() };
    publish(state.pairTopic, msg);
    renderMessage(msg, true);
    messageInput.value = ""; sendBtn.disabled = true;
    publish(state.pairTopic, { t: "typing", from: state.id, state: "stop" });
  }
  sendBtn.addEventListener("click", sendMessage);
  messageInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
  messageInput.addEventListener("input", () => {
    sendBtn.disabled = !messageInput.value.trim();
    if (state.phase !== ST.CHATTING) return;
    const now = Date.now();
    if (now - state.typingSentAt > 1500) { state.typingSentAt = now; publish(state.pairTopic, { t: "typing", from: state.id, state: "start" }); }
  });
  sendBtn.disabled = true;

  // 타이핑 표시
  function onTyping(d) {
    if (d.state === "stop") { typingIndicator.classList.add("hidden"); clearTimeout(state.typingTimer); return; }
    typingIndicator.classList.remove("hidden");
    clearTimeout(state.typingTimer);
    state.typingTimer = setTimeout(() => typingIndicator.classList.add("hidden"), TYPING_TIMEOUT);
  }

  // ---------- 렌더링 ----------
  function rowFor(isMe, grouped) {
    const row = document.createElement("div");
    row.className = "msg-row " + (isMe ? "me" : "") + (grouped ? " grouped" : "");
    const avatar = document.createElement("div");
    const name = isMe ? state.nickname : state.partnerName;
    if (grouped) avatar.className = "msg-avatar spacer";
    else { avatar.className = "msg-avatar"; avatar.style.background = colorFor(name); avatar.textContent = initialOf(name); }
    const body = document.createElement("div"); body.className = "msg-body";
    row.appendChild(avatar); row.appendChild(body);
    return { row, body };
  }

  function renderMessage(data, isMe) {
    const grouped = state.lastSender === (isMe ? "me" : "p");
    state.lastSender = isMe ? "me" : "p";
    const { row, body } = rowFor(isMe, grouped);
    const inner = [];
    if (!isMe && !grouped) inner.push(`<div class="msg-name">${escapeHtml(state.partnerName)}</div>`);
    // 받은 메시지도 한 번 더 필터 (상대 클라이언트가 구버전일 때 대비)
    inner.push(`<div class="bubble">${linkify(escapeHtml(clean(data.text).text))}</div>`);
    inner.push(`<div class="msg-time">${timeNow()}</div>`);
    body.innerHTML = inner.join("");
    messagesEl.appendChild(row);
    scrollToBottom(isMe);
  }

  function renderVoice(data, isMe) {
    const grouped = state.lastSender === (isMe ? "me" : "p");
    state.lastSender = isMe ? "me" : "p";
    const { row, body } = rowFor(isMe, grouped);
    if (!isMe && !grouped) body.innerHTML = `<div class="msg-name">${escapeHtml(state.partnerName)}</div>`;
    const dur = data.dur || 0;
    const fxKey = data.fx || "none";
    const meta = VOICE_FX[fxKey] || VOICE_FX.none;
    const badge = meta.label ? `<span class="voice-fx-badge">${meta.label}</span>` : "";
    const bubble = document.createElement("div");
    bubble.className = "bubble voice-bubble";
    bubble.innerHTML = `
      <button class="voice-play" aria-label="재생">▶</button>
      <span class="voice-wave">${'<i></i>'.repeat(14)}</span>
      <span class="voice-dur">${fmtTime(dur)}</span>${badge}`;
    const playBtn = bubble.querySelector(".voice-play");
    let player = null;
    playBtn.addEventListener("click", () => {
      if (!player) {
        player = makeVoicePlayer(data.audio, fxKey);
        player.audio.addEventListener("ended", () => {
          playBtn.textContent = "▶"; bubble.classList.remove("playing");
          player.cleanup(); player = null;
        });
        player.audio.play(); playBtn.textContent = "❚❚"; bubble.classList.add("playing");
      } else if (player.audio.paused) {
        player.audio.play(); playBtn.textContent = "❚❚"; bubble.classList.add("playing");
      } else {
        player.audio.pause(); playBtn.textContent = "▶"; bubble.classList.remove("playing");
      }
    });
    body.appendChild(bubble);
    const time = document.createElement("div"); time.className = "msg-time"; time.textContent = timeNow();
    body.appendChild(time);
    messagesEl.appendChild(row);
    scrollToBottom(isMe);
  }

  function renderSystem(text) {
    state.lastSender = null;
    const el = document.createElement("div"); el.className = "sys-msg"; el.textContent = text;
    messagesEl.appendChild(el); scrollToBottom(false);
  }
  function fmtTime(sec) { sec = Math.round(sec); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }

  // ---------- 종료 / 다음 ----------
  function partnerLeft() {
    if (state.phase !== ST.CHATTING) return;
    clearPairTimers();
    state.phase = ST.IDLE;
    if (state.pairTopic) { try { state.client.unsubscribe(state.pairTopic); } catch (_) {} }
    typingIndicator.classList.add("hidden");
    leftOverlay.classList.remove("hidden");
    beep();
  }

  function endChat(silent) {
    clearPairTimers();
    if (state.pairTopic) {
      if (!silent) publish(state.pairTopic, { t: "bye", from: state.id });
      try { state.client.unsubscribe(state.pairTopic); } catch (_) {}
    }
    state.pairTopic = null; state.partnerId = null;
    typingIndicator.classList.add("hidden");
    if (recState.recording) cancelRecording();
  }

  $("#report-btn").addEventListener("click", () => {
    if (state.phase !== ST.CHATTING || !state.partnerId) return;
    if (!confirm("이 상대를 신고할까요?\n신고하면 즉시 차단되고 다음 상대를 찾습니다.")) return;
    state.blocked.add(state.partnerId);
    toast("신고하고 차단했어요 🚨");
    endChat(false);
    startSearching();
  });
  $("#block-btn").addEventListener("click", () => {
    if (state.phase !== ST.CHATTING || !state.partnerId) return;
    state.blocked.add(state.partnerId);
    toast("이 상대를 차단했어요. 이번 접속 동안은 다시 만나지 않아요 🚫");
    endChat(false);
    startSearching();
  });
  $("#next-btn").addEventListener("click", () => { endChat(false); startSearching(); });
  $("#leave-btn").addEventListener("click", () => { endChat(false); state.phase = ST.IDLE; sendOnline(); show("start"); });
  $("#cancel-search-btn").addEventListener("click", () => { stopSearching(); state.phase = ST.IDLE; sendOnline(); show("start"); });
  $("#find-next-btn").addEventListener("click", () => { leftOverlay.classList.add("hidden"); startSearching(); });
  $("#go-home-btn").addEventListener("click", () => { leftOverlay.classList.add("hidden"); state.phase = ST.IDLE; sendOnline(); show("start"); });

  // 시작
  startForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!state.connected) { toast("연결 중이에요. 잠시 후 다시 시도해 주세요 🔌"); return; }
    state.nickname = clean(curNick()).text;
    try { localStorage.setItem("ripple_nick", state.nickname); } catch (_) {}
    startSearching();
  });

  // ---------- 알림음 토글 ----------
  $("#sound-btn").addEventListener("click", () => {
    state.soundOn = !state.soundOn;
    $("#sound-on").classList.toggle("hidden", !state.soundOn);
    $("#sound-off").classList.toggle("hidden", state.soundOn);
    if (state.soundOn) beep();
    toast(state.soundOn ? "알림음 켜짐 🔔" : "알림음 꺼짐 🔕");
  });

  // ============================================================
  //  음성 메시지 (MediaRecorder)
  // ============================================================
  const recState = { recording: false, recorder: null, chunks: [], stream: null, start: 0, timer: null, mime: "", fx: "none" };

  // 음성 변조 프리셋 (재생 시 적용)
  const VOICE_FX = {
    none:  { label: "",        rate: 1.0,  ring: 0  },
    deep:  { label: "🐻 굵게",  rate: 0.78, ring: 0  },
    high:  { label: "🐿️ 높게", rate: 1.45, ring: 0  },
    robot: { label: "🤖 로봇",  rate: 1.0,  ring: 55 },
  };
  let playCtx = null;

  // dataURL 음성을 fx 적용해 재생할 수 있는 audio 핸들 생성
  function makeVoicePlayer(dataUrl, fxKey) {
    const fx = VOICE_FX[fxKey] || VOICE_FX.none;
    const audio = new Audio(dataUrl);
    // 피치 변조: 재생 속도를 바꾸되 피치 보존을 끔
    audio.preservesPitch = false;
    audio.mozPreservesPitch = false;
    audio.webkitPreservesPitch = false;
    audio.playbackRate = fx.rate;
    let cleanup = () => {};
    if (fx.ring) {
      try {
        playCtx = playCtx || new (window.AudioContext || window.webkitAudioContext)();
        if (playCtx.state === "suspended") playCtx.resume();
        const src = playCtx.createMediaElementSource(audio);
        const mod = playCtx.createGain(); mod.gain.value = 0; // 캐리어로 osc가 흔듦 → 링모듈레이션
        const osc = playCtx.createOscillator(); osc.type = "sine"; osc.frequency.value = fx.ring;
        osc.connect(mod.gain);
        src.connect(mod); mod.connect(playCtx.destination);
        osc.start();
        cleanup = () => { try { osc.stop(); } catch (_) {} try { src.disconnect(); mod.disconnect(); } catch (_) {} };
      } catch (_) { /* WebAudio 실패 시 일반 재생 */ }
    }
    return { audio, cleanup };
  }

  function pickMime() {
    const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    for (const m of cands) if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
    return "";
  }

  async function startRecording() {
    if (state.phase !== ST.CHATTING) return;
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast("이 브라우저는 음성 녹음을 지원하지 않아요 😢"); return; }
    try {
      recState.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (_) { toast("마이크 권한이 필요해요 🎤"); return; }
    recState.mime = pickMime();
    recState.chunks = [];
    recState.recorder = new MediaRecorder(recState.stream, recState.mime ? { mimeType: recState.mime, audioBitsPerSecond: 24000 } : undefined);
    recState.recorder.ondataavailable = (e) => { if (e.data && e.data.size) recState.chunks.push(e.data); };
    recState.recorder.onstop = finishRecording;
    recState.recorder.start();
    recState.recording = true;
    recState.start = Date.now();
    composer.classList.add("hidden");
    recordingBar.classList.remove("hidden");
    recState.timer = setInterval(() => {
      const sec = (Date.now() - recState.start) / 1000;
      recTime.textContent = fmtTime(sec);
      if (sec >= VOICE_MAX_SEC) stopRecording();
    }, 200);
  }

  function teardownRec() {
    clearInterval(recState.timer);
    if (recState.stream) recState.stream.getTracks().forEach((t) => t.stop());
    recState.recording = false;
    recordingBar.classList.add("hidden");
    composer.classList.remove("hidden");
  }

  function stopRecording() {
    if (!recState.recording) return;
    recState._send = true;
    try { recState.recorder.stop(); } catch (_) { teardownRec(); }
  }
  function cancelRecording() {
    if (!recState.recording) return;
    recState._send = false;
    try { recState.recorder.stop(); } catch (_) {}
    teardownRec();
  }

  function finishRecording() {
    const send = recState._send;
    const dur = (Date.now() - recState.start) / 1000;
    teardownRec();
    if (!send || dur < 0.4) return;
    const blob = new Blob(recState.chunks, { type: recState.mime || "audio/webm" });
    if (blob.size > VOICE_MAX_BYTES) { toast("음성이 너무 길어요. 더 짧게 보내주세요 🙏"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result; // data:...;base64,...
      const msg = { t: "voice", from: state.id, name: state.nickname, audio: dataUrl, dur, fx: recState.fx, ts: Date.now() };
      if (state.phase === ST.CHATTING && state.pairTopic && state.connected) {
        publish(state.pairTopic, msg);
        renderVoice(msg, true);
      } else {
        toast("연결이 끊겨 음성을 보낼 수 없어요 🔌");
      }
    };
    reader.readAsDataURL(blob);
  }

  micBtn.addEventListener("click", startRecording);
  $("#rec-send").addEventListener("click", stopRecording);
  $("#rec-cancel").addEventListener("click", cancelRecording);

  // 음성 변조 선택
  document.querySelectorAll(".fx-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".fx-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      recState.fx = chip.dataset.fx;
    });
  });

  // ---------- 이모지 ----------
  const EMOJIS = ["😀","😂","🥹","😊","😍","😎","🤩","🥳","😅","😭","😡","🤔","👍","👏","🙏","🔥","💯","✨","🎉","❤️","💜","💙","💚","😴","🤯","😱","🙄","😬","🤝","👀","🫶","🙌","💀","🤣","😏","😇","🥰","😘","🤗","🫡"];
  const emojiPanel = $("#emoji-panel");
  emojiPanel.innerHTML = EMOJIS.map((e) => `<button type="button">${e}</button>`).join("");
  emojiPanel.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    messageInput.value += b.textContent; messageInput.focus(); sendBtn.disabled = !messageInput.value.trim();
  }));
  $("#emoji-btn").addEventListener("click", (e) => { e.stopPropagation(); emojiPanel.classList.toggle("hidden"); });
  document.addEventListener("click", (e) => { if (!emojiPanel.contains(e.target) && e.target.id !== "emoji-btn") emojiPanel.classList.add("hidden"); });

  // ============================================================
  //  공유 모달 (사이트 공유)
  // ============================================================
  const shareModal = $("#share-modal");
  const siteUrl = () => `${location.origin}${location.pathname}`;
  const siteMsg = () => `💬 낯선 사람과 1:1로 떠드는 랜덤 채팅 '블러챗'!\n가입 없이 클릭하면 바로 매칭 👇\n${siteUrl()}`;
  function openShare() {
    $("#share-link-input").value = siteUrl();
    $("#invite-text").value = siteMsg();
    $("#qr-img").src = "https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=0&data=" + encodeURIComponent(siteUrl());
    shareModal.classList.remove("hidden");
  }
  async function copyText(text, ok) { try { await navigator.clipboard.writeText(text); toast(ok); } catch (_) { prompt("복사하세요:", text); } }
  $("#open-share-btn").addEventListener("click", openShare);
  $("#share-close").addEventListener("click", () => shareModal.classList.add("hidden"));
  shareModal.addEventListener("click", (e) => { if (e.target === shareModal) shareModal.classList.add("hidden"); });
  $("#copy-link-btn").addEventListener("click", () => copyText(siteUrl(), "링크를 복사했어요 🔗"));
  $("#copy-msg-btn").addEventListener("click", () => copyText(siteMsg(), "공유 멘트를 복사했어요 ✏️"));
  // ESC: 열린 모달/패널 닫기
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!emojiPanel.classList.contains("hidden")) { emojiPanel.classList.add("hidden"); return; }
    if (!shareModal.classList.contains("hidden")) { shareModal.classList.add("hidden"); return; }
    if (!leftOverlay.classList.contains("hidden")) {
      leftOverlay.classList.add("hidden"); state.phase = ST.IDLE; sendOnline(); show("start");
    }
  });

  // ============================================================
  //  관리자 전용 접속자 수
  // ============================================================
  function initAdmin() {
    const key = new URLSearchParams(location.search).get("admin");
    if (key && key === ADMIN_KEY) {
      state.isAdmin = true;
      $("#admin-badge").classList.remove("hidden");
      setInterval(renderAdmin, 2000);
    }
  }
  function onOnline(d) {
    if (!d || !d.id) return;
    state.online.set(d.id, { st: d.st, lastSeen: Date.now() });
    if (d.id === state.id) return;
  }
  function pruneOnline() {
    const now = Date.now();
    for (const [id, o] of state.online) if (now - o.lastSeen > ONLINE_TIMEOUT) state.online.delete(id);
  }
  function renderAdmin() {
    if (!state.isAdmin) return;
    pruneOnline();
    // 나 자신도 포함
    state.online.set(state.id, { st: state.phase, lastSeen: Date.now() });
    let total = 0, wait = 0, chat = 0;
    for (const o of state.online.values()) {
      total++;
      if (o.st === ST.SEARCHING || o.st === ST.INVITING) wait++;
      else if (o.st === ST.CHATTING) chat++;
    }
    $("#ab-total").textContent = total;
    $("#ab-wait").textContent = wait;
    $("#ab-chat").textContent = chat;
  }

  // ---------- 페이지 종료 ----------
  function onLeavePage() {
    if (state.phase === ST.CHATTING && state.pairTopic) publish(state.pairTopic, { t: "bye", from: state.id });
    else if (state.phase === ST.SEARCHING) publish(LOBBY, { t: "unwait", id: state.id });
  }
  window.addEventListener("beforeunload", onLeavePage);
  window.addEventListener("pagehide", onLeavePage);

  // ---------- 부팅 ----------
  initAdmin();
  updateConnUI();   // 연결 전: 시작 버튼 비활성 + "연결 중…"
  updateGoldenHour();
  setInterval(updateGoldenHour, 1000);
  connect();
  // 최초 1회 안전 안내
  try {
    if (!localStorage.getItem("ripple_safety_seen")) {
      setTimeout(() => toast("서로 존중해주세요 · 불쾌하면 차단/신고할 수 있어요 🤝"), 1800);
      localStorage.setItem("ripple_safety_seen", "1");
    }
  } catch (_) {}
})();
