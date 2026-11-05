/* 판정 규칙 고정 — node test/logic.test.js
 * 지연·임박 판정이 하루만 어긋나도 엉뚱한 사람에게 독촉 메일이 간다. 손으로 센 값과 대조한다. */
'use strict';
var V = require('../js/vpd.js');
var passed = 0, failed = 0;
function ok(c, label, detail) { if (c) passed++; else { failed++; console.log('  X ' + label + (detail ? '\n      ' + detail : '')); } }
function eq(g, w, label) { ok(JSON.stringify(g) === JSON.stringify(w), label, '기대: ' + JSON.stringify(w) + '  실제: ' + JSON.stringify(g)); }

// 날짜
eq(V.fmt(V.toDate('2026-11-02')), '2026-11-02', 'ISO 날짜');
eq(V.fmt(V.toDate('2026.11.2')), '2026-11-02', '점 구분 날짜');
eq(V.fmt(V.toDate('2026년 11월 2일')), '2026-11-02', '한글 날짜');
eq(V.fmt(V.toDate(46328)), '2026-11-02', '엑셀 일련번호');
eq(V.toDate('2026-02-30'), null, '없는 날짜는 거른다');
eq(V.diffDays(V.toDate('2026-11-09'), V.toDate('2026-11-02')), 7, '날짜 차이 7일');

// 상태 낱말
eq(V.statusKind(' 완 료 '), 'done', '공백 섞인 「완료」');
eq(V.statusKind('진행중'), 'progress', '「진행중」 = 진행');
eq(V.statusKind('보류'), 'hold', '「보류」');
eq(V.statusKind('검토 예정'), 'other', '모르는 상태');
eq(V.statusKind(''), '', '빈 상태');

// 열 이름 별칭 + 경고
var raw = [
  { '모델': 'A', '항목': '강도 해석', '부서': '해석', '담당': '갑', '메일': 'a@x.com', '기한': '2026-11-09', '완료일': '', '산출물': '', '상태': '' },
  { '모델': 'A', '항목': '간섭 검토', '부서': '설계', '담당': '', '메일': 'bad', '기한': '', '완료일': '어제', '산출물': '', '상태': '모름' },
  { '모델': '', '항목': '', '담당': '' },
  { '모델': 'A', '항목': '강도 해석', '부서': '해석', '담당': '갑', '기한': '2026-11-10' }
];
var n = V.normalize(raw);
eq(n.items.length, 3, '빈 줄만 빠지고 나머지는 남는다');
eq(n.items[0].plan && V.fmt(n.items[0].plan), '2026-11-09', '「기한」 열을 계획일로 읽는다');
eq(n.items[1].owner, '(미지정)', '담당자가 없으면 (미지정)');
ok(n.issues.some(function (s) { return /3행.*계획일/.test(s); }), '계획일 없음 경고(행 번호 포함)', n.issues.join(' / '));
ok(n.issues.some(function (s) { return /완료일을 날짜로/.test(s); }), '완료일 형식 경고');
ok(n.issues.some(function (s) { return /이메일 형식/.test(s); }), '이메일 형식 경고');
ok(n.issues.some(function (s) { return /상태 「모름」/.test(s); }), '모르는 상태 경고');
ok(n.issues.some(function (s) { return /5행.*2행과 겹칩니다/.test(s); }), '중복 항목 경고');

