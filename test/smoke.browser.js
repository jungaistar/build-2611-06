/* 브라우저에 실제로 띄워 화면이 그려지는지 본다 — node test/smoke.browser.js
 * 규칙 테스트가 다 통과해도 app.js 오타 하나면 빈 화면이 된다. playwright 가 없으면 건너뛴다. */
'use strict';
var http = require('http'), fs = require('fs'), path = require('path');
var chromium;
try { chromium = require('playwright').chromium; }
catch (e) { console.log('playwright 가 없어 화면 연기 테스트를 건너뜁니다.'); process.exit(0); }
var ROOT = path.join(__dirname, '..');
var MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
var srv = http.createServer(function (q, s) {
  var p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, function (e, b) { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); s.end(b); });
});
var passed = 0, failed = 0, v10 = null;
function ok(c, label, d) { if (c) passed++; else { failed++; console.log('  X ' + label + (d ? '  ' + d : '')); } }
srv.listen(0, async function () {
  var base = 'http://127.0.0.1:' + srv.address().port + '/';
  var br = await chromium.launch();
  var ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  var pg = await ctx.newPage();
  var errs = []; pg.on('pageerror', function (e) { errs.push(e.message); });
  try {
    await pg.goto(base + 'progress.html');          // v1.0 도구는 progress.html 로 옮겼다(v2.0)
    await pg.click('#btn-sample');
    await pg.waitForSelector('#items tbody tr', { timeout: 5000 });
    ok(await pg.isVisible('#s-status'), '진행 현황 영역이 열린다');
    var rows = await pg.$$eval('#items tbody tr', function (t) { return t.length; });
    ok(rows >= 30, '검증항목 30여 줄이 그려진다', rows);
    ok(await pg.$$eval('#items .st-late', function (t) { return t.length; }) > 0, '지연 판정이 보인다');
    ok(await pg.$$eval('#items .nolink', function (t) { return t.length; }) > 0, '산출물 미등록 표시가 보인다');
    ok(await pg.$$eval('#by-model tbody tr', function (t) { return t.length; }) === 3, '기종별 표 3줄');
    // 기종 줄을 누르면 그 기종만
    await pg.click('#by-model tbody tr:first-child');
    var cnt = await pg.textContent('#f-count');
    ok(/^1[12] \//.test(cnt), '기종 줄을 누르면 그 기종 항목만', cnt);
    // 판정 근거 표기
    ok(await pg.$$eval('#items .tag.calc', function (t) { return t.length; }) > 0, '계산 근거 표시');
    // EIM
    var eim = await pg.inputValue('#eim-text');
    ok(/주요 지연 이슈/.test(eim) && /일 지연/.test(eim), 'EIM 요약에 지연 이슈', eim.slice(0, 60));
    await pg.click('#btn-eim-copy');
    await pg.waitForFunction(function () { return /복사/.test(document.getElementById('eim-msg').textContent); }, null, { timeout: 3000 });
    ok(/복사했습니다/.test(await pg.textContent('#eim-msg')), 'EIM 요약 복사');
    // 메일 — 기본 D-7
    var drafts = await pg.$$eval('#drafts .draft', function (t) { return t.length; });
    ok(drafts >= 1, 'D-7 대상 초안이 만들어진다', drafts);
    var href = await pg.getAttribute('#drafts .d-mailto', 'href');
    ok(/^mailto:[^?]+@example\.com\?subject=/.test(href), 'mailto 링크', href.slice(0, 60));
    var body = await pg.inputValue('#drafts .d-body');
    ok(!/\{(담당자|기종|항목|기한)\}/.test(body) && /님 안녕하세요/.test(body), '본문 변수가 치환된다');
    // 템플릿 편집이 초안에 반영된다
    await pg.fill('#m-subject', '[테스트] {담당자} / {기종} / {기한}');
    await pg.click('#btn-drafts');
    var subj = await pg.inputValue('#drafts .d-subj');
    ok(/^\[테스트\] .+ \/ .+ \/ \d{4}-\d\d-\d\d$/.test(subj), '고친 템플릿이 초안에 반영', subj);
    // 지연 대상 → 지연 템플릿
    await pg.selectOption('#m-mode', 'late');
    ok(await pg.inputValue('#m-tpl') === 'late', '지연 대상은 지연 템플릿으로 바뀐다');
    ok(/항목 <b>6<\/b>건/.test(await pg.innerHTML('#m-target')), '지연 대상 6건');
    ok(await pg.isHidden('#m-n'), '지연 대상에서는 n 입력이 숨는다');
    // 기준일 변경이 판정을 바꾼다
    var late0 = await pg.$$eval('#totals .s-late b', function (t) { return t[0].textContent; });
    await pg.fill('#ref', '2099-01-01'); await pg.dispatchEvent('#ref', 'change');
    var late1 = await pg.$$eval('#totals .s-late b', function (t) { return t[0].textContent; });
    ok(+late1 > +late0, '기준일을 늦추면 지연이 는다', late0 + '→' + late1);
    // 엑셀 내보내기
    var dl = pg.waitForEvent('download');
    await pg.click('#btn-export');
    var f = await dl;
    ok(/^VPD_진행현황_.+\.xlsx$/.test(f.suggestedFilename()), '엑셀 내보내기', f.suggestedFilename());
    // 예제 엑셀을 내려받아 다시 올리면 같은 건수로 읽힌다(파일 읽기 경로)
    var dl2 = pg.waitForEvent('download');
    await pg.click('#btn-sample-xlsx');
    var fp = await (await dl2).path();
    await pg.setInputFiles('#file', { name: 'VPD_검증항목_예제.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: fs.readFileSync(fp) });
    await pg.waitForFunction(function () { return /VPD_검증항목_예제\.xlsx/.test(document.getElementById('data-status').textContent); }, null, { timeout: 5000 });
    ok(/^34 \/ 34건$/.test(await pg.textContent('#f-count')), '엑셀로 올려도 34건', await pg.textContent('#f-count'));
    // 360px 가로 넘침 없음
    await pg.setViewportSize({ width: 360, height: 800 });
    var over = await pg.evaluate(function () {
      var W = document.documentElement.clientWidth, bad = [];
      document.querySelectorAll('main *').forEach(function (el) {
        var r = el.getBoundingClientRect(); if (!r.width) return;
        for (var p = el.parentElement; p; p = p.parentElement) { var ox = getComputedStyle(p).overflowX; if (ox === 'auto' || ox === 'scroll') return; }
        if (r.right > W + 1) bad.push(el.tagName + '.' + el.className);
      });
      return bad.slice(0, 5);
    });
    ok(!over.length, '360px 가로 넘침 없음', over.join(', '));
    await pg.goto(base + 'guide.html');
    ok(/판정 규칙/.test(await pg.textContent('main')), '사용법 페이지');
    await pg.setViewportSize({ width: 1280, height: 900 });

    /* ===================== v2.0 math & load 데이터 관리 ===================== */
    v10 = passed + failed;
    var XLSX = require('../lib/xlsx.full.min.js');
    function xbuf(aoa) { var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '입력'); return Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })); }
    await pg.goto(base);
    ok(/아직 양식이 없습니다/.test(await pg.textContent('#t-summary')), '처음엔 양식 없음');
    ok(await pg.isHidden('#s-input'), '프로젝트 없으면 입력 영역이 닫혀 있다');
    await pg.click('#btn-p-sample');
    await pg.waitForSelector('table.projects tbody tr', { timeout: 5000 });
    ok(/시트/.test(await pg.textContent('#t-summary')) && await pg.$$eval('#t-summary tbody tr', function (t) { return t.length; }) === 9, '양식 요약 표 9줄(표 단위)');
    ok(await pg.$$eval('table.projects tbody tr', function (t) { return t.length; }) === 1 && /GS-EX120/.test(await pg.textContent('table.projects')), '예제 프로젝트 1건');
    ok(await pg.isVisible('#s-input') && /GS-EX120/.test(await pg.textContent('#cur-title')), '입력 영역이 열린다');
    var exp = await pg.evaluate(function () { var S = Vpdm.sampleProject('2026-11-04 09:00'), p = Vpdm.progress(S, 'team').total; return { items: S.items.length, done: p.done, total: p.total, bpf: S.items.filter(function (i) { return i.data === '1st BPF @ max'; })[0].values['값'] }; });
    ok((await pg.textContent('#items-count')).indexOf(exp.items + '개') >= 0, '항목 수 = 엔진', await pg.textContent('#items-count'));
    var autoCell = await pg.$$eval('table.items td.auto', function (t) { return t.map(function (x) { return x.textContent; }); });
    ok(autoCell.some(function (t) { return t.indexOf(exp.bpf) >= 0; }), '자동 계산 칸에 엔진 값(' + exp.bpf + ')', autoCell.join('|').slice(0, 80));
    ok(/입력 완료/.test(await pg.textContent('#st-table')) && new RegExp(exp.done + '/' + exp.total).test(await pg.textContent('table.projects')), '현황 · 입력률 = 엔진', await pg.textContent('table.projects'));
    // 값 넣기 → 저장 · 자동 계산 · 이력
    await pg.fill('#f-by', '테스트 작업자'); await pg.dispatchEvent('#f-by', 'change');
    await pg.selectOption('#f-status', 'empty');
    var firstEmpty = await pg.$('table.items input.val[value=""]');
    var itemId = await firstEmpty.getAttribute('data-item');
    await firstEmpty.fill('12'); await firstEmpty.dispatchEvent('change');
    await pg.selectOption('#f-status', '');
    var saved = await pg.$eval('tr[data-item="' + itemId + '"]', function (tr) { return tr.textContent; });
    ok(/테스트 작업자/.test(saved) && /(일부|입력 완료)/.test(saved), '값을 넣으면 작업자 · 상태가 바뀐다', saved.slice(0, 80));
    ok(/테스트 작업자/.test(await pg.textContent('#hist')), '변경 이력에 남는다');
    await pg.reload(); await pg.waitForSelector('table.items', { timeout: 5000 });
    ok(/테스트 작업자/.test(await pg.textContent('#hist')), '다시 열어도 남아 있다');
    // 작업자 이름 없이 넣으면 막는다
    await pg.fill('#f-by', ''); await pg.dispatchEvent('#f-by', 'change');
    var e2 = await pg.$('table.items input.val[value=""]'); await e2.fill('7'); await e2.dispatchEvent('change');
    ok(/작업자 이름/.test(await pg.textContent('#i-msg')) && await e2.inputValue() === '', '작업자 이름 없으면 저장하지 않는다');
    await pg.fill('#f-by', '테스트 작업자'); await pg.dispatchEvent('#f-by', 'change');
    // 거르기 · 현황 묶기 · 미입력 글
    await pg.selectOption('#f-sheet', 'Mass');
    ok(await pg.$$eval('table.items', function (t) { return t.length; }) === 2, 'Mass 시트만(표 2개)');
    await pg.selectOption('#f-sheet', '');
    await pg.selectOption('#st-by', 'sheet');
    ok(/시트/.test(await pg.textContent('#st-table thead')), '현황을 시트별로');
    ok(/■ /.test(await pg.inputValue('#st-missing')) && /미입력 항목/.test(await pg.inputValue('#st-missing')), '미입력 목록 글');
    // 팀 입력 파일 → 채워서 병합
    await pg.selectOption('#sh-team', 'PTI');
    var dl3 = await Promise.all([pg.waitForEvent('download', { timeout: 5000 }), pg.click('#btn-team-xlsx')]);
    var wbT = XLSX.read(fs.readFileSync(await dl3[0].path()), { type: 'buffer' });
    var aoaT = XLSX.utils.sheet_to_json(wbT.Sheets['입력'], { header: 1, defval: '' });
    ok(/_PTI_입력\.xlsx$/.test(dl3[0].suggestedFilename()) && aoaT[0][0] === '항목ID' && aoaT.length > 5, '팀 입력 엑셀(항목ID 열)', dl3[0].suggestedFilename());
    var ci = aoaT[0].indexOf('Z'), ri = aoaT.findIndex(function (r) { return r[6] === 'Engine Total'; });
    aoaT[ri][ci] = '77'; aoaT[ri][aoaT[0].indexOf('수정시각')] = '2026-12-01 09:00'; aoaT[ri][aoaT[0].indexOf('수정자')] = '팀원';
    await pg.setInputFiles('#sh-file', { name: 'back.xlsx', mimeType: 'application/octet-stream', buffer: xbuf(aoaT) });
    await pg.waitForFunction(function () { return /병합/.test(document.getElementById('sh-msg').textContent); }, null, { timeout: 5000 });
    ok(/새로 채운 칸 1/.test(await pg.textContent('#sh-msg')), '되돌려 받은 엑셀 병합 — 새로 채운 칸 1', (await pg.textContent('#sh-msg')).slice(0, 100));
    ok(/병합 팀원/.test(await pg.textContent('#hist')), '병합 이력(누가 보낸 값인지)');
    await pg.setInputFiles('#sh-file', { name: 'other.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ kind: 'vpd-team-pack', project: { code: 'ZZZ' }, items: [] })) });
    await pg.waitForFunction(function () { return /다른 프로젝트/.test(document.getElementById('sh-msg').textContent); }, null, { timeout: 5000 });
    ok(true, '다른 프로젝트 파일은 거른다');
    // 취합본 · 백업 · 확정
    var dl4 = await Promise.all([pg.waitForEvent('download', { timeout: 5000 }), pg.click('#btn-all-xlsx')]);
    var wbA = XLSX.read(fs.readFileSync(await dl4[0].path()), { type: 'buffer' });
    ok(['프로젝트', 'Input(NVH)', 'Mass', '현황', '이력'].every(function (n) { return wbA.SheetNames.indexOf(n) >= 0; }), '취합본 시트', wbA.SheetNames.join(','));
    var dl5 = await Promise.all([pg.waitForEvent('download', { timeout: 5000 }), pg.click('#btn-backup')]);
    ok(/백업_.*\.json$/.test(dl5[0].suggestedFilename()), '백업 JSON');
    await pg.click('#btn-confirm');
    ok(/확정/.test(await pg.textContent('table.projects')) && /확정/.test(await pg.textContent('#cur-title')), '최종 확정 표시');
    // 새 프로젝트 만들기(양식 있음)
    await pg.click('#btn-p-create');
    ok(/기종코드를 적어/.test(await pg.textContent('#p-msg')), '코드 없이 만들면 알린다');
    await pg.fill('#p-code', 'T-2'); await pg.fill('#p-name', '테스트 기종'); await pg.click('#btn-p-create');
    ok(await pg.$$eval('table.projects tbody tr', function (t) { return t.length; }) === 2 && /T-2/.test(await pg.textContent('#cur-title')), '새 프로젝트 2번째 · 선택됨');
    ok(await pg.$$eval('table.items input.val', function (t) { return t.filter(function (i) { return i.value; }).length; }) === 0, '새 프로젝트는 전부 빈칸');
    // 양식 파일 올리기(예제 양식을 엑셀로 만들어)
    var sheets = await pg.evaluate(function () { return Vpdm.sampleSheets(); });
    var wbS = XLSX.utils.book_new(); sheets.forEach(function (sh) { XLSX.utils.book_append_sheet(wbS, XLSX.utils.aoa_to_sheet(sh.aoa.map(function (r) { return r.map(function (c) { return typeof c === 'string' && c.charAt(0) === '=' ? { t: 'n', v: 0, f: c.slice(1) } : c; }); })), sh.name); });
    await pg.setInputFiles('#t-file', { name: '양식_테스트.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from(XLSX.write(wbS, { type: 'array', bookType: 'xlsx' })) });
    await pg.waitForFunction(function () { return /양식_테스트/.test(document.getElementById('t-msg').textContent); }, null, { timeout: 5000 });
    ok(/항목 26개 · 자동 계산 5개/.test(await pg.textContent('#t-msg')), '엑셀 양식을 올려 읽음(수식 포함)', (await pg.textContent('#t-msg')).slice(0, 100));
    // 360px
    await pg.setViewportSize({ width: 360, height: 800 });
    var over2 = await pg.evaluate(function () { return document.documentElement.scrollWidth - document.documentElement.clientWidth; });
    ok(over2 <= 0, '360px 데이터 관리 가로 넘침 없음', over2);
    await pg.setViewportSize({ width: 1280, height: 900 });
    await pg.goto(base + 'guide.html');
    ok(/양식 올리기/.test(await pg.textContent('main')) && /병합/.test(await pg.textContent('main')), '사용법에 v2.0 절');
    await pg.evaluate(function () { localStorage.clear(); });
  } catch (e) { failed++; console.log('  X 예외: ' + e.message); }
  ok(!errs.length, '페이지 오류 없음', errs.join(' | '));
  await br.close(); srv.close();
  if (v10 != null) console.log('v1.0 ' + (v10 + 1) + ' · v2.0 ' + (passed + failed - v10 - 1) + '개 검사');
  console.log('\n화면 통과 ' + passed + ' · 실패 ' + failed);
  process.exit(failed ? 1 : 0);
});
