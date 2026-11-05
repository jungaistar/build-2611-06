/* 화면 — 판정은 vpd.js 가 한다. 여기서는 읽고, 그리고, 고른 값을 넘길 뿐이다. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var LS_TPL = 'vpd06.templates', LS_AI = 'vpd06.ai';
  var state = { data: null, judged: [], drafts: [], tpls: loadTpls() };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  /* ---------- 읽기 ---------- */
  var SHEET = ['검증항목', '가상검증', 'vpd', '항목'];
  function readFile(f) {
    var rd = new FileReader();
    rd.onload = function (e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
        // 이름이 맞는 시트가 없으면 첫 시트를 읽는다
        var name = wb.SheetNames.filter(function (s) { return SHEET.indexOf(s.replace(/\s/g, '').toLowerCase()) >= 0; })[0] || wb.SheetNames[0];
        load(XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: true }), f.name + ' · 시트 「' + name + '」');
      } catch (err) { $('data-status').innerHTML = '<div class="warn">파일을 읽지 못했습니다: ' + esc(err.message) + '</div>'; }
    };
    rd.readAsArrayBuffer(f);
  }
  function load(rows, name) {
    state.data = Vpd.normalize(rows);
    var d = state.data;
    var models = uniq(d.items.map(function (o) { return o.model; })), owners = uniq(d.items.map(function (o) { return o.owner; }));
    var h = '<div class="stats">' + stat('파일', esc(name)) + stat('검증항목', d.items.length) + stat('기종', models.length) + stat('담당자', owners.length) + '</div>';
    if (d.issues.length) h += '<div class="warn"><b>확인할 것 ' + d.issues.length + '건</b> — 줄은 버리지 않고 판정에 넣었습니다.<ul>' + d.issues.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>';
    else h += '<div class="ok">경고 없이 읽었습니다.</div>';
    $('data-status').innerHTML = h;
    if (!d.items.length) return;
    $('f-model').innerHTML = opts(models, '전체 기종');
    $('f-owner').innerHTML = opts(owners, '전체 담당자');
    $('f-state').innerHTML = '<option value="">전체 판정</option>' + Vpd.STATES.map(function (s) { return '<option value="' + s + '">' + Vpd.LABEL[s] + '</option>'; }).join('');
    ['s-status', 's-eim', 's-mail'].forEach(function (id) { $(id).hidden = false; });
    renderAll();
    makeDrafts();
  }
  function opts(a, all) { return '<option value="">' + all + '</option>' + a.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join(''); }
  function stat(k, v, cls) { return '<div class="stat ' + (cls || '') + '"><b>' + v + '</b>' + k + '</div>'; }

  /* ---------- 현황 ---------- */
  function ref() { return $('ref').value || Vpd.fmt(Vpd.today()); }
  function renderAll() {
    if (!state.data) return;
    state.judged = Vpd.judgeAll(state.data.items, ref(), +$('soon').value || 0);
    var t = Vpd.totals(state.judged);
    $('totals').innerHTML = '<div class="stats">' + stat('전체', t.total) + stat('완료율(보류 제외)', t.rate + '%', 's-done') +
      Vpd.STATES.map(function (s) { return stat(Vpd.LABEL[s], t[s], 's-' + s); }).join('') + stat('산출물 미등록', t.noLink, 's-nolink') + '</div>';
    $('by-model').innerHTML = groupTable(Vpd.groupBy(state.judged, 'model'), '기종', 'model');
    $('by-owner').innerHTML = groupTable(Vpd.groupBy(state.judged, 'owner'), '담당자', 'owner');
    renderItems();
    renderEim();
  }
  function groupTable(g, name, key) {
    return '<table><thead><tr><th>' + name + '</th><th>전체</th><th>완료율</th><th>지연</th><th>임박</th><th>진행</th><th>미착수</th><th>산출물 미등록</th></tr></thead><tbody>' +
      g.map(function (r) {
        return '<tr class="pick" data-k="' + key + '" data-v="' + esc(r.key) + '" title="눌러서 이 ' + name + '만 보기"><td>' + esc(r.key) + (r.dept && key === 'owner' ? ' <small class="sub">' + esc(r.dept) + '</small>' : '') + '</td><td class="num">' + r.total +
          '</td><td class="num"><span class="bar"><i style="width:' + r.rate + '%"></i></span>' + r.rate + '%</td><td class="num' + (r.late ? ' nolink' : '') + '">' + r.late +
          '</td><td class="num">' + r.soon + '</td><td class="num">' + r.progress + '</td><td class="num">' + r.notstarted + '</td><td class="num' + (r.noLink ? ' nolink' : '') + '">' + r.noLink + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  function renderItems() {
    var fm = $('f-model').value, fo = $('f-owner').value, fs = $('f-state').value, fl = $('f-nolink').checked;
    var list = state.judged.filter(function (j) {
      return (!fm || j.model === fm) && (!fo || j.owner === fo) && (!fs || j.state === fs) && (!fl || j.noLink);
    });
    $('f-count').textContent = list.length + ' / ' + state.judged.length + '건';
    $('items').innerHTML = '<table><thead><tr><th>기종</th><th>검증항목</th><th>담당</th><th>계획일</th><th>완료일</th><th>D-day</th><th>판정</th><th>근거</th><th>산출물</th><th>비고</th></tr></thead><tbody>' +
      list.map(function (j) {
        return '<tr class="' + (j.state === 'late' ? 'r-late' : '') + '"><td>' + esc(j.model) + '</td><td class="item">' + esc(j.item) + '</td><td>' + esc(j.owner) + ' <small class="sub">' + esc(j.dept) + '</small></td>' +
          '<td>' + Vpd.fmt(j.plan) + '</td><td>' + Vpd.fmt(j.done) + '</td><td class="num">' + Vpd.dday(j) + '</td>' +
          '<td><span class="st st-' + j.state + '">' + Vpd.LABEL[j.state] + (j.lateDone ? ' · 지연 완료' : '') + '</span><span class="tag ' + j.basis + '">' + (j.basis === 'doc' ? '문서' : '계산') + '</span></td>' +
          '<td class="why">' + esc(j.why) + '</td>' +
          '<td>' + (j.link ? linkCell(j.link) : j.noLink ? '<span class="nolink">미등록</span>' : '<span class="sub">—</span>') + '</td><td class="why">' + esc(j.note) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  function linkCell(l) { return /^https?:\/\//i.test(l) ? '<a href="' + esc(l) + '" target="_blank" rel="noopener">등록됨</a>' : '<span title="' + esc(l) + '">등록됨</span>'; }

  /* ---------- EIM ---------- */
  function renderEim() {
    state.eim = Vpd.eim(state.judged, ref(), { top: +$('eim-top').value || 10 });
    $('eim-text').value = state.eim.text;
  }

  /* ---------- 템플릿 ---------- */
  function loadTpls() {
    var saved = {}; try { saved = JSON.parse(localStorage.getItem(LS_TPL) || '{}'); } catch (e) { saved = {}; }
    return Vpd.TEMPLATES.map(function (t) { var s = saved[t.id]; return { id: t.id, name: t.name, subject: s ? s.subject : t.subject, body: s ? s.body : t.body }; });
  }
  function curTpl() { return state.tpls.filter(function (t) { return t.id === $('m-tpl').value; })[0] || state.tpls[0]; }
  function showTpl() { var t = curTpl(); $('m-subject').value = t.subject; $('m-body').value = t.body; }
  function editTpl() { var t = curTpl(); t.subject = $('m-subject').value; t.body = $('m-body').value; }
  function saveTpls() {
    var o = {}; state.tpls.forEach(function (t) { o[t.id] = { subject: t.subject, body: t.body }; });
    try { localStorage.setItem(LS_TPL, JSON.stringify(o)); flash('tpl-msg', '이 브라우저에 저장했습니다'); } catch (e) { flash('tpl-msg', '저장하지 못했습니다'); }
  }
  function resetTpl() {
    var base = Vpd.TEMPLATES.filter(function (t) { return t.id === $('m-tpl').value; })[0], t = curTpl();
    t.subject = base.subject; t.body = base.body; showTpl(); saveTpls(); makeDrafts();
  }
  // 대상 종류에 맞는 템플릿을 고른다 — 지연 대상에 「사전 안내」 문구가 나가지 않게
  var MODE_TPL = { dn: 'pre', within: 'pre', open: 'pre', late: 'late', nolink: 'link' };

  /* ---------- 메일 초안 ---------- */
  function makeDrafts() {
    if (!state.data) return;
    editTpl();
    var mode = $('m-mode').value, n = +$('m-n').value || 0;
    $('m-n').closest('label').hidden = ['dn', 'within'].indexOf(mode) < 0;
    var list = Vpd.targets(state.judged, mode, n);
    var groups = Vpd.byOwner(list);
    state.drafts = Vpd.drafts(groups, curTpl(), ref(), $('m-cc').value.trim());
    var label = $('m-mode').selectedOptions[0].textContent.replace(/n/, n);
    $('m-target').innerHTML = '<div class="note">기준일 ' + esc(ref()) + ' · 대상 「' + esc(label) + '」 — 항목 <b>' + list.length + '</b>건, 담당자 <b>' + groups.length + '</b>명' +
      (list.length ? '' : '. 이 조건에 맞는 항목이 없습니다. 대상이나 n 을 바꿔 보세요.') + '</div>';
    var key = getAi();
    $('drafts').innerHTML = '<div class="drafts">' + state.drafts.map(function (d, i) {
      return '<div class="draft" data-i="' + i + '"><h4>' + esc(d.owner) + ' <small class="sub">' + esc(d.dept) + ' · ' + d.count + '건</small></h4>' +
        '<div class="meta">받는 사람 ' + (d.email ? esc(d.email) : '<span class="nolink">이메일 없음</span>') + (d.unknown.length ? ' · <span class="nolink">모르는 변수 ' + d.unknown.map(function (k) { return '{' + esc(k) + '}'; }).join(' ') + '</span>' : '') + '</div>' +
        '<input class="d-subj" value="' + esc(d.subject) + '" aria-label="제목"><textarea class="d-body" rows="10" aria-label="본문">' + esc(d.body) + '</textarea>' +
        '<div class="btnrow"><button class="btn sm d-copy">본문 복사</button><a class="btn sm d-mailto" href="' + esc(d.mailto.href) + '">메일 프로그램으로 열기</a>' +
        (key.key ? '<button class="btn sm d-ai">AI 로 문장 다듬기</button>' : '') + '<span class="sub d-msg" aria-live="polite"></span></div>' +
        (d.mailto.long ? '<p class="sub">본문이 길어 메일 프로그램에 다 들어가지 않을 수 있습니다. 「본문 복사」를 쓰세요.</p>' : '') + '</div>';
    }).join('') + '</div>';
  }
  // 초안 칸을 고치면 mailto 도 고친 글로 다시 만든다
  function syncDraft(card) {
    var i = +card.dataset.i, d = state.drafts[i];
    d.subject = card.querySelector('.d-subj').value; d.body = card.querySelector('.d-body').value;
    d.mailto = Vpd.mailto(d.email, $('m-cc').value.trim(), d.subject, d.body);
    card.querySelector('.d-mailto').href = d.mailto.href;
  }
  function copy(text, msgEl) {
    function done(ok) { msgEl.textContent = ok ? '복사했습니다' : '복사하지 못했습니다 — 직접 선택해 복사하세요'; setTimeout(function () { msgEl.textContent = ''; }, 2500); }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallback(text)); });
    else done(fallback(text));
  }
  function fallback(text) {
    var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta); return ok;
  }
  function flash(id, msg) { $(id).textContent = msg; setTimeout(function () { $(id).textContent = ''; }, 2500); }

  /* ---------- AI (선택) ---------- */
  function getAi() { try { return JSON.parse(localStorage.getItem(LS_AI) || '{}'); } catch (e) { return {}; } }
  function aiPolish(card) {
    var ai = getAi(), i = +card.dataset.i, d = state.drafts[i];
    if (!ai.key) return;
    if (!confirm('이 초안 한 통(제목·본문)을 ' + (ai.provider === 'anthropic' ? 'Anthropic' : 'OpenAI') + ' 로 보냅니다.\n사내 기밀(기종 코드·일정 등)이 들어 있으면 보내지 마세요. 계속할까요?')) return;
    var msg = card.querySelector('.d-msg'); msg.textContent = 'AI 에 요청 중…';
    var req = Vpd.aiRequest(ai.provider, ai.key,
      '너는 사내 업무 메일을 다듬는 도우미다. 사실(이름·기종·항목·날짜)은 바꾸지 말고, 정중하고 간결한 한국어 존댓말로 다듬어 줘. 제목은 첫 줄에 「제목: 」으로, 본문은 그 아래에 써 줘.',
      '제목: ' + d.subject + '\n\n' + d.body);
    fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error((j.error && j.error.message) || r.status); return j; }); })
      .then(function (j) {
        msg.textContent = '';
        var old = card.querySelector('.ai-out'); if (old) old.remove();
        var box = document.createElement('div'); box.className = 'ai-out';
        box.innerHTML = '<b>AI 초안 — 검토 필요</b>' + esc(Vpd.aiText(ai.provider, j));
        card.appendChild(box);
      })
      .catch(function (e) { msg.textContent = 'AI 요청 실패: ' + e.message; });
  }

  /* ---------- 엑셀 ---------- */
  function exportXlsx() {
    var wb = XLSX.utils.book_new(), j = state.judged;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(Vpd.exportRows(j)), '현황');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(Vpd.groupRows(Vpd.groupBy(j, 'model'), '기종')), '기종별');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(Vpd.groupRows(Vpd.groupBy(j, 'owner'), '담당자')), '담당자별');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(state.eim.text.split('\n').map(function (l) { return [l]; })), 'EIM요약');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['담당자', '부서', '이메일', '건수', '제목', '본문']].concat(state.drafts.map(function (d) {
      return [d.owner, d.dept, d.email, d.count, d.subject, d.body]; }))), '메일초안');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['기준일', ref()], ['임박 기준(일)', +$('soon').value || 0],
      ['판정 근거', '문서 = 상태·완료일 열에 적힌 값 / 계산 = 계획일과 기준일 비교'], ['주의', '이 파일의 판정은 도구가 계산한 것입니다. 원본 관리표를 기준으로 확인하세요.']]), '기준');
    XLSX.writeFile(wb, 'VPD_진행현황_' + ref() + '.xlsx');
  }
  function template(withSample) {
    var rows = withSample ? Vpd.sample(ref()) : [{ 기종: '', 검증항목: '', 담당부서: '', 담당자: '', 이메일: '', 계획일: '', 완료일: '', '산출물 링크': '', 상태: '', 비고: '' }];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '검증항목');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['열', '설명'], ['기종', '프로젝트·모델명'], ['검증항목', '가상검증 항목(액티비티)'], ['담당부서', '설계·기획·시험·생산기술·해석·검증용역 등'],
      ['담당자', '요청 메일을 받을 사람'], ['이메일', '메일 초안의 받는 사람'], ['계획일', '기한. 2026-11-09 형식이나 엑셀 날짜'],
      ['완료일', '실제 완료일(비우면 미완료)'], ['산출물 링크', 'SPDM 주소·공유 폴더 경로 등'], ['상태', '완료 · 진행중 · 보류 등(비워도 됨)'], ['비고', '이슈 메모 — EIM 요약에 함께 나갑니다']]), '작성법');
    XLSX.writeFile(wb, withSample ? 'VPD_검증항목_예제.xlsx' : 'VPD_검증항목_양식.xlsx');
  }

  /* ---------- 연결 ---------- */
  $('ref').value = Vpd.fmt(Vpd.today());
  $('m-tpl').innerHTML = state.tpls.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + '</option>'; }).join('');
  showTpl();
  $('m-vars').innerHTML = '변수 넣기: ' + Vpd.VARS.map(function (v) { return '<button type="button" data-v="{' + v + '}">{' + v + '}</button>'; }).join('');
  var ai0 = getAi(); $('ai-provider').value = ai0.provider || 'openai'; $('ai-key').value = ai0.key || '';

  $('file').addEventListener('change', function (e) { if (e.target.files[0]) readFile(e.target.files[0]); });
  var drop = $('drop');
  ['dragover', 'dragenter'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function () { drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { e.preventDefault(); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
  $('btn-sample').addEventListener('click', function () { load(Vpd.sample(ref()), '예제 검증항목(가짜 데이터)'); });
  $('btn-template').addEventListener('click', function () { template(false); });
  $('btn-sample-xlsx').addEventListener('click', function () { template(true); });
  ['ref', 'soon'].forEach(function (id) { $(id).addEventListener('change', function () { renderAll(); makeDrafts(); }); });
  $('btn-today').addEventListener('click', function () { $('ref').value = Vpd.fmt(Vpd.today()); renderAll(); makeDrafts(); });
  ['f-model', 'f-owner', 'f-state', 'f-nolink'].forEach(function (id) { $(id).addEventListener('change', renderItems); });
  ['by-model', 'by-owner'].forEach(function (id) {
    $(id).addEventListener('click', function (e) {
      var tr = e.target.closest('tr.pick'); if (!tr) return;
      $(tr.dataset.k === 'model' ? 'f-model' : 'f-owner').value = tr.dataset.v; renderItems();
      $('items').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  $('btn-export').addEventListener('click', exportXlsx);
  $('eim-top').addEventListener('change', renderEim);
  $('btn-eim-copy').addEventListener('click', function () { copy($('eim-text').value, $('eim-msg')); });

  $('m-mode').addEventListener('change', function () { $('m-tpl').value = MODE_TPL[$('m-mode').value]; showTpl(); makeDrafts(); });
  $('m-tpl').addEventListener('change', function () { showTpl(); makeDrafts(); });
  ['m-n', 'm-cc'].forEach(function (id) { $(id).addEventListener('change', makeDrafts); });
  $('btn-drafts').addEventListener('click', makeDrafts);
  $('btn-tpl-save').addEventListener('click', function () { editTpl(); saveTpls(); makeDrafts(); });
  $('btn-tpl-reset').addEventListener('click', resetTpl);
  var lastField = $('m-body');
  ['m-subject', 'm-body'].forEach(function (id) { $(id).addEventListener('focus', function () { lastField = $(id); }); });
  $('m-vars').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-v]'); if (!b) return;
    var el = lastField, s = el.selectionStart == null ? el.value.length : el.selectionStart, en = el.selectionEnd == null ? s : el.selectionEnd;
    el.value = el.value.slice(0, s) + b.dataset.v + el.value.slice(en); el.focus(); el.selectionStart = el.selectionEnd = s + b.dataset.v.length;
  });
  $('drafts').addEventListener('input', function (e) { var c = e.target.closest('.draft'); if (c) syncDraft(c); });
  $('drafts').addEventListener('click', function (e) {
    var c = e.target.closest('.draft'); if (!c) return;
    if (e.target.classList.contains('d-copy')) { syncDraft(c); var d = state.drafts[+c.dataset.i]; copy('제목: ' + d.subject + '\n\n' + d.body, c.querySelector('.d-msg')); }
    if (e.target.classList.contains('d-ai')) aiPolish(c);
  });
  $('ai-save').addEventListener('click', function () {
    localStorage.setItem(LS_AI, JSON.stringify({ provider: $('ai-provider').value, key: $('ai-key').value.trim() }));
    flash('ai-msg', '키를 이 브라우저에 저장했습니다'); makeDrafts();
  });
  $('ai-clear').addEventListener('click', function () { localStorage.removeItem(LS_AI); $('ai-key').value = ''; flash('ai-msg', '키를 지웠습니다'); makeDrafts(); });
  window.__app = { state: state };                           // 연기 테스트용
})();
