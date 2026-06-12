# 📣 BlurChat 홍보 키트 (입소문용)

> 그대로 복사해서 붙여넣을 수 있는 홍보 문구 모음입니다.
> **사이트 주소:** https://ikdd7.github.io/Test2/
> **공유 카드 이미지:** `og.png` (링크 붙이면 자동으로 뜸)
> **콘셉트:** 가입 없이 버튼 하나로 **낯선 사람과 1:1 랜덤 채팅** (텍스트 + 음성)

---

## 🧭 입소문 전략 3줄 요약
1. **동시 접속이 생명.** 랜덤 매칭은 대기자가 있어야 연결됩니다. 친구들과 시간 정해 "다같이 접속"으로 초기 풀을 만드세요.
2. **"홍보"하지 말고 "같이 하자".** "심심한데 같이 랜덤채팅 ㄱ?" [링크]
3. **음성 기능을 후킹 포인트로.** "목소리도 보낼 수 있는 랜덤채팅" 은 차별점이라 잘 퍼집니다.

---

## 💛 카카오톡 / 오픈카톡 (전환율 1위)
```
💬 가입 없이 낯선 사람이랑 1:1로 떠드는 랜덤채팅 ㄱㄱ
목소리(음성)도 보낼 수 있음 👇 (클릭하면 바로 매칭)
https://ikdd7.github.io/Test2/
```

## 📸 인스타 스토리 / 쓰레드
```
심심한 사람 다 들어와 🫠 가입 없이 1:1 랜덤채팅.
텍스트 + 음성까지 됨. 클릭하면 바로 매칭.
👉 ikdd7.github.io/Test2
```
> 스토리엔 **QR 스티커**(공유 모달의 QR 캡처)를 같이 올리면 전환율 ↑

## 🐦 X (트위터)
```
주말 사이드 프로젝트 💬 "BlurChat"
- 가입 없이 버튼 하나로 낯선 사람과 1:1 랜덤 매칭
- 텍스트 + 음성 메시지 지원
- 메시지 저장 안 함 (완전 익명)
https://ikdd7.github.io/Test2/
```

## 🎓 에브리타임 / 대학 커뮤니티
```
시험기간 현타 올 때 잠깐 떠들 사람? 익명 1:1 랜덤채팅 ☕
가입 없이 바로 매칭 → https://ikdd7.github.io/Test2/
```

---

## 🌍 글로벌 (영어)

### Reddit — r/InternetIsBeautiful, r/SideProject, r/webdev
**Title:** I built a no-signup, 1:1 random chat with voice messages — instant match, fully anonymous
```
Made a tiny random chat site: BlurChat.
- No sign-up. One button → matched 1:1 with a stranger.
- Text + voice messages.
- Nothing stored anywhere — fully ephemeral & anonymous.
- 100% static site; matchmaking & realtime over MQTT-over-WebSocket.

Try it: https://ikdd7.github.io/Test2/
```

### Product Hunt — tagline & description
- **Tagline:** No sign-up 1:1 random chat — with voice messages.
- **Description:**
```
BlurChat instantly matches you 1:1 with a stranger. No accounts, no apps —
hit one button and you're chatting with text or voice. Nothing is stored,
so it's fully anonymous and ephemeral. Built as a static site with
serverless matchmaking over WebSocket.
```

---

## 🪝 후킹 멘트(아무 채널에나)
- "가입하기 귀찮아서 만든 랜덤채팅 (목소리도 됨)"
- "버튼 누르면 1초만에 낯선 사람이랑 연결"
- "메시지 저장 안 됨 = 무슨 말 해도 안 남음 🤫"
- "마음 안 들면 '다음 상대' 누르면 끝"

## ⏰ 런칭 당일 체크리스트
- [ ] 친구 여러 명과 "○시 동시 접속" → 매칭 풀 만들기 (랜덤은 대기자 필수!)
- [ ] 오픈카톡 2~3곳에 공유 멘트
- [ ] 인스타 스토리 + QR 스티커
- [ ] X / 쓰레드 1포스트
- [ ] (영어 가능 시) Reddit r/SideProject 1포스트

## 🔑 관리자(나)만 보는 접속자 수
접속자 수는 일반 사용자에게 안 보입니다. **나만** 보려면 주소 뒤에 관리자 키를 붙이세요:
```
https://ikdd7.github.io/Test2/?admin=ripple-admin-2026
```
→ 우측 상단에 `🟢 N 온라인 · N 대기 · N 대화` 배지가 나타납니다.
⚠️ 이 키는 코드(`app.js`의 `ADMIN_KEY`)에 들어있는 값이라 **반드시 본인만 아는 값으로 변경**하세요. (정적 사이트라 완벽한 비밀은 아님 — 가벼운 차단 수준)

## ⚠️ 터지기 전에 챙길 것
- 지금은 **무료 공개 브로커**라 동시 접속이 크게 늘면 매칭/전송이 끊길 수 있음 → 전용 백엔드 검토
- 음성은 약 200KB(최대 60초)로 제한 — 더 키우려면 백엔드 필요
- **신고 / 차단 / 금칙어** 기능 없음 → 사람 많아지면 어뷰징 대비 필요
- 위 항목들은 요청 주시면 바로 붙여드릴 수 있어요.
