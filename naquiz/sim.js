/* 나퀴즈 유저 플로우 시뮬레이션 (실제 코어 로직 사용) */
const QC = require("./quiz-core.js");

function line(s=""){ console.log(s); }

line("════════ 👤 유저A '민수' : 퀴즈 만들기 ════════");
// 민수가 6문항 받아서 자기 답을 고름 (인덱스 0~5 문항 사용)
const idx = [0,1,2,3,4,6];
const labels = idx.map(i => QC.QUESTIONS[i].q);
const minsuAnswers = [1,0,0,2,0,3]; // I / 짜장 / 집뒹굴 / 읽씹장인 / 벌레 / 치킨
idx.forEach((qi,k)=>{
  line(`Q${k+1}. ${QC.QUESTIONS[qi].q}`);
  line(`   → 민수 답: ✅ ${QC.QUESTIONS[qi].opts[minsuAnswers[k]]}`);
});
const quiz = { n:"민수", idx, a:minsuAnswers };

line("");
line("════════ 🔗 공유 링크 생성 ════════");
const payload = QC.encode(quiz);
const url = "https://naquiz.app/#q=" + payload;
line("카톡 공유 문구:");
line(`  "민수는 나를 얼마나 알까? 맞혀봐 😎"`);
line("  " + url);
line(`(링크 길이: ${url.length}자 — 서버 없이 링크에 퀴즈가 통째로 들어있음)`);

line("");
line("════════ 👤 유저B '지연' : 링크 열어서 풀기 ════════");
const decoded = QC.decode(payload);
line(`화면: "'${decoded.n}'님에 대한 퀴즈예요. 몇 개나 맞힐까요? 🤔"`);
const jiyeonGuess = [1,1,0,2,0,1]; // 4개만 맞힘
decoded.idx.forEach((qi,k)=>{
  const ok = jiyeonGuess[k]===decoded.a[k];
  line(`Q${k+1}. ${QC.QUESTIONS[qi].q}`);
  line(`   지연 추측: ${QC.QUESTIONS[qi].opts[jiyeonGuess[k]]}  ${ok?"⭕":"❌(정답:"+QC.QUESTIONS[qi].opts[decoded.a[k]]+")"}`);
});

line("");
line("════════ 🏆 결과 화면 ════════");
const r = QC.score(decoded, jiyeonGuess);
line(`   ${r.tier.emoji}  ${r.correct}/${r.total}  (${r.pct}%)`);
line(`   ${r.tier.title} — ${r.tier.desc}`);
line(`   [나도 내 퀴즈 만들기 🔥]  [친구들한테 자랑하기]`);

line("");
line("════════ 🔁 바이럴 루프 체크 ════════");
line("지연 → '나도 만들기' 누르면 → 지연의 퀴즈 생성 → 지연 친구들에게 또 공유…");
line("");
// 등급 경계 동작 확인
line("등급 샘플:");
[6,4,2,0].forEach(c=>{ const t=QC.tier(Math.round(c/6*100)); line(`  ${c}/6 → ${t.emoji} ${t.title}`); });