// 판정 — 기준일 2026-11-02, 임박 7일
var REF = '2026-11-02';
function J(o, ref, d) { return V.judge(Object.assign({ status: '', link: '' }, o, { plan: V.toDate(o.plan), done: V.toDate(o.done) }), ref || REF, d); }
eq(J({ plan: '2026-11-01' }).state, 'late', '어제가 기한 = 지연');
eq(J({ plan: '2026-11-01' }).lateDays, 1, '지연 1일');
eq(J({ plan: '2026-11-02' }).state, 'soon', '오늘이 기한 = 임박(D-day)');
eq(V.dday(J({ plan: '2026-11-02' })), 'D-day', 'D-day 표기');
eq(J({ plan: '2026-11-09' }).state, 'soon', 'D-7 = 임박(경계 포함)');
eq(J({ plan: '2026-11-10' }).state, 'notstarted', 'D-8 = 미착수');
eq(J({ plan: '2026-11-10', status: '진행중' }).state, 'progress', 'D-8 + 진행중 = 진행');
eq(J({ plan: '2026-11-10' }, REF, 10).state, 'soon', '임박 기준을 10일로 바꾸면 D-8 도 임박');
eq(J({ plan: '2026-10-20', status: '진행중' }).state, 'late', '진행중이어도 기한이 지나면 지연');
var d1 = J({ plan: '2026-10-20', done: '2026-10-25', link: 'http://x' });
eq([d1.state, d1.basis, d1.lateDone, d1.lateDays], ['done', 'doc', true, 5], '기한 뒤 완료 = 완료(지연 완료 5일), 근거는 문서');
eq(J({ plan: '2026-10-20', done: '2026-11-05' }).state, 'late', '완료일이 기준일보다 뒤면 그 시점엔 아직 미완료');
eq(J({ plan: '2026-10-20', done: '2026-11-05' }, '2026-11-06').state, 'done', '기준일을 옮기면 완료로 바뀐다');
eq(J({ plan: '2026-10-20', status: '완료' }).state, 'done', '완료일 없이 상태만 「완료」 = 완료');
eq(J({ plan: '2026-10-20', status: '보류' }).state, 'hold', '보류는 지연으로 세지 않는다');
eq(J({ plan: '' }).state, 'nodate', '계획일 없음 = 기한 없음');
eq(J({ plan: '2026-11-20' }).basis, 'calc', '기한 대비 판정은 「계산」 근거');
// 산출물 미등록
eq(J({ plan: '2026-10-20', status: '완료' }).noLink, true, '완료인데 링크 없음 = 산출물 미등록');
eq(J({ plan: '2026-10-20' }).noLink, true, '지연인데 링크 없음 = 산출물 미등록');
eq(J({ plan: '2026-11-20' }).noLink, false, '기한 전 항목은 미등록으로 보지 않는다');
eq(J({ plan: '2026-10-20', status: '완료', link: '\\\\share\\vpd\\a.pptx' }).noLink, false, '공유 폴더 경로도 등록으로 본다');

// 예제: 가짜 기종 3개 × 30여 항목, 기준일 = 예제 기준일
var s = V.sample(REF);
var sn = V.normalize(s), js = V.judgeAll(sn.items, REF, 7);
var models = js.map(function (j) { return j.model; }).filter(function (m, i, a) { return a.indexOf(m) === i; });
eq(models.length, 3, '예제 기종 3개');
ok(js.length >= 30 && js.length <= 40, '예제 항목 30여 개', js.length);
ok(models.every(function (m) { return /가상/.test(m); }), '예제 기종 이름에 「가상」 표기');
var t = V.totals(js);
eq([t.total, t.done, t.late, t.soon, t.progress, t.notstarted, t.hold, t.nodate], [34, 9, 6, 9, 3, 3, 3, 1], '예제 판정 분포');
eq(t.total, V.STATES.reduce(function (a, k) { return a + t[k]; }, 0), '판정 합계 = 전체(빠지는 항목 없음)');
eq(t.rate, Math.round(9 / 31 * 1000) / 10, '완료율은 보류를 빼고 계산');
eq(t.noLink, 9, '예제 산출물 미등록 9건(완료 3 + 지연 6)');
var bm = V.groupBy(js, 'model');
eq(bm.map(function (b) { return b.total; }), [11, 11, 12], '기종별 항목 수');
var bo = V.groupBy(js, 'owner');
eq(bo.reduce(function (a, b) { return a + b.total; }, 0), js.length, '담당자별 합계 = 전체');

// EIM 요약
var e = V.eim(js, REF, { top: 3 });
eq(e.topLate.length, 3, '상위 3건만');
ok(e.topLate[0].lateDays >= e.topLate[1].lateDays && e.topLate[1].lateDays >= e.topLate[2].lateDays, '지연일 큰 순');
ok(/전체 6건/.test(e.text), '상위만 보일 때 전체 건수를 함께 적는다');
ok(/기준일 2026-11-02/.test(e.text), '요약에 기준일');

// 대상자 추출
var d7 = V.targets(js, 'dn', 7);
eq(d7.length, 3, 'D-7 정확히 = 기종마다 1건');
ok(d7.every(function (j) { return j.daysLeft === 7; }), 'D-7 대상은 남은 날 7');
eq(V.targets(js, 'within', 7).length, t.soon, '7일 이내 = 임박 건수');
eq(V.targets(js, 'late').length, 6, '지연 대상');
eq(V.targets(js, 'nolink').length, 9, '산출물 미등록 대상');
var g = V.byOwner(V.targets(js, 'late'));
eq(g.reduce(function (a, x) { return a + x.items.length; }, 0), 6, '담당자로 묶어도 건수 그대로');

