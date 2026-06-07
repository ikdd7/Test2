# 💬 Ripple · 실시간 채팅

가입 없이 **1초 만에 시작하는 실시간 채팅 사이트**입니다.
방 이름만 입력하면 바로 대화가 시작되고, 링크를 공유하면 친구가 즉시 들어올 수 있어요.

> **데모 배포**: GitHub Pages로 자동 배포됩니다. (Settings → Pages → Source: GitHub Actions)

## ✨ 특징

- **회원가입 불필요** — 닉네임 + 방 이름만 입력하면 끝
- **실시간 메시징** — 별도 서버 없이 공개 MQTT 브로커(WebSocket) 사용
- **접속자 수 표시** — 실시간 presence(하트비트 기반)
- **입력 중 표시** — "OO님이 입력 중…" 타이핑 인디케이터
- **초대 링크 공유** — `?room=방이름` 링크로 원클릭 초대 (모바일 네이티브 공유 지원)
- **이모지 패널 · 알림음** — WebAudio로 외부 파일 없이 사운드 재생
- **자동 아바타** — 닉네임 기반 색상/이니셜 아바타 생성
- **세련된 UI** — 글래스모피즘, 다크 테마, 부드러운 애니메이션, 모바일 반응형

## 🛠 기술 스택

- 순수 **HTML / CSS / JavaScript** (빌드 과정 없음, 정적 사이트)
- 실시간 통신: **MQTT over WebSocket** ([MQTT.js](https://github.com/mqttjs/MQTT.js))
- 공개 브로커: `wss://broker.emqx.io:8084/mqtt`

## 🔒 개인정보 / 보안 참고

- 메시지는 **어떤 서버에도 저장되지 않습니다.** 실시간 전달만 됩니다.
- 공개 MQTT 브로커를 사용하므로 **민감한 정보는 입력하지 마세요.** 가볍게 즐기는 용도입니다.
- 모든 텍스트는 XSS 방지를 위해 escape 처리 후 렌더링됩니다.

## 🚀 로컬 실행

정적 파일이라 아무 정적 서버로나 열면 됩니다.

```bash
# 파이썬이 있다면
python3 -m http.server 8000
# 그 후 http://localhost:8000 접속
```

## 📂 구조

```
index.html   # 마크업 (입장 화면 + 채팅 화면)
styles.css   # 스타일 (테마, 애니메이션, 반응형)
app.js       # 로직 (MQTT 연결, presence, 타이핑, 렌더링)
.github/workflows/deploy.yml   # GitHub Pages 자동 배포
```

즐겁게 떠들어보세요! 🌊
