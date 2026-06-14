/* 나퀴즈 앱 로직 */
(function () {
  "use strict";
  const QC = window.QuizCore;
  const $ = (s) => document.querySelector(s);
  const show = (id) => { document.querySelectorAll("section.card").forEach(s => s.classList.add("hidden")); $(id).classList.remove("hidden"); window.scrollTo(0,0); };

  // ---- 상태 ----
  let make = { name: "", idx: [], a: [], step: 0 };
  let take = { quiz: null, guesses: [], step: 0 };

  // 랜덤하게 N문항 고르기
  function pickQuestions() {
    const all = QC.QUESTIONS.map((_, i) => i);
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [all[i],all[j]]=[all[j],all[i]]; }
    return all.slice(0, QC.N);
  }

  // ===== 만들기 =====
  $("#start").addEventListener("click", () => {
    const name = $("#name").value.trim() || "나";
    make = { name, idx: pickQuestions(), a: [], step: 0 };
    renderMake();
    show("#s-make");
  });

  function renderMake() {
    const qi = make.idx[make.step];
    const Q = QC.QUESTIONS[qi];
    $("#mbar").style.width = (make.step / QC.N * 100) + "%";
    $("#mnum").textContent = "Q" + (make.step + 1);
    $("#mq").textContent = Q.q + " (내 답은?)";
    const box = $("#mopts"); box.innerHTML = "";
    Q.opts.forEach((opt, oi) => {
      const b = document.createElement("button");
      b.className = "opt"; b.textContent = opt;
      b.addEventListener("click", () => {
        make.a[make.step] = oi;
        make.step++;
        if (make.step >= QC.N) finishMake();
        else renderMake();
      });
      box.appendChild(b);
    });
  }

  function finishMake() {
    const quiz = { n: make.name, idx: make.idx, a: make.a };
    const payload = QC.encode(quiz);
    const url = location.origin + location.pathname + "#q=" + payload;
    $("#link").value = url;
    show("#s-share");
    $("#preview").onclick = () => startTake(quiz);
    $("#kakao").onclick = () => shareLink(url, make.name);
  }

  $("#copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("#link").value); $("#copy").textContent = "복사됨!"; }
    catch (_) { $("#link").select(); }
  });

  function shareLink(url, name) {
    const text = `${name}는 나를 얼마나 알까? 맞혀봐 😎\n${url}`;
    if (navigator.share) navigator.share({ title: "너 나 얼마나 알아?", text, url }).catch(()=>{});
    else { navigator.clipboard.writeText(text).then(()=>alert("공유 문구를 복사했어요! 카톡에 붙여넣으세요 💬")).catch(()=>prompt("복사:", text)); }
  }

  // ===== 풀기 =====
  function startTake(quiz) {
    take = { quiz, guesses: [], step: 0 };
    $("#towner").textContent = `'${quiz.n}'님에 대한 퀴즈예요. 몇 개나 맞힐까요? 🤔`;
    renderTake();
    show("#s-take");
  }

  function renderTake() {
    const quiz = take.quiz;
    const qi = quiz.idx[take.step];
    const Q = QC.QUESTIONS[qi];
    $("#tbar").style.width = (take.step / quiz.idx.length * 100) + "%";
    $("#tnum").textContent = "Q" + (take.step + 1);
    $("#tq").textContent = Q.q;
    const box = $("#topts"); box.innerHTML = "";
    Q.opts.forEach((opt, oi) => {
      const b = document.createElement("button");
      b.className = "opt"; b.textContent = opt;
      b.addEventListener("click", () => {
        take.guesses[take.step] = oi;
        take.step++;
        if (take.step >= quiz.idx.length) finishTake();
        else renderTake();
      });
      box.appendChild(b);
    });
  }

  function finishTake() {
    const r = QC.score(take.quiz, take.guesses);
    $("#remoji").textContent = r.tier.emoji;
    $("#rscore").textContent = r.correct + "/" + r.total;
    $("#rtitle").textContent = r.tier.title;
    $("#rdesc").textContent = `${r.pct}% 정답 · ${r.tier.desc}`;
    show("#s-result");
    $("#r-make").onclick = () => { location.hash = ""; show("#s-home"); };
    $("#r-share").onclick = () => {
      const text = `'${take.quiz.n}' 퀴즈 ${r.correct}/${r.total} 맞았다! ${r.tier.emoji} 너도 해봐\n${location.href}`;
      if (navigator.share) navigator.share({ text }).catch(()=>{});
      else navigator.clipboard.writeText(text).then(()=>alert("자랑 문구 복사완료 💬")).catch(()=>{});
    };
  }

  // ===== 진입: 링크에 퀴즈가 있으면 바로 풀기 =====
  function boot() {
    const m = location.hash.match(/q=([^&]+)/);
    if (m) {
      try { startTake(QC.decode(m[1])); return; } catch (_) {}
    }
    show("#s-home");
  }
  boot();
})();