// 메일 치환
var f = V.fill('{담당자}님 {기종} {항목} {기한} {오타}', { 담당자: '갑', 기종: 'A', 항목: '강도', 기한: '2026-11-09' });
eq(f.text, '갑님 A 강도 2026-11-09 {오타}', '변수 치환, 모르는 변수는 그대로');
eq(f.unknown, ['오타'], '모르는 변수를 알린다');
var grp = { owner: '갑', email: 'a@x.com', dept: '해석', items: [
  Object.assign({ model: 'A', item: '강도', noLink: false }, J({ plan: '2026-11-09' })),
  Object.assign({ model: 'B', item: '피로', noLink: false }, J({ plan: '2026-11-05' }))] };
grp.items.forEach(function (x) { x.plan = V.toDate(x.daysLeft === 7 ? '2026-11-09' : '2026-11-05'); });
grp.items.sort(function (a, b) { return a.plan - b.plan; });
var vv = V.varsFor(grp, REF);
eq([vv['항목'], vv['기한'], vv['기종'], vv['건수']], ['피로 외 1건', '2026-11-05', 'B, A', '2'], '여러 건이면 「외 n건」, 기한은 가장 이른 날');
var dr = V.drafts([grp], V.TEMPLATES[0], REF, 'lead@x.com')[0];
ok(/^갑님 안녕하세요/.test(dr.body) && dr.unknown.length === 0, '기본 템플릿에 남는 변수 없음', dr.unknown.join(','));
ok(dr.mailto.href.indexOf('mailto:a@x.com?cc=lead%40x.com&subject=') === 0, 'mailto 받는 사람·참조·제목', dr.mailto.href.slice(0, 60));
ok(/%0D%0A/.test(dr.mailto.href), 'mailto 본문 줄바꿈은 CRLF');
eq(V.mailto('a@x.com', '', '제목', new Array(800).join('가')).long, true, '긴 본문은 mailto 길이 경고');

// AI 요청 모양(선택 기능 — 네트워크 없이 모양만)
var ra = V.aiRequest('anthropic', 'k', 'sys', 'u');
eq([ra.body.model, ra.headers['x-api-key'], ra.headers['anthropic-version'], ra.headers['anthropic-dangerous-direct-browser-access']], ['claude-haiku-5-5', 'k', '2023-06-01', 'true'], 'Anthropic 요청 헤더·모델');
var ro = V.aiRequest('openai', 'k', 'sys', 'u');
eq([ro.url, ro.body.model, ro.headers.Authorization], ['https://api.openai.com/v1/chat/completions', 'gpt-4o-mini', 'Bearer k'], 'OpenAI 요청');
eq(V.aiText('anthropic', { content: [{ type: 'text', text: '가' }, { type: 'text', text: '나' }] }), '가나', 'Anthropic 응답 읽기');
eq(V.aiText('openai', { choices: [{ message: { content: '다' } }] }), '다', 'OpenAI 응답 읽기');

// 내보내기
var xr = V.exportRows(js);
eq(xr.length, js.length + 1, '현황 시트 = 머리줄 + 항목');
ok(xr.slice(1).every(function (r) { return /^(문서|계산): /.test(r[10]); }), '모든 줄에 판정 근거(문서/계산) 표기');


