/* ============================================================
 * 나퀴즈 코어 — "내 친구는 나를 얼마나 알까?"
 * 서버 없이 동작: 퀴즈를 링크(해시)에 인코딩.
 * 브라우저(window.QuizCore) + Node(require) 양쪽에서 사용.
 * ============================================================ */
(function (root) {
  "use strict";

  // 문제은행: 각 문항 = { q, opts:[...] }  (창작자가 자기 답을 고름)
  const QUESTIONS = [
    { q: "나의 MBTI 앞글자는?", opts: ["E (외향)", "I (내향)"] },
    { q: "짜장 vs 짬뽕, 나는?", opts: ["무조건 짜장", "무조건 짬뽕", "볶음밥파"] },
    { q: "주말의 나는 보통?", opts: ["집에서 뒹굴", "약속 풀가동", "카페·전시 탐방", "잠만 잠"] },
    { q: "카톡 답장 스타일은?", opts: ["즉답러", "생각나면 답함", "읽씹 장인", "내가 먼저 잘 안 함"] },
    { q: "내가 제일 무서워하는 건?", opts: ["벌레", "귀신", "높은 곳", "사람들 앞 발표"] },
    { q: "술 마시면 나는?", opts: ["더 신남", "조용해짐", "졸려서 잠", "술 안 마심"] },
    { q: "내 최애 음식은?", opts: ["고기", "마라탕", "디저트", "치킨", "회"] },
    { q: "이상형 1순위는?", opts: ["외모", "유머", "다정함", "능력", "가치관"] },
  ];

  const N = 6; // 한 퀴즈 문항 수

  // 결과 등급
  function tier(pct) {
    if (pct >= 100) return { emoji: "🏆", title: "소울메이트급!", desc: "나보다 나를 더 잘 아네…?" };
    if (pct >= 67)  return { emoji: "💕", title: "찐친 인정", desc: "우리 사이 진짜네 ㅎㅎ" };
    if (pct >= 34)  return { emoji: "🤔", title: "알 듯 말 듯한 사이", desc: "조금 더 친해져 볼까?" };
    return { emoji: "🥶", title: "우리… 아는 사이 맞나요?", desc: "이제부터 알아가면 되죠!" };
  }

  // 퀴즈 → 링크 해시 페이로드 (base64)
  function encode(quiz) {
    // quiz = { n: 이름, idx: [문항인덱스...], a: [정답옵션인덱스...] }
    const json = JSON.stringify([quiz.n, quiz.idx, quiz.a]);
    const b64 = (root.btoa ? root.btoa(unescape(encodeURIComponent(json)))
                           : Buffer.from(json, "utf8").toString("base64"));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function decode(payload) {
    let b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const json = (root.atob ? decodeURIComponent(escape(root.atob(b64)))
                            : Buffer.from(b64, "base64").toString("utf8"));
    const [n, idx, a] = JSON.parse(json);
    return { n, idx, a };
  }

  // 채점: 친구의 추측(guesses) vs 정답(a)
  function score(quiz, guesses) {
    let correct = 0;
    for (let i = 0; i < quiz.a.length; i++) if (guesses[i] === quiz.a[i]) correct++;
    const pct = Math.round((correct / quiz.a.length) * 100);
    return { correct, total: quiz.a.length, pct, tier: tier(pct) };
  }

  const api = { QUESTIONS, N, encode, decode, score, tier };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.QuizCore = api;
})(typeof window !== "undefined" ? window : globalThis);