/* ===================== v2.0 math & load 데이터 관리 ===================== */
var v10 = passed + failed;
var M = require('../js/vpdm.js');
function has(t, sub, label) { ok(String(t).indexOf(sub) >= 0, label, '「' + sub + '」 없음: ' + String(t).slice(0, 160)); }
function byData(P, sheet, data) { return P.items.filter(function (i) { return i.sheet === sheet && i.data === data; })[0]; }
// 열 역할 · 열 글자
eq(M.roleOf('DATA'), 'data', 'DATA 역할'); eq(M.roleOf('필요 Data'), 'data', '필요 Data'); eq(M.roleOf('단위'), 'unit', '단위'); eq(M.roleOf('구분1'), 'cat1', '구분1'); eq(M.roleOf('Tube ID'), null, '값 칸은 역할 없음');
eq([M.colLetter(8), M.colIndex('I'), M.colLetter(27)], ['I', 8, 'AB'], '열 글자 ↔ 번호');
// 양식 읽기(예제 양식)
var T = M.sampleTemplate();
eq(T.issues, [], '예제 양식 경고 없음'); eq(T.counts, { sheets: 7, blocks: 9, items: 26, auto: 5, roster: 10 }, '시트 7 · 표 9 · 항목 26 · 자동 5 · 팀 10');
eq(T.fields.map(function (f) { return f.label; }), ['기종 타입', 'Grade(톤수)', '기종명', '기종코드'], '프로젝트 생성 칸 4'); eq(T.fields[0].hint, '굴착기, 휠로더', '# 안내는 힌트'); eq(T.roster[0], { team: 'VPD기획팀', part: 'VPM', hint: '홍길동' }, '담당자 표');
var nvh = T.sheets.filter(function (s) { return s.name === 'Input(NVH)'; })[0].blocks[0];
eq(nvh.cols.map(function (c) { return [c.label, c.letter, c.by]; }), [['값', 'I', '담당자']], '값 칸 · 열 글자 · 입력 주체'); eq(nvh.items[4].formulas['값'], '=I4/60*I6/2', '수식 셀은 수식으로'); eq(nvh.items[4].row, 7, '엑셀 줄 번호');
var ex = T.sheets[0].blocks[0]; eq(ex.cols.length, 6, 'Excalc2D 값 칸 6'); eq(ex.items[0].hints.bucket, '6.5', '예시 값은 힌트'); eq(ex.items[0].hints.excalc2dno, '4201', '# 힌트');
var mass = T.sheets.filter(function (s) { return s.name === 'Mass'; })[0]; eq(mass.blocks.length, 2, 'Mass 표 2개'); ok(/Main Frame 해석/.test(mass.blocks[0].notes), '참고 사항은 표 메모'); eq(mass.blocks[1].items.map(function (i) { return i.data; }), ['Air Cleaner Assy', 'Surge Tank Assy (Wet)'], 'Support 표 항목');
eq(T.sheets.filter(function (s) { return s.name === 'Mass(추가 데이터)'; })[0].blocks[0].items[0].data, 'Fuel · Mass', 'DATA1 · DATA2');
var ref = T.sheets.filter(function (s) { return s.name === 'Mass(Back up)'; })[0]; eq(ref.blocks[0].reference, true, '값 칸 없는 표는 참고 표'); eq(ref.blocks[0].items[0].required, true, '필수 값 O');
eq(M.parseTemplate([{ name: '메모', aoa: [['안녕'], ['세상']] }], 'x').issues.length, 2, '표 없는 양식은 알린다');
// 프로젝트
eq(M.createProject(T, { code: '', name: '' }, {}, '2026-11-04 09:00', []).errors, ['기종코드를 적어 주세요.', '기종명을 적어 주세요.'], '필수 칸');
var P = M.createProject(T, { code: 'EX-1', name: '가상', type: '굴착기', grade: '12t' }, { 'PTI/동력': '김동력', '유압/': '박유압' }, '2026-11-04 09:00', []).project;
eq(M.createProject(T, { code: 'ex-1', name: '다른' }, {}, '', [P]).errors, ['이미 있는 기종코드입니다: ex-1'], '같은 코드 거름');
eq(P.items.length, 31, '항목 26 + 자동 5(참고 표 제외)'); eq(byData(P, 'Input(NVH)', 'Low idle').owner, '김동력', '팀/파트 담당자 배정'); eq(P.items.filter(function (i) { return i.team === '유압'; })[0].owner, '박유압', '파트 없는 팀 담당자');
eq([M.status(P.items[0]), M.progress(P, 'team').total.total, M.progress(P, 'team').total.auto], ['empty', 26, 5], '처음엔 전부 미입력');
// 값 넣기 · 자동 계산
var low = byData(P, 'Input(NVH)', 'Low idle'), hi = byData(P, 'Input(NVH)', 'High idle'), cyl = byData(P, 'Input(NVH)', 'Cylinder #'), f1 = byData(P, 'Input(NVH)', 'Low Idle freq. (firing)'), f2 = byData(P, 'Input(NVH)', 'High Idle freq. (firing)'), up = byData(P, 'Input(NVH)', 'Upper limit target (1.2)');
var r = M.setValue(P, low.id, '값', '900', '김동력', '2026-11-04 10:00'); ok(r.changed && !r.warn, '값 넣기'); var Q = r.project;
eq(byData(P, 'Input(NVH)', 'Low idle').values, { '값': '' }, '원본 프로젝트는 그대로'); eq([Q.history[0].to, byData(Q, 'Input(NVH)', 'Low idle').updatedBy], ['900', '김동력'], '이력 · 작업자');
eq(M.setValue(Q, low.id, '값', '900', '김동력').changed, false, '같은 값은 바꾸지 않는다');
ok(/숫자가 아닙니다/.test(M.setValue(Q, low.id, '값', '많이', '김동력').warn), '단위 있는 칸에 글자면 경고');
ok(/자동 계산/.test(M.setValue(Q, f1.id, '값', '1', '김동력').error), '자동 칸은 직접 못 넣는다');
eq([byData(Q, 'Input(NVH)', 'Low Idle freq. (firing)').values['값'], byData(Q, 'Input(NVH)', 'Low Idle freq. (firing)').autoNote['값']], ['', '참조 값 대기'], '참조 값 비면 자동 칸은 빈칸 + 대기');
Q = M.setValue(Q, cyl.id, '값', '4', '김동력', '2026-11-04 10:01').project; Q = M.setValue(Q, hi.id, '값', '2200', '김동력', '2026-11-04 10:02').project;
eq([byData(Q, 'Input(NVH)', 'Low Idle freq. (firing)').values['값'], byData(Q, 'Input(NVH)', 'High Idle freq. (firing)').values['값'], byData(Q, 'Input(NVH)', 'Upper limit target (1.2)').values['값']], ['30', '73.333333', '88'], '900 rpm × 4기통 ÷ 2 ÷ 60 = 30 Hz · 수식이 수식을 참조(×1.2)');
eq(M.status(byData(Q, 'Input(NVH)', 'Low Idle freq. (firing)')), 'auto', '자동 상태');
eq(M.evalFormula('=I4/60*I6/2', function (c, r) { return { 4: 900, 6: 4 }[r]; }).value, 30, '수식 평가');
eq(M.evalFormula('=I13*I12*IF(I10="D",1,0.9)', function (c, r) { return { 13: 30, 12: 9, 10: 'D' }[r]; }).value, 270, 'IF 문자 비교(참)'); eq(M.evalFormula('=I13*I12*IF(I10="D",1,0.9)', function (c, r) { return { 13: 30, 12: 9, 10: 'C' }[r]; }).value, 243, 'IF 문자 비교(거짓)');
eq(M.evalFormula('=SUM(I4:I6)', function () { return 1; }).error, '수식 미지원', '모르는 함수'); eq(M.evalFormula('=I4/I5', function (c, r) { return { 4: 1, 5: 0 }[r]; }).error, '0 으로 나눔', '0 나누기'); ok(M.evalFormula('=I4', function () { return undefined; }).waiting, '참조 없으면 대기');
// 일부 입력 · 현황 · 미입력
var eng = byData(Q, 'Mass', 'Engine Total'); Q = M.setValue(Q, eng.id, 'mass', '620', '김동력', '2026-11-04 10:03').project;
eq(M.status(byData(Q, 'Mass', 'Engine Total')), 'partial', 'Mass 만 넣고 X·Y·Z 비면 일부');
var pr = M.progress(Q, 'team'); eq([pr.total.done, pr.total.partial, pr.total.empty], [3, 1, 22], '완료 3 · 일부 1 · 미입력 22'); eq(pr.rows[pr.rows.length - 1].key, 'PTI', '입력률 높은 팀이 뒤');
var ms = M.missing(Q, 'PTI'); ok(ms.every(function (m) { return m.team === 'PTI'; }) && ms.some(function (m) { return m.status === 'partial'; }), '팀별 미입력(일부 포함)'); eq(ms.filter(function (m) { return m.data === 'Engine Total'; })[0].emptyCols, ['x', 'y', 'z'], '빈 칸 이름');
has(M.missingText(Q), '■ PTI', '독촉 글 팀 머리'); has(M.missingText(Q), '· 일부 입력', '독촉 글 일부 표시');
eq([M.filterItems(Q, { sheet: 'Mass', status: 'partial' }).length, M.filterItems(Q, { q: 'engine' }).length], [1, 1], '거르기 · 찾기(대소문자 무시)');
// 배포(팀별) · 되돌려 받아 병합
var pk = M.teamPack(Q, 'PTI', '2026-11-04 11:00'); eq(pk.kind, 'vpd-team-pack', '배포 파일 종류');
ok(pk.items.every(function (i) { var src = Q.items.filter(function (x) { return x.id === i.id; })[0]; return !Object.keys(i.values).some(function (k) { return M.isAuto(src, k); }); }), '배포 파일에 자동 칸 없음');
var rows = M.teamRows(Q, 'PTI'); eq(rows[0].slice(0, 8), ['항목ID', '시트', '구분2', '팀', '파트', '담당자', 'DATA', '단위'], '팀 엑셀 머리글'); ok(rows[0].indexOf('Mass') >= 0 && rows[0].indexOf('값') >= 0, '값 칸 라벨');
var back = rows.slice(1).map(function (r) { var o = {}; rows[0].forEach(function (h, i) { o[h] = r[i]; }); return o; });
var engRow = back.filter(function (r) { return r.DATA === 'Engine Total'; })[0]; engRow.X = '1250'; engRow.Y = '-310'; engRow['수정시각'] = '2026-11-04 12:00'; engRow['수정자'] = '이프레임';
var lowRow = back.filter(function (r) { return r.DATA === 'Low idle'; })[0]; lowRow['값'] = '950'; lowRow['수정시각'] = '2026-11-04 09:30'; lowRow['수정자'] = '옛값';
back.filter(function (r) { return r.DATA === 'Name'; })[0]['값'] = 'D34';
var pk2 = M.packFromRows(back.concat([{ '항목ID': 'NOPE', '값': '1' }]), Q); eq(pk2.unknown, 1, '모르는 항목ID');
var mg = M.mergePack(Q, pk2, 'VPM', '2026-11-04 12:30');
eq(mg.report.applied.map(function (a) { return a.col + '=' + a.to; }).sort(), ['x=1250', 'y=-310', '값=D34'], '빈 칸은 채운다(시각 없어도)');
eq(mg.report.older.map(function (o) { return [o.col, o.ours, o.theirs]; }), [['값', '900', '950']], '더 오래된 값은 내 값을 지킨다'); ok(mg.report.same >= 1, '같은 값은 넘김');
eq([byData(mg.project, 'Mass', 'Engine Total').updatedBy, mg.project.history[0].merged, M.status(byData(mg.project, 'Mass', 'Engine Total'))], ['이프레임', true, 'partial'], '병합 이력 · Z 비어 아직 일부');
eq(M.mergePack(Q, { kind: 'x' }).error, '팀 배포 파일이 아닙니다.', '배포 파일 아님'); eq(M.mergePack(Q, { kind: 'vpd-team-pack', project: { code: 'OTHER' }, items: [] }).error, '다른 프로젝트의 파일입니다: OTHER', '다른 프로젝트');
var mg2 = M.mergePack(Q, { kind: 'vpd-team-pack', project: { code: 'EX-1' }, items: [{ id: low.id, values: { '값': '910' }, updatedAt: '2026-11-04 13:00', updatedBy: '새값' }] }, 'VPM', '2026-11-04 13:05');
eq([mg2.report.applied.length, byData(mg2.project, 'Input(NVH)', 'Low Idle freq. (firing)').values['값']], [1, '30.333333'], '받은 값이 더 새로우면 덮어쓰고 자동 계산 다시');
// 확정 · 취합본
var C = M.confirm(Q, '2026-11-04 14:00'); eq(C.confirmedAt, '2026-11-04 14:00', '최종 확정'); eq(M.setValue(C, low.id, '값', '901', '김동력', '2026-11-04 14:01').project.history[0].afterConfirm, true, '확정 뒤 변경 표시');
var bk = M.exportBook(Q); eq(bk.map(function (b) { return b.name; }), ['프로젝트', 'Excalc2D', 'Input_필요 데이터', 'Input_실린더 정보', 'Input(NVH)', 'Mass', 'Mass(추가 데이터)', 'Mass(Back up)', '현황', '이력'], '취합본 시트');
ok(bk[4].aoa.some(function (r) { return r[5] === 'Low Idle freq. (firing)' && r[7] === 30; }), '취합본에 자동 계산 값(숫자)'); eq(bk[5].aoa.filter(function (r) { return r[0] === '구분1'; }).length, 2, 'Mass 표 2개 머리글');
// 예제 프로젝트
var S = M.sampleProject('2026-11-04 09:00'); eq([S.code, M.progress(S, 'team').total.done, byData(S, 'Input(NVH)', '1st BPF @ max').values['값']], ['GS-EX120(가상)', 8, '270'], '예제: 코드 · 완료 8 · NVH 자동 계산(D → ×1)');

console.log('v1.0 ' + v10 + ' · v2.0 ' + (passed + failed - v10) + '개 검사');
console.log('\n규칙 통과 ' + passed + ' · 실패 ' + failed);
process.exit(failed ? 1 : 0);
