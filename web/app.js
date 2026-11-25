const CFG = window.DIET_CONFIG || {};
let START = CFG.START_DATE || '2026-10-06';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = iso(new Date());
const num = (v) => (v === '' || v == null ? null : Number(v));
const addDays = (dateStr, n) => { const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const dateLabel = (dateStr) => { const d = new Date(dateStr + 'T00:00:00'); return `${d.getMonth() + 1}월 ${d.getDate()}일`; };

/* ---------------- daily quote ---------------- */
const QUOTES = [
  '오늘도 한 걸음, 잘 하고 있어요!', '작은 기록이 쌓여 큰 변화를 만들어요.', '몸이 아니라 습관을 바꾸는 중이에요.',
  '어제보다 나은 오늘이면 충분해요.', '꾸준함이 제일 강력한 무기예요.', '오늘 한 끼도 소중한 기록이에요.',
  '완벽하지 않아도 괜찮아요, 계속하면 돼요.', '몸무게보다 중요한 건 꾸준한 관찰이에요.', '오늘의 작은 선택이 내일을 만들어요.',
  '쉬는 것도 계획의 일부예요.', '숫자보다 당신의 노력을 믿어요.', '기록하는 사람은 반드시 변해요.',
  '천천히 가도 멈추지만 않으면 돼요.', '오늘 걸은 걸음 수만큼 건강해지고 있어요.', '지금의 노력은 분명 남아요.',
  '몸도 마음도 조금씩 가벼워지고 있어요.', '비교하지 말고 어제의 나와만 경쟁해요.', '오늘 하루도 잘 버텨냈어요.',
];
function dailyQuote() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getFullYear(), 0, 1));
  const diff = Math.floor((now - start) / 86400000);
  return QUOTES[((diff % QUOTES.length) + QUOTES.length) % QUOTES.length];
}

/* ---------------- data layer ---------------- */
function localStore() {
  const get = (k) => { try { return JSON.parse(localStorage.getItem('diet.' + k)) || {}; } catch { return {}; } };
  const set = (k, v) => localStorage.setItem('diet.' + k, JSON.stringify(v));
  const plan = (k, field) => ({
    get: async (date) => get(k)[date]?.[field] || [],
    save: async (date, items) => { const m = get(k); m[date] = { date, [field]: items }; set(k, m); },
  });
  return {
    mode: 'local', label: '데모 모드',
    range: async (from, to) => Object.values(get('records')).filter((r) => r.date >= from && r.date <= to).sort((a, b) => a.date.localeCompare(b.date)),
    save: async (rec) => { const m = get('records'); m[rec.date] = { ...m[rec.date], ...rec }; set('records', m); },
    remove: async (date) => { const m = get('records'); delete m[date]; set('records', m); },
    meals: plan('mealPlans', 'meals'), exercises: plan('exPlans', 'exercises'),
    foods: {
      list: async () => { try { return JSON.parse(localStorage.getItem('diet.customFoods')) || []; } catch { return []; } },
      add: async (f) => { const l = JSON.parse(localStorage.getItem('diet.customFoods') || '[]'); const r = { id: 'l' + Date.now(), ...f, status: 'approved' }; l.push(r); localStorage.setItem('diet.customFoods', JSON.stringify(l)); return r; },
      pending: async () => [], review: async () => {},
    },
    favorites: {
      get: async () => { try { return JSON.parse(localStorage.getItem('diet.favorites')) || []; } catch { return []; } },
      save: async (list) => localStorage.setItem('diet.favorites', JSON.stringify(list)),
    },
  };
}

async function supabaseStore() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  const uid = async () => (await sb.auth.getUser()).data.user.id;
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  const plan = (table, field) => ({
    get: async (date) => ok(await sb.from(table).select(field).eq('date', date).maybeSingle())?.[field] || [],
    save: async (date, items) => ok(await sb.from(table).upsert({ user_id: await uid(), date, [field]: items }, { onConflict: 'user_id,date' })),
  });
  return {
    mode: 'supabase', label: '연결됨', sb,
    range: async (from, to) => ok(await sb.from('daily_records').select('*').gte('date', from).lte('date', to).order('date')),
    save: async (rec) => ok(await sb.from('daily_records').upsert({ ...rec, user_id: await uid() }, { onConflict: 'user_id,date' })),
    remove: async (date) => ok(await sb.from('daily_records').delete().eq('date', date)),
    meals: plan('meal_plans', 'meals'), exercises: plan('exercise_plans', 'exercises'),
    foods: {
      list: async () => ok(await sb.from('food_submissions').select('id,name,grams,kcal,cat,status,user_id').neq('status', 'rejected').order('created_at')),
      add: async (f) => ok(await sb.from('food_submissions').insert(f).select().single()),
      pending: async () => ok(await sb.from('food_submissions').select('id,name,grams,kcal,cat,user_id').eq('status', 'pending').order('created_at')),
      review: async (id, status) => ok(await sb.from('food_submissions').update({ status }).eq('id', id)),
    },
    favorites: {
      get: async () => ok(await sb.from('users').select('favorites').eq('id', await uid()).maybeSingle())?.favorites || [],
      save: async (list) => ok(await sb.from('users').update({ favorites: list }).eq('id', await uid())),
    },
  };
}

// read-only snapshot used by the shared link (scripts/build_share.py)
const APP_VERSION = '2026-11-25 · 스크롤바 숨김';
let READONLY = !!window.DIET_SHARE;
let shareToken = null;
const SHARE_PARAM = new URLSearchParams(location.search).get('share');
function shareStore(D) {
  const recs = Object.fromEntries((D.records || []).map((r) => [r.date, r]));
  const deny = async () => { throw new Error('공유 페이지에서는 기록할 수 없어요'); };
  const plan = (f) => ({ get: async (date) => D.plans?.[date]?.[f] || [], save: deny });
  return {
    mode: 'share', label: '공유 보기',
    range: async (from, to) => Object.values(recs).filter((r) => r.date >= from && r.date <= to).sort((a, b) => a.date.localeCompare(b.date)),
    save: deny, remove: deny, meals: plan('meals'), exercises: plan('exercises'),
    foods: { list: async () => [], add: deny, pending: async () => [], review: deny },
    favorites: { get: async () => [], save: deny },
  };
}

/* ---------------- state ---------------- */
let store, tab = 'home', month = new Date(today.slice(0, 7) + '-01T00:00:00'), cache = {}, metric = 'weight';
let planDate = today; // same day as 오늘/식단 tabs by default
let recordDate = today;
let accountLabel = '';
let favorites = [];

const monthRange = (d) => [iso(new Date(d.getFullYear(), d.getMonth(), 1)), iso(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
const EPOCH = '2000-01-01'; // always load full history; START only affects the home "시작 대비" figure
async function loadAll() {
  const rows = await store.range(EPOCH, '9999-12-31');
  cache = Object.fromEntries(rows.map((r) => [r.date, r]));
  TREND = computeTrend();
}
const recs = () => Object.values(cache).sort((a, b) => a.date.localeCompare(b.date));
const kcal = (n) => (n == null ? '–' : Number(n).toLocaleString() + ' kcal');

/* ---------------- meals: typed + grouped ---------------- */
const MEAL_TYPES = ['아침', '점심', '저녁', '간식', '야식'];
function groupMeals(meals) {
  const g = {}; MEAL_TYPES.forEach((t) => (g[t] = [])); g['기타'] = [];
  (meals || []).forEach((m) => { const t = MEAL_TYPES.includes(m.type) ? m.type : '기타'; g[t].push(m); });
  return g;
}
function mealGroupsHtml(meals, editable) {
  const g = groupMeals(meals);
  const order = [...MEAL_TYPES, '기타'];
  const html = order.filter((t) => g[t].length).map((t) => `
    <div class="mealgroup"><div class="mg-label">${t}</div>${g[t].map((m) => mealRowView(m)).join('')}</div>`).join('');
  return html || '<div class="empty">기록된 식사가 없어요</div>';
}
function isFavorite(name) { return favorites.some((f) => f.name === name); }
function mealRowView(m, x) {
  const g = m.grams ? `<span class="g">${m.grams}g</span>` : '';
  const favdata = encodeURIComponent(JSON.stringify({ name: m.name, grams: m.grams ?? null, kcal: m.kcal ?? null }));
  const on = isFavorite(m.name);
  return `<div class="li"><div class="li-left"><button type="button" class="favmini${on ? ' on' : ''}" title="즐겨찾기에 저장" data-favitem="${favdata}">${on ? '★' : '☆'}</button><div class="li-name">${x && x !== 'plain' ? '<span class="tag t-x">추가</span>' : ''}${esc(m.name)}${g}</div></div><b class="kcal">${m.kcal ?? '–'} kcal</b>${x ? `<button class="more" data-xmeal="${x}" aria-label="수정·삭제">⋯</button>` : ''}</div>`;
}
async function favMiniClick(btn) {
  try {
    const item = JSON.parse(decodeURIComponent(btn.dataset.favitem));
    await addFavorite({ name: item.name, grams: item.grams ?? null, kcal: item.kcal ?? null });
    btn.textContent = '★'; btn.classList.add('on');
  } catch {}
}
const EX_CATS = ['유산소', '근력', '스트레칭'];
function exDetail(e) {
  const p = [];
  if (e.sets) p.push(`${e.sets}세트${e.reps ? ` × ${e.reps}` : ''}`);
  else if (e.reps) p.push(String(e.reps));
  if (e.duration) p.push(`${e.duration}분`);
  if (e.weight) p.push(`${e.weight}kg`);
  return p.join(' · ');
}
function exRowView(e, x) {
  const cat = e.category ? `<span class="tag t-${EX_CATS.indexOf(e.category)}">${esc(e.category)}</span>` : '';
  const kcalTxt = e.kcal != null ? `<span class="g">${e.kcal}kcal</span>` : '';
  return `<div class="li exinfo" data-exinfo="${esc(e.name)}"><div class="li-left"><div>${cat}<span class="li-name">${esc(e.name)}</span><span class="info-i">ⓘ</span>${e.notes ? `<small>${esc(e.notes)}</small>` : ''}</div></div><div class="li-right"><b>${exDetail(e) || '–'}</b>${kcalTxt}</div>${x ? `<button class="more" data-xex="${x}" aria-label="수정·삭제">⋯</button>` : ''}</div>`;
}

/* ---------------- program: safe auto-plan ---------------- */
// Target: maintenance (~30 kcal/kg) minus 500 → ~0.5 kg/week. Never below 1,300 kcal.
const KCAL_FLOOR = 1300;
let TREND = { status: 'few', kcalAdj: 0, exAdd: 0 };
// Weight-trend feedback: regression over the last 21 days (≥4 weigh-ins spanning ≥10 days) → weekly loss rate.
function computeTrend() {
  const t0 = addDays(today, -21) > START ? addDays(today, -21) : START; // never look before the diet start date
  const pts = recs().filter((r) => r.weight != null && r.date >= t0 && r.date <= today).map((r) => [(new Date(r.date) - new Date(t0)) / 86400000, Number(r.weight)]);
  const n = pts.length, span = n ? pts[n - 1][0] - pts[0][0] : 0;
  if (n < 4 || span < 10) return { status: 'few', n, span, kcalAdj: 0, exAdd: 0 };
  const mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  const slope = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  const w = pts[n - 1][1], loss = -slope * 7, fastMax = w * 0.01;
  const raw = Math.round((w * 30 - 500) / 10) * 10, room = Math.max(0, raw - KCAL_FLOOR);
  const base = { n, span, loss, w, fastMax };
  if (loss < 0.15) return { ...base, status: 'stall', kcalAdj: -Math.min(100, room), exAdd: 10, atFloor: room === 0 };
  if (loss < 0.3) return { ...base, status: 'slow', kcalAdj: 0, exAdd: 5 };
  if (loss > fastMax) return { ...base, status: 'fast', kcalAdj: 100, exAdd: 0 };
  return { ...base, status: 'good', kcalAdj: 0, exAdd: 0 };
}
function kcalTarget(weight) {
  const w = weight || 68;
  return Math.min(1800, Math.max(KCAL_FLOOR, Math.round((w * 30 - 500 + (TREND.kcalAdj || 0)) / 10) * 10));
}
function latestWeight() { const w = recs().filter((r) => r.weight != null); return w.length ? Number(w[w.length - 1].weight) : null; }
const MENUS = [
  [['아침', '오트밀', 40, 150], ['아침', '우유', 200, 130], ['아침', '바나나', 100, 90], ['아침', '삶은 계란 1개', 50, 75],
    ['점심', '현미밥', 150, 230], ['점심', '닭가슴살 구이', 120, 150], ['점심', '나물 2종', 100, 60], ['점심', '김치', 50, 15],
    ['간식', '그릭요거트', 100, 70], ['간식', '아몬드', 10, 60],
    ['저녁', '연어구이', 100, 200], ['저녁', '고구마', 120, 150], ['저녁', '샐러드 (오리엔탈 드레싱)', 150, 70]],
  [['아침', '통밀빵 1장', 40, 100], ['아침', '계란 스크램블 2개', 100, 180], ['아침', '방울토마토', 100, 20], ['아침', '우유', 200, 130],
    ['점심', '현미밥', 150, 230], ['점심', '돼지 안심 볶음', 100, 180], ['점심', '쌈채소', 100, 20], ['점심', '된장국', 200, 60],
    ['간식', '사과 1/2개', 120, 60], ['간식', '단백질 음료', 190, 110],
    ['저녁', '두부스테이크', 150, 180], ['저녁', '현미밥', 100, 155], ['저녁', '데친 브로콜리', 100, 30]],
  [['아침', '그릭요거트', 150, 100], ['아침', '그래놀라', 30, 130], ['아침', '블루베리', 50, 30], ['아침', '삶은 계란 1개', 50, 75],
    ['점심', '나물 비빔밥 (고추장 조금)', 400, 550],
    ['간식', '바나나', 100, 90], ['간식', '아몬드', 10, 60],
    ['저녁', '닭가슴살 샐러드', 250, 250], ['저녁', '고구마', 100, 130]],
  [['아침', '오트밀', 40, 150], ['아침', '두유', 190, 100], ['아침', '삶은 계란 2개', 100, 150],
    ['점심', '현미밥', 150, 230], ['점심', '고등어구이', 100, 230], ['점심', '나물', 100, 50], ['점심', '미역국', 200, 40],
    ['간식', '방울토마토', 150, 30], ['간식', '그릭요거트', 100, 70],
    ['저녁', '소고기 우둔 구이', 100, 150], ['저녁', '쌈채소', 100, 20], ['저녁', '현미밥', 80, 125], ['저녁', '계란찜', 100, 90]],
];
function mealsFor(date, target) {
  const d = new Date(date + 'T00:00:00');
  const idx = Math.floor(d.getTime() / 86400000) % MENUS.length;
  const base = MENUS[(idx + MENUS.length) % MENUS.length];
  const total = base.reduce((a, m) => a + m[3], 0), f = target / total;
  return base.map(([type, name, grams, kcal]) => ({ type, name, grams: Math.round((grams * f) / 5) * 5, kcal: Math.round(kcal * f), done: false }));
}
/* ---------------- exercise program ----------------
   Basis (see CLAUDE.md for links):
   - WHO 2020: 150–300 min/week moderate aerobic + muscle-strengthening of all major groups on ≥2 days/week.
   - ACSM: every major muscle group ≥2×/week; beginners 2–3 days/week, 2–3 sets of 8–12 reps; progress gradually.
   - Weight loss: ≥250 min/week of total activity; resistance training 2–3×/week to keep muscle during a deficit.
   - Back: McGill "big 3" (curl-up, side plank, bird dog; 6-4-2 reps, ~8 s holds), no loaded spinal flexion.
   Week: Mon/Fri full-body A, Wed full-body B (strength never on consecutive days), Tue/Thu/Sat cardio, Sun easy recovery.
   Home = bodyweight only. Gym = machines, switched on in 설정. */
let PROGRAM_START = '2026-11-23'; // Monday of program week 1 (progression counts from here)
const programWeek = (date) => Math.max(1, Math.floor((new Date(date + 'T00:00:00') - new Date(PROGRAM_START + 'T00:00:00')) / (7 * 86400000)) + 1);
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
let useGym = lsGet('diet.gym') === '1';
const COOL = { category: '스트레칭', name: '전신 스트레칭', duration: 5, kcal: 15, notes: '허리·햄스트링·고관절 위주' };
const WARM = (gym) => (gym ? { category: '유산소', name: '실내 사이클 (워밍업)', duration: 10, kcal: 60 } : { category: '유산소', name: '빠르게 걷기 (워밍업)', duration: 10, kcal: 40 });
const BIG3 = [
  { category: '근력', name: '맥길 컬업', sets: 3, reps: '6-4-2회', kcal: 10, notes: '한쪽 무릎 세우고 손은 허리 밑. 머리·어깨만 살짝 들어 8초 버티기 (윗몸일으키기 아님)' },
  { category: '근력', name: '사이드 플랭크 (무릎 대고)', sets: 3, reps: '좌우 6-4-2회', kcal: 10, notes: '8초씩 버티기, 몸이 일직선이 되게' },
  { category: '근력', name: '버드독', sets: 3, reps: '좌우 6-4-2회', kcal: 10, notes: '팔·다리를 뻗고 8초 버티기, 허리가 꺾이지 않게' },
];
function strengthDay(date, which, gym) {
  const w = programWeek(date), sets = w <= 2 ? 2 : 3, reps = w <= 4 ? 10 : 12, side = w <= 4 ? 8 : 10;
  const m = (name, kcal, notes, repsText) => ({ category: '근력', name, sets, reps: repsText || `${reps}회`, kcal, ...(notes ? { notes } : {}) });
  const push = m('무릎 푸시업', 25, w >= 5 ? '쉬워지면 정자세 푸시업 1~2개부터 도전' : '몸을 일직선으로, 팔꿈치는 몸에서 45도');
  let main;
  if (!gym) {
    main = which === 'A'
      ? [m('맨몸 스쿼트', 30, '발은 어깨너비. 엉덩이를 뒤로 빼며 앉기, 허리는 곧게, 무릎은 발끝 방향'), m('글루트 브릿지', 25, '엉덩이를 조이며 올리고 1초 멈추기'), push,
        m('엎드려 Y-T 레이즈', 15, '엎드려서 팔만 살짝 들기, 날개뼈 모으기. 허리는 들지 않기')]
      : [m('리버스 런지', 30, '한 발을 뒤로 내딛기, 상체는 곧게', `좌우 ${side}회`), m('힙 힌지 (맨몸)', 20, '손은 가슴 앞. 엉덩이를 뒤로 밀며 상체 숙이기, 등은 평평하게'),
        { ...push, name: '무릎 푸시업 (천천히)', notes: '3초에 내려가고 1초에 올라오기' }, m('옆으로 누워 다리 들기', 20, '골반이 뒤로 말리지 않게', `좌우 ${reps}회`), m('엎드려 W 레이즈', 15, '팔꿈치를 접어 날개뼈를 모으기')];
  } else {
    main = which === 'A'
      ? [m('레그 프레스 머신', 35, '허리를 등받이에 붙이고 무릎은 끝까지 펴지 않기. 마지막 2회가 힘든 무게'), m('힙 어브덕션 머신', 20), m('체스트 프레스 머신', 30), m('랫 풀다운', 30, '가슴을 펴고 당기기, 몸을 뒤로 젖히지 않기'), m('시티드 로우 머신', 30, '가슴을 패드에 대고, 허리는 세운 채')]
      : [m('레그 프레스 머신', 35, '허리를 등받이에 붙이고 마지막 2회가 힘든 무게'), m('시티드 레그 컬 머신', 25), m('숄더 프레스 머신', 25, '가벼운 무게로 어깨를 올리지 않기'), m('랫 풀다운', 30), m('체스트 프레스 머신', 30)];
  }
  return [WARM(gym), ...main, ...(BACK ? BIG3 : []), COOL];
}
function cardioDay(day, gym) {
  const c = {
    2: gym ? { name: '트레드밀 경사 걷기', duration: 40, kcal: 200, notes: '경사 5~7%, 손잡이 잡지 않기. 말은 할 수 있지만 노래는 못 부를 속도' }
      : { name: '빠르게 걷기 (중강도)', duration: 40, kcal: 180, notes: '말은 할 수 있지만 노래는 못 부를 정도 (힘든 정도 5~6/10)' },
    4: gym ? { name: '실내 사이클 인터벌', duration: 35, kcal: 190, notes: '빠르게 3분 + 보통 2분 × 7회' } : { name: '인터벌 걷기', duration: 35, kcal: 170, notes: '빠르게 3분 + 보통 2분 × 7회' },
    6: gym ? { name: '트레드밀 + 사이클', duration: 50, kcal: 230, notes: '25분씩, 대화 가능한 강도' } : { name: '길게 걷기', duration: 50, kcal: 220, notes: '평소보다 조금 빠르게, 쉬지 않고 이어서' },
  }[day];
  const add = TREND.exAdd || 0;
  if (add) { const d = c.duration, nd = Math.min(60, d + add); c.kcal = Math.round((c.kcal * nd) / d); c.duration = nd; c.notes += ` (체중 감량이 더뎌서 +${nd - d}분)`; }
  return [{ category: '유산소', ...c }, COOL];
}
function exercisesFor(date) {
  const day = new Date(date + 'T00:00:00').getDay(), gym = useGym;
  const list = day === 1 || day === 5 ? strengthDay(date, 'A', gym) : day === 3 ? strengthDay(date, 'B', gym)
    : day === 0 ? [{ category: '유산소', name: '가벼운 산책', duration: 30, kcal: 110, notes: '회복일, 편한 속도로' }, { category: '스트레칭', name: '전신 스트레칭 (회복일)', duration: 15, kcal: 40 }]
    : cardioDay(day, gym);
  return list.map((e) => ({ ...e, done: false }));
}
// Re-generating never touches what the user already checked / swapped / skipped:
// meal types (and the day's workout) that have any such item are kept as they are; only the rest is replaced.
async function generatePlan(date) {
  const target = kcalTarget(latestWeight());
  const oldM = await store.meals.get(date), oldE = await store.exercises.get(date);
  const lockedTypes = new Set(oldM.filter((m) => itemStatus(m)).map((m) => m.type));
  const keptM = oldM.filter((m) => lockedTypes.has(m.type));
  let fresh = mealsFor(date, target).filter((m) => !lockedTypes.has(m.type));
  if (keptM.length && fresh.length) { // fit the new meals into what is left of the day's calorie target
    const left = target - keptM.reduce((a, m) => a + (m.kcal || 0), 0), sum = fresh.reduce((a, m) => a + m.kcal, 0);
    const f = Math.min(1.5, Math.max(0.5, left / sum));
    fresh = fresh.map((m) => ({ ...m, grams: Math.round((m.grams * f) / 5) * 5, kcal: Math.round(m.kcal * f) }));
  }
  const meals = [...keptM, ...fresh].sort((a, b) => MEAL_TYPES.indexOf(a.type) - MEAL_TYPES.indexOf(b.type));
  await store.meals.save(date, meals);
  await store.exercises.save(date, oldE.some((x) => itemStatus(x)) ? oldE : exercisesFor(date));
}

/* plan item status: '' (not yet) | done (as planned) | swap (ate/did something else) | skip.
   The planned name/amount/kcal are never modified; what actually happened lives in `actual`
   and is what gets copied into the day's record. */
let todayPlan = { meals: [], exercises: [] };
const openMeals = new Set(); // folded (all-skipped) meals the user expanded
let mealDate = today, dayPlan = todayPlan;
const itemStatus = (x) => x.st || (x.done ? 'done' : '');
function actualOf(x, kind) {
  const s = itemStatus(x);
  const { st, actual, done, ...base } = x;
  if (s === 'done') return { ...base, plan: true };
  if (s === 'swap') return kind === 'meals'
    ? { type: base.type, ...actual, plan: true, planned: base.name }
    : { category: base.category, ...actual, plan: true, planned: base.name };
  return null;
}
async function syncRecordFromPlan(date, plan) {
  const r = cache[date] || {};
  const meals = (r.meals || []).filter((m) => !m.plan).concat(plan.meals.map((m) => actualOf(m, 'meals')).filter(Boolean));
  const exercises = (r.exercises || []).filter((x) => !x.plan).concat(plan.exercises.map((x) => actualOf(x, 'exercises')).filter(Boolean));
  const sum = meals.reduce((a, m) => a + (m.kcal || 0), 0);
  const rec = { date, weight: r.weight ?? null, steps: r.steps ?? null, calories_consumed: sum || null, calories_burned: calcBurn({ ...r, exercises }) ?? r.calories_burned ?? null, meals, exercises };
  await store.save(rec);
  cache[date] = { ...r, ...rec };
}
/* ---- strength log: weight + how it felt, progressive overload hints ---- */
const FEELS = [['easy', '쉬웠어요'], ['ok', '적당해요'], ['hard', '힘들었어요']];
const mmdd = (d) => `${d.slice(5, 7)}/${d.slice(8)}`;
function liftHistory(name) {
  const out = [];
  recs().forEach((r) => (r.exercises || []).forEach((e) => { if ((e.name === name || e.planned === name) && Number(e.weight) > 0) out.push({ date: r.date, weight: Number(e.weight), feel: e.feel, sets: e.sets, reps: e.reps }); }));
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
// last session + a modest next-step suggestion (raise when it felt easy or two sessions in a row were not hard)
function liftSuggest(name) {
  const l = liftHistory(name).filter((x) => x.date !== mealDate); if (!l.length) return null;
  const a = l[0], inc = a.weight >= 10 ? 2.5 : 1;
  let next = a.weight, note = '같은 무게로 한 번 더';
  if (a.feel === 'hard') note = '힘들었으니 같은 무게로 자세 먼저';
  else if (a.feel === 'easy' || (l[1] && l[1].weight === a.weight && l[1].feel !== 'hard')) { next = a.weight + inc; note = '올릴 타이밍이에요'; }
  return { last: a, next, note };
}
const feelHtml = (cur, id = 'lfFeel') => `<div class="seg" id="${id}">${FEELS.map(([v, t]) => `<button type="button" data-f="${v}"${v === (cur || 'ok') ? ' class="on"' : ''}>${t}</button>`).join('')}</div>`;
const pickedFeel = (id = 'lfFeel') => sheet.querySelector(`#${id} .on`)?.dataset.f || 'ok';
function wireFeel(id = 'lfFeel') { const box = sheet.querySelector('#' + id); box.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); }; }
function openLiftSheet(i) {
  const item = dayPlan.exercises[i], sg = liftSuggest(item.name);
  openSheet(`<div class="sheet-head"><h2>${esc(item.name)}</h2></div>
    <p class="desc small">${esc(exDetail(item))} · 사용한 무게를 남겨두면 다음에 조금씩 올릴 때 참고해요.</p>
    ${sg ? `<button type="button" class="favchip" id="lfSug">지난번 ${sg.last.weight}kg (${mmdd(sg.last.date)}) → 이번엔 ${sg.next}kg · ${sg.note}</button>` : ''}
    <label class="unit-in big-in" style="margin-top:10px"><input id="lfW" type="number" step="0.5" inputmode="decimal" value="${sg ? sg.last.weight : ''}" placeholder="맨몸이면 비워 두세요"><span>kg</span></label>
    <label class="f">운동하니 어땠나요?</label>${feelHtml('ok')}
    <button class="btn" id="lfSave">완료</button>`);
  wireFeel();
  if ($('#lfSug')) $('#lfSug').onclick = () => { $('#lfW').value = sg.next; };
  $('#lfSave').onclick = async () => {
    const w = num($('#lfW').value), extra = { ...(w ? { weight: w } : {}), feel: pickedFeel() };
    closeSheet(); try { await setItemStatus('exercises', i, 'done', null, extra); } catch (e) { alert(authMsg(e)); }
  };
}
async function setItemStatus(kind, i, st, actual, extra) {
  const list = dayPlan[kind];
  const { st: _s, actual: _a, done: _d, weight: _w, feel: _f, ...base } = list[i]; // old lift data is dropped and re-added from `extra`
  list[i] = { ...base, ...(st ? { st } : {}), done: st === 'done', ...(st === 'done' && extra ? extra : {}), ...(st === 'swap' && actual ? { actual } : {}) };
  await store[kind].save(mealDate, list);
  await syncRecordFromPlan(mealDate, dayPlan);
  if (mealDate === today) todayPlan = dayPlan;
  render();
}
async function setMealSkip(type) {
  const idx = dayPlan.meals.map((m, i) => i).filter((i) => dayPlan.meals[i].type === type);
  const allSkip = idx.every((i) => itemStatus(dayPlan.meals[i]) === 'skip');
  idx.forEach((i) => { const { st, actual, done, ...base } = dayPlan.meals[i]; dayPlan.meals[i] = allSkip ? { ...base, done: false } : { ...base, st: 'skip', done: false }; });
  await store.meals.save(mealDate, dayPlan.meals);
  await syncRecordFromPlan(mealDate, dayPlan);
  if (mealDate === today) todayPlan = dayPlan;
  render();
}
async function applyMealSwap(type, added) {
  const r = cache[mealDate] || {};
  cache[mealDate] = { ...r, date: mealDate, meals: [...(r.meals || []), ...added] };
  dayPlan.meals = dayPlan.meals.map((m) => { if (m.type !== type) return m; const { st, actual, done, ...base } = m; return { ...base, st: 'skip', done: false }; });
  await store.meals.save(mealDate, dayPlan.meals);
  await syncRecordFromPlan(mealDate, dayPlan);
  if (mealDate === today) todayPlan = dayPlan;
}
function openMealSwapSheet(type) {
  const n = dayPlan.meals.filter((m) => m.type === type).length;
  openSheet(`<div class="sheet-head"><h2>${type}을 다르게 먹었어요</h2></div>
    <p class="desc small">계획한 ${type} ${n}개는 '안 먹음'으로 두고, 실제로 먹은 음식만 기록해요.</p>
    ${foodSearchHtml()}
    <div id="rows">${mealRowEdit({ type })}</div>
    <div class="favrow"><button class="add" id="add">+ 음식 더 추가</button><button class="add" id="favToggle">☆ 자주 먹는 음식에서 추가</button></div>
    <div class="favpanel" id="favPanel" hidden>${favChipsHtml()}</div>
    <div class="err" id="err"></div><button class="btn" id="save">저장</button>`);
  $('#add').onclick = wireMealRows($('#rows'));
  wireFavPanel($('#favToggle'), $('#favPanel'), $('#rows'));
  wireFoodSearch(sheet.querySelector('.fs'), (f) => addFoodRow($('#rows'), { type, name: f.name, grams: f.grams, kcal: f.kcal }));
  $('#save').onclick = async () => {
    const added = readMealRows($('#rows'));
    if (!added.length) { $('#err').textContent = '먹은 음식 이름을 입력해주세요.'; return; }
    try { await applyMealSwap(type, added); closeSheet(); render(); } catch (e) { $('#err').textContent = authMsg(e); }
  };
}
function togglePlanItem(kind, i) {
  const st = itemStatus(dayPlan[kind][i]);
  if (st === 'swap' || st === 'skip') return openStatusSheet(kind, i);
  if (kind === 'exercises' && !st && dayPlan.exercises[i].category === '근력') return openLiftSheet(i);
  return setItemStatus(kind, i, st ? '' : 'done', null);
}
function checkRow(kind, i, item) {
  const st = itemStatus(item), a = item.actual || {};
  const kc = st === 'swap' ? a.kcal : st === 'skip' ? 0 : item.kcal;
  const detail = st === 'swap' ? exDetail(a) : exDetail(item);
  const right = kind === 'meals'
    ? `<b class="kcal">${kc ?? '–'} kcal</b>`
    : `<div class="li-right"><b>${detail || '–'}</b>${kc != null ? `<span class="g">${kc}kcal</span>` : ''}</div>`;
  const cat = item.category ? `<span class="tag t-${EX_CATS.indexOf(item.category)}">${esc(item.category)}</span>` : '';
  const plain = [item.grams ? `${item.grams}g` : '', item.notes ? esc(item.notes) : ''].filter(Boolean).join(' · ');
  const sub = st === 'swap' ? `<small class="swap-txt">대신 ${esc(a.name)}${a.grams ? ` ${a.grams}g` : ''}</small>`
    : st === 'skip' ? `<small>${kind === 'meals' ? '안 먹음' : '못 함'}</small>`
    : plain ? `<small>${plain}</small>` : '';
  return `<div class="check-row"><button class="check st-${st || 'none'}" data-check="${kind}:${i}"><span class="box"></span>
    <span class="check-body"><span class="check-name">${cat}${esc(item.name)}</span>${sub}</span>${right}</button>
    <button class="more" data-more="${kind}:${i}" aria-label="다르게 했어요">⋯</button></div>`;
}
function openStatusSheet(kind, i) {
  const item = dayPlan[kind][i], st = itemStatus(item), isMeal = kind === 'meals', a = item.actual || {};
  const planTxt = isMeal ? `${item.grams ? item.grams + 'g · ' : ''}${item.kcal ?? '–'}kcal` : exDetail(item) || '';
  openSheet(`<div class="sheet-head"><h2>${esc(item.name)}</h2></div>
    <p class="desc">계획: ${esc(planTxt)}<br>계획은 그대로 두고, 실제로 ${isMeal ? '먹은' : '한'} 것만 기록해요.</p>
    ${isMeal ? '' : `<button type="button" class="link-btn" style="padding:0 0 10px" data-exinfo="${esc(item.name)}">▶ 운동 방법·영상 보기 ›</button>`}
    <div class="opt-list">
      <button class="opt${st === 'done' || !st ? ' on' : ''}" data-st="done">${isMeal ? '계획대로 먹었어요' : '계획대로 했어요'}</button>
      <button class="opt${st === 'swap' ? ' on' : ''}" data-st="swap">${isMeal ? '다른 걸 먹었어요' : '다른 운동을 했어요'}</button>
      <button class="opt${st === 'skip' ? ' on' : ''}" data-st="skip">${isMeal ? '안 먹었어요' : '못 했어요'}</button>
    </div>
    <div id="swapForm"${st === 'swap' ? '' : ' hidden'}>
      <label class="f">${isMeal ? '실제로 먹은 음식' : '실제로 한 운동'}</label>
      <input class="in" id="aName" value="${esc(a.name ?? '')}" placeholder="${isMeal ? '예: 김밥 1줄' : '예: 실내 자전거'}">
      <div class="two" style="margin-top:8px">
        ${isMeal ? `<label class="unit-in"><input id="aG" type="number" inputmode="decimal" value="${a.grams ?? ''}" placeholder="0"><span>g</span></label>`
          : `<label class="unit-in"><input id="aMin" type="number" inputmode="numeric" value="${a.duration ?? ''}" placeholder="0"><span>분</span></label>`}
        <label class="unit-in"><input id="aK" type="number" inputmode="numeric" value="${a.kcal ?? ''}" placeholder="${isMeal ? '0' : '자동'}"><span>kcal</span></label>
      </div>
      ${isMeal ? `<label class="f">비슷한 칼로리 대체 메뉴</label><div class="favpanel" id="aAlt">${altFoods(item).map((f, i) => `<button type="button" class="favchip" data-i="${FOODS.indexOf(f) >= 0 ? FOODS.indexOf(f) : -1}" data-n="${esc(f.name)}">${esc(f.name)} · ${f.kcal}kcal</button>`).join('') || '<div class="empty" style="padding:6px 0">추천할 메뉴가 없어요</div>'}</div>
        <label class="f">음식 검색</label>${foodSearchHtml()}
        <label class="f">즐겨찾기에서 고르기</label><div class="favpanel" id="aFav">${favChipsHtml()}</div>` : ''}
    </div>
    ${isMeal ? '' : `<div id="liftBlock"${st === 'skip' ? ' hidden' : ''}><label class="f">사용 무게 (선택)</label>
      <label class="unit-in"><input id="lfW" type="number" step="0.5" inputmode="decimal" value="${(st === 'swap' ? a.weight : item.weight) ?? ''}" placeholder="맨몸이면 비워 두세요"><span>kg</span></label>
      <div style="margin-top:8px">${feelHtml((st === 'swap' ? a.feel : item.feel) || 'ok')}</div></div>`}
    <div class="err" id="err"></div>
    <button class="btn" id="stSave">저장</button>
    ${st ? '<button class="btn ghost" id="stClear">이 기록 지우기</button>' : ''}`);
  if (!isMeal) wireFeel();
  let pick = st || 'done';
  sheet.querySelectorAll('[data-st]').forEach((b) => { b.onclick = () => {
    pick = b.dataset.st;
    sheet.querySelectorAll('[data-st]').forEach((x) => x.classList.toggle('on', x === b));
    $('#swapForm').hidden = pick !== 'swap';
    if ($('#liftBlock')) $('#liftBlock').hidden = pick === 'skip';
  }; });
  const fillFood = (f) => { $('#aName').value = f.name; $('#aG').value = f.grams ?? ''; $('#aK').value = f.kcal ?? ''; };
  if ($('#aAlt')) $('#aAlt').onclick = (e) => { const c = e.target.closest('.favchip'); if (c) fillFood(FOODS[c.dataset.i] || allFoods(true).find((f) => f.name === c.dataset.n)); };
  if (isMeal) wireFoodSearch(sheet.querySelector('.fs'), fillFood);
  if ($('#aFav')) $('#aFav').onclick = (e) => {
    const c = e.target.closest('.favchip'); if (!c) return;
    const f = favorites[c.dataset.fav]; $('#aName').value = f.name; $('#aG').value = f.grams ?? ''; $('#aK').value = f.kcal ?? '';
  };
  $('#stSave').onclick = async () => {
    let actual = null;
    if (pick === 'swap') {
      const name = $('#aName').value.trim();
      if (!name) { $('#err').textContent = isMeal ? '대신 먹은 음식을 입력해주세요.' : '대신 한 운동을 입력해주세요.'; return; }
      if (isMeal) actual = { name, grams: num($('#aG').value), kcal: num($('#aK').value) };
      else { const duration = num($('#aMin').value), w = num($('#lfW').value); actual = { name, duration, kcal: num($('#aK').value) ?? estimateExerciseKcal(name, duration), ...(w ? { weight: w } : {}), feel: pickedFeel() }; }
    }
    const lw = !isMeal && pick === 'done' ? num($('#lfW').value) : null;
    const extra = !isMeal && pick === 'done' ? { ...(lw ? { weight: lw } : {}), feel: pickedFeel() } : undefined;
    closeSheet();
    try { await setItemStatus(kind, i, pick, actual, extra); } catch (e) { alert(authMsg(e)); }
  };
  if ($('#stClear')) $('#stClear').onclick = async () => { closeSheet(); await setItemStatus(kind, i, '', null); };
}

/* shared week strip (기록, 식단 tabs) */
const CAL_ICON = '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>';
function weekBar(selected, attr, calId, hasDot) {
  const dow = '일월화수목금토';
  const strip = weekDates(selected).map((d, i) => {
    const wk = i === 0 ? ' sun' : i === 6 ? ' sat' : '';
    return `<button class="wd${wk}${d === selected ? ' on' : ''}${d === today ? ' today' : ''}" ${attr}="${d}"><small>${dow[i]}</small><b>${new Date(d + 'T00:00:00').getDate()}</b>${hasDot(d) ? '<span class="dot"></span>' : ''}${cache[d]?.inbody ? '<i class="ibmark">IN</i>' : ''}</button>`;
  }).join('');
  return `<div class="weekbar" data-week="${attr}"><div class="wd-scroll">${strip}</div><button class="cal-btn" id="${calId}" aria-label="달력에서 날짜 고르기">${CAL_ICON}</button></div>`;
}

/* ---------------- views ---------------- */
function viewHome() {
  const all = recs().filter((r) => r.weight != null);
  const last = all[all.length - 1]; // most recent weight ever, regardless of start date
  const sinceStart = all.filter((r) => r.date >= START);
  const first = sinceStart[0]; // baseline for "시작 대비" is the start date, not all history
  const diff = first && last ? last.weight - first.weight : 0;
  const t = cache[today];
  const y = month.getFullYear(), m = month.getMonth();
  const lead = new Date(y, m, 1).getDay(), dim = new Date(y, m + 1, 0).getDate();
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<div class="day out"></div>';
  for (let d = 1; d <= dim; d++) {
    const date = `${y}-${pad(m + 1)}-${pad(d)}`, r = cache[date];
    cells += `<button class="day${r ? ' has' : ''}${date === today ? ' today' : ''}" data-date="${date}">${r?.inbody ? '<i class="ibmark">IN</i>' : ''}
      <span class="n">${d}</span>${r?.weight != null ? `<span class="w">${Number(r.weight).toFixed(2)}</span>` : r ? '<span class="dot"></span>' : ''}
      ${r?.steps != null ? `<span class="s">${(r.steps / 1000).toFixed(1)}k</span>` : ''}</button>`;
  }
  const target = kcalTarget(last ? Number(last.weight) : null);
  const items = [...todayPlan.meals, ...todayPlan.exercises];
  const doneN = items.filter((x) => itemStatus(x)).length;
  const pct = items.length ? Math.round((doneN / items.length) * 100) : 0;
  const ateKcal = (t?.meals || []).reduce((a, x) => a + (x.kcal || 0), 0);
  const ICON = { done: '✓', swap: '↔', skip: '–', '': '' };
  const mealExtraToday = (t?.meals || []).filter((x) => !x.plan);
  const sumRow = (type, ms, xs) => {
    if (!ms.length && !xs.length) return '';
    const xk = xs.reduce((a, m) => a + (m.kcal || 0), 0);
    if (!ms.length) return `<div class="sum-row"><span class="sum-k">${type}</span><span class="pill s-done">기록</span><b>${xk.toLocaleString()} <small>kcal</small></b></div>`;
    const sts = ms.map(itemStatus), left = sts.filter((x) => !x).length;
    const planned = ms.reduce((a, m) => a + (m.kcal || 0), 0);
    const ate = ms.reduce((a, m) => a + (actualOf(m, 'meals')?.kcal || 0), 0) + xk;
    const [txt, cls] = left === ms.length ? (xs.length ? ['추가 기록', 'part'] : ['아직', 'wait']) : left ? [`${ms.length - left}/${ms.length} 체크`, 'part']
      : sts.every((x) => x === 'done') ? ['계획대로', 'done'] : sts.every((x) => x === 'skip') ? (xs.length ? ['다르게 먹음', 'swap'] : ['안 먹음', 'skip']) : ['다르게 먹음', 'swap'];
    return `<div class="sum-row"><span class="sum-k">${type}</span><span class="pill s-${cls}">${txt}</span><b>${left === ms.length && !xs.length ? '–' : ate.toLocaleString()} <small>/ ${planned.toLocaleString()} kcal</small></b></div>`;
  };
  const mealRows = MEAL_TYPES.map((type) => sumRow(type, todayPlan.meals.filter((m) => m.type === type), mealExtraToday.filter((m) => m.type === type))).join('')
    + sumRow('기타', [], mealExtraToday.filter((m) => !MEAL_TYPES.includes(m.type)));
  const exRows = todayPlan.exercises.map((e) => { const s = itemStatus(e);
    return `<div class="sum-row"><span class="sum-k ex">${esc(e.name)}</span><span class="mark m-${s || 'none'}">${ICON[s]}</span></div>`; }).join('');
  const exDone = todayPlan.exercises.filter((e) => ['done', 'swap'].includes(itemStatus(e))).length;
  const exExtraToday = (t?.exercises || []).filter((x) => !x.plan);
  const exExtraSum = exExtraToday.length ? `<div class="sum-row"><span class="sum-k ex">추가 운동 ${exExtraToday.length}개${exExtraToday.some((x) => x.duration) ? ` · ${exExtraToday.reduce((a, x) => a + (x.duration || 0), 0)}분` : ''}</span><span class="pill s-part">계획 외</span></div>` : '';
  const planCards = items.length ? `
  <div class="card"><div class="card-title">오늘의 식단<span class="sub">${ateKcal.toLocaleString()} / ${target.toLocaleString()} kcal</span></div>
    <div class="bar"><i style="width:${Math.min(100, Math.round((ateKcal / target) * 100))}%"></i></div>${mealRows}
    <button class="link-btn" data-gotab="meals">체크 탭에서 체크하기 ›</button></div>
  <div class="card"><div class="card-title">오늘의 운동<span class="sub">${exDone}/${todayPlan.exercises.length} 완료</span></div>
    ${exRows || '<div class="empty">오늘은 쉬는 날이에요</div>'}${exExtraSum}</div>`
    : `<div class="card"><div class="card-title">오늘 플랜이 아직 없어요</div><p class="desc">체중에 맞춰 하루 ${target.toLocaleString()}kcal 식단과 운동 루틴을 만들어 드려요.</p><button class="btn" id="genToday">추천 플랜 받기</button></div>
    ${mealRows || exExtraSum ? `<div class="card"><div class="card-title">오늘 기록<span class="sub">${ateKcal.toLocaleString()} kcal 섭취</span></div>${mealRows}${exExtraSum}</div>` : ''}`;
  return `
  <div class="hero">
    <div class="eyebrow">${dailyQuote()}</div>
    <div class="big">${last ? Number(last.weight).toFixed(2) + ' kg' : '체중을 기록해주세요'}</div>
    ${first && last && first !== last ? `<div class="delta ${diff <= 0 ? 'down' : 'up'}">시작 대비 ${diff > 0 ? '+' : ''}${diff.toFixed(2)} kg</div>` : ''}
    ${last ? `<div class="delta">목표 ${GOAL}kg까지 ${Math.max(0, Number(last.weight) - GOAL).toFixed(2)} kg</div>` : ''}
    <button class="pill-btn" id="quickWeight">${t?.weight != null ? '오늘 체중 수정' : '오늘 체중 입력'}</button>
  </div>
  ${items.length ? `<div class="card"><div class="card-title">오늘 할 일<span class="sub">${doneN}/${items.length} 완료</span></div><div class="bar"><i style="width:${pct}%"></i></div>
    <p class="desc">${pct === 100 ? '오늘 플랜을 모두 해냈어요! 🎉' : (READONLY ? '체크 탭에서 항목별로 볼 수 있어요.' : '체크 탭에서 체크하면 기록에 자동으로 반영돼요.')}</p></div>` : ''}
  <div class="card">
    <div class="cal-head"><button id="prev">‹</button><b>${y}년 ${m + 1}월</b><button id="next">›</button></div>
    <div class="dow">${'일월화수목금토'.split('').map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="days">${cells}</div>
  </div>
  ${planCards}`;
}
function openWeightSheet() {
  const r = cache[today] || {};
  openSheet(`<div class="sheet-head"><h2>오늘 체중</h2></div>
    <p class="desc">아침 공복, 화장실 다녀온 뒤 재는 게 가장 정확해요.</p>
    <label class="unit-in big-in"><input id="wIn" type="number" step="0.01" inputmode="decimal" value="${r.weight ?? ''}" placeholder="0.00"><span>kg</span></label>
    <div class="err" id="err"></div><button class="btn" id="wSave">저장</button>`);
  $('#wSave').onclick = async () => {
    const w = num($('#wIn').value); if (w == null) return;
    const rec = { date: today, weight: Math.round(w * 100) / 100, steps: r.steps ?? null, calories_consumed: r.calories_consumed ?? null, calories_burned: r.calories_burned ?? null, meals: r.meals || [], exercises: r.exercises || [] };
    try { await store.save(rec); closeSheet(); await refresh(); } catch (e) { $('#err').textContent = authMsg(e); }
  };
}

/* ---------------- InBody ---------------- */
// Entered: weight, fat_pct, smm (skeletal muscle), visceral (level), whr (waist-hip ratio).
// Calculated: fat mass, lean mass, BMR (InBody: 370 + 21.6 × lean mass), BMI (needs height).
let HEIGHT = null; // cm
let PROFILE = null, GOAL = 50, BACK = true; // set by onboarding (null profile = existing account defaults)
const IB_FIELDS = [
  ['weight', '체중', 'kg', 2, true], ['fat_pct', '체지방률', '%', 1, true], ['smm', '골격근량', 'kg', 2, true],
  ['visceral', '내장지방레벨', '', 0, true], ['whr', '복부비만율', '', 2, true],
  ['fat_mass', '체지방량', 'kg', 2, false], ['ffm', '제지방량', 'kg', 2, false], ['bmi', 'BMI', '', 1, false], ['bmr', '기초대사량', 'kcal', 0, false],
];
function ibCalc(ib) {
  if (!ib) return null;
  const w = num(ib.weight), pct = num(ib.fat_pct);
  const fat = w != null && pct != null ? (w * pct) / 100 : null;
  const ffm = fat != null ? w - fat : null;
  return { ...ib, fat_mass: fat, ffm, bmr: ffm != null ? Math.floor(370 + 21.6 * ffm) : null, bmi: w != null && HEIGHT ? w / (HEIGHT / 100) ** 2 : null };
}
const ibFmt = (v, d) => (v == null || v === '' || Number.isNaN(Number(v)) ? '–' : Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
const ibRecs = () => recs().filter((r) => r.inbody);
function ibGrid(ib, prev) {
  const c = ibCalc(ib), p = prev ? ibCalc(prev) : null;
  return `<div class="ib-grid">${IB_FIELDS.map(([k, label, unit, d, input]) => {
    const v = c[k], pv = p?.[k];
    const delta = v != null && pv != null && Math.abs(v - pv) >= 10 ** -d / 2
      ? `<span class="ib-d ${v - pv < 0 ? 'dn' : 'upv'}">${v - pv > 0 ? '▲' : '▼'}${ibFmt(Math.abs(v - pv), d)}</span>` : '';
    return `<div class="ib-cell"><small>${label}${input ? '' : ' <em>자동</em>'}</small><b>${ibFmt(v, d)}<span class="u">${unit}</span></b>${delta}</div>`;
  }).join('')}</div>`;
}
function openInbodySheet(date) {
  const r = cache[date] || {}, ib = r.inbody || {};
  const val = (k) => ib[k] ?? (k === 'weight' ? r.weight ?? '' : '');
  openSheet(`<div class="sheet-head"><h2>${dateLabel(date)} 인바디</h2></div>
    <p class="desc small">결과지에서 아래 5개만 옮겨 적으면, 나머지는 자동으로 계산돼요.</p>
    <div class="two">${IB_FIELDS.filter((f) => f[4]).map(([k, label, unit]) => `<div><label class="f">${label}</label>
      <label class="unit-in"><input id="ib-${k}" type="number" step="any" inputmode="decimal" value="${val(k)}" placeholder="0"><span>${unit}</span></label></div>`).join('')}</div>
    <label class="f">자동 계산</label><div id="ibAuto"></div>
    ${HEIGHT ? '' : '<p class="desc small">BMI는 설정에서 키를 입력하면 계산돼요.</p>'}
    <div class="err" id="err"></div><button class="btn" id="ibSave">저장</button>${r.inbody ? '<button class="btn danger" id="ibDel">인바디 기록 삭제</button>' : ''}`);
  const read = () => Object.fromEntries(IB_FIELDS.filter((f) => f[4]).map(([k]) => [k, num($(`#ib-${k}`).value)]));
  const auto = () => { const c = ibCalc(read()); $('#ibAuto').innerHTML = `<div class="ib-grid">${IB_FIELDS.filter((f) => !f[4]).map(([k, label, unit, d]) => `<div class="ib-cell"><small>${label}</small><b>${ibFmt(c[k], d)}<span class="u">${unit}</span></b></div>`).join('')}</div>`; };
  sheet.querySelectorAll('input').forEach((x) => { x.oninput = auto; }); auto();
  const save = async (inbody) => {
    const rec = { date, weight: r.weight ?? (inbody?.weight ?? null), steps: r.steps ?? null, calories_consumed: r.calories_consumed ?? null, calories_burned: r.calories_burned ?? null, meals: r.meals || [], exercises: r.exercises || [], inbody };
    try { await store.save(rec); closeSheet(); await refresh(); } catch (e) { $('#err').textContent = (e.message || '').includes('inbody') ? '인바디 저장 칸이 아직 없어요. Supabase에서 0004_inbody.sql을 먼저 실행해주세요.' : authMsg(e); }
  };
  $('#ibSave').onclick = () => { const v = read(); if (v.fat_pct == null && v.smm == null) { $('#err').textContent = '체지방률이나 골격근량 중 하나는 입력해주세요.'; return; } save(v); };
  if ($('#ibDel')) $('#ibDel').onclick = () => save(null);
}
function setHeightSheet() {
  openSheet(`<div class="sheet-head"><h2>키</h2></div><p class="desc small">BMI 계산에만 쓰여요.</p>
    <label class="unit-in big-in"><input id="hIn" type="number" step="0.1" inputmode="decimal" value="${HEIGHT ?? ''}" placeholder="0"><span>cm</span></label>
    <div class="err" id="err"></div><button class="btn" id="hSave">저장</button>`);
  $('#hSave').onclick = async () => {
    const h = num($('#hIn').value); if (!h) return;
    try {
      if (store.mode === 'supabase') { const { data: { user } } = await store.sb.auth.getUser(); const { error } = await store.sb.from('users').update({ height: h }).eq('id', user.id); if (error) throw error; }
      else localStorage.setItem('diet.height', String(h));
      HEIGHT = h; closeSheet(); render();
    } catch (e) { $('#err').textContent = '키 저장 칸이 아직 없어요. Supabase에서 0004_inbody.sql을 먼저 실행해주세요.'; }
  };
}

function lineChart(rows, val, fmt) {
  const vals = rows.map(val), mn = Math.min(...vals), mx = Math.max(...vals), avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const W = 320, H = 160, p = 10, span = mx - mn || 1;
  const pts = vals.map((v, i) => [p + (rows.length === 1 ? (W - 2 * p) / 2 : (i * (W - 2 * p)) / (rows.length - 1)), H - p - ((v - mn) / span) * (H - 2 * p)]);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}"><polyline fill="none" stroke="#3182f6" stroke-width="2.5" stroke-linejoin="round" points="${pts.map((q) => q.join(',')).join(' ')}"/>
      ${pts.map((q) => `<circle cx="${q[0]}" cy="${q[1]}" r="3.5" fill="#3182f6"/>`).join('')}</svg>
      <div class="stat-row"><div class="stat"><small>최소</small><b>${fmt(mn)}</b></div><div class="stat"><small>평균</small><b>${fmt(avg)}</b></div><div class="stat"><small>최대</small><b>${fmt(mx)}</b></div></div>`;
}
let ibMetric = 'fat_pct';
function viewStats() {
  const rows = recs().filter((r) => r[metric] != null && r.date >= START).slice(-30);
  const meta = { weight: ['몸무게', 'kg'], calories_consumed: ['섭취', 'kcal'], calories_burned: ['소모', 'kcal'], steps: ['걸음', '걸음'] };
  const seg = Object.entries(meta).map(([k, [n]]) => `<button data-metric="${k}" class="${k === metric ? 'on' : ''}">${n}</button>`).join('');
  const body = rows.length ? lineChart(rows, (r) => Number(r[metric]), (v) => (metric === 'weight' ? v.toFixed(2) : Math.round(v).toLocaleString())) : '<div class="empty">아직 기록이 없어요</div>';
  const ibs = ibRecs();
  let ibCard = `<div class="card"><div class="card-title">인바디</div><div class="empty">아직 인바디 기록이 없어요. 기록 탭에서 날짜를 고르고 '+ 인바디'를 눌러 추가하세요.</div></div>`;
  if (ibs.length) {
    const last = ibs[ibs.length - 1], prev = ibs[ibs.length - 2];
    const f = IB_FIELDS.find((x) => x[0] === ibMetric);
    const ser = ibs.map((r) => [r, ibCalc(r.inbody)[ibMetric]]).filter(([, v]) => v != null);
    const iseg = IB_FIELDS.map(([k, n]) => `<button data-ibmetric="${k}" class="${k === ibMetric ? 'on' : ''}">${n}</button>`).join('');
    ibCard = `<div class="card"><div class="card-title">인바디<span class="sub">${dateLabel(last.date)} 측정${prev ? ` · ${dateLabel(prev.date)} 대비` : ''}</span></div>${ibGrid(last.inbody, prev?.inbody)}</div>
    <div class="card"><div class="card-title">인바디 변화<span class="sub">${ibs.length}회 측정</span></div><div class="seg scroll">${iseg}</div>
      ${ser.length ? lineChart(ser.map(([r]) => r), (r) => ibCalc(r.inbody)[ibMetric], (v) => ibFmt(v, f[3])) : '<div class="empty">값이 없어요</div>'}
      <div class="ib-hist">${ibs.slice().reverse().map((r) => { const c = ibCalc(r.inbody); return `<button class="li" data-ibdate="${r.date}"><span>${dateLabel(r.date)}</span><span class="g">체지방 ${ibFmt(c.fat_pct, 1)}% · 골격근 ${ibFmt(c.smm, 2)}kg</span></button>`; }).join('')}</div></div>`;
  }
  const lifts = {};
  recs().forEach((r) => (r.exercises || []).forEach((e) => { const n = e.planned || e.name; if (Number(e.weight) > 0) (lifts[n] = lifts[n] || []).push({ d: r.date, w: Number(e.weight) }); }));
  const liftRows = Object.entries(lifts).map(([n, l]) => ({ n, first: l[0].w, last: l[l.length - 1].w, cnt: l.length, d: l[l.length - 1].d })).sort((a, b) => b.d.localeCompare(a.d)).slice(0, 6);
  const liftCard = liftRows.length ? `<div class="card"><div class="card-title">운동 무게 변화<span class="sub">최근 순</span></div>${liftRows.map((x) => `<div class="sum-row"><span class="sum-k" style="width:auto;flex:1">${esc(x.n)}</span><b>${x.first}${x.cnt > 1 ? ` → ${x.last}` : ''}kg ${x.last > x.first ? `<small style="color:var(--blue)">▲${+(x.last - x.first).toFixed(1)}</small>` : ''}</b></div>`).join('')}</div>` : '';
  return `<div class="card"><div class="eyebrow">시작일(${dateLabel(START)}) 이후 · ${meta[metric][1]}</div><div class="seg" style="margin-top:12px">${seg}</div>${body}</div>${liftCard}${ibCard}`;
}

function startOfWeek(dateStr) { const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() - d.getDay()); return d; }
function weekDates(dateStr) { const s = startOfWeek(dateStr); return Array.from({ length: 7 }, (_, i) => { const d = new Date(s); d.setDate(s.getDate() + i); return iso(d); }); }

function viewRecord() {
  const r = cache[recordDate] || {};
  return `
  ${weekBar(recordDate, 'data-recdate', 'openCal', (d) => cache[d] && (cache[d].weight != null || (cache[d].meals || []).length || (cache[d].exercises || []).length))}
  <div class="card">
    <div class="sheet-head" style="margin-bottom:0"><div class="eyebrow">${dateLabel(recordDate)} · 체중 ${r.weight != null ? Number(r.weight).toFixed(2) + 'kg' : '–'} · ${r.steps ?? '–'}걸음</div><div class="head-btns"><button class="edit-link ib-link" data-ibdate="${recordDate}">${r.inbody ? '인바디 수정' : '+ 인바디'}</button><button class="edit-link" data-recedit="${recordDate}">편집</button></div></div>
  </div>
  ${r.inbody ? `<div class="card"><div class="card-title">인바디<span class="ib-tag">측정일</span></div>${ibGrid(r.inbody, ibRecs().filter((x) => x.date < recordDate).pop()?.inbody)}</div>` : ''}
  <div class="card"><div class="eyebrow">식단</div>${mealGroupsHtml(r.meals)}</div>
  <div class="card"><div class="eyebrow">운동</div>${(r.exercises || []).map((e) => exRowView(e)).join('') || '<div class="empty">기록된 운동이 없어요</div>'}</div>`;
}

// compact steps / watch-calories row for the 체크 tab (saved on change, no extra screens)
// Burned kcal = steps + logged exercise. Steps are estimated at ~0.0005 kcal × body weight(kg) per step;
// steps already covered by logged walking exercises (~100 steps/min) are not counted twice.
const WALKISH = /걷기|산책|워킹|하이킹/;
function calcBurn(r) {
  const steps = Number(r.steps) || 0, ex = (r.exercises || []).reduce((a, e) => a + (Number(e.kcal) || 0), 0);
  if (!steps && !ex) return null;
  const w = Number(r.weight) || latestWeight() || 65;
  const walkMin = (r.exercises || []).filter((e) => WALKISH.test(e.name || '')).reduce((a, e) => a + (Number(e.duration) || 0), 0);
  return Math.round(Math.max(0, steps - walkMin * 100) * 0.0005 * w) + Math.round(ex);
}
function burnParts(r) {
  const total = calcBurn(r) ?? 0, ex = Math.round((r.exercises || []).reduce((a, e) => a + (Number(e.kcal) || 0), 0));
  return { total, ex, steps: total - ex };
}
function activityRow(date) {
  const r = cache[date] || {};
  if (READONLY) return `<div class="act-row"><span>걸음 <b>${r.steps != null ? Number(r.steps).toLocaleString() : '–'}</b></span><span>소모 <b>${r.calories_burned != null ? Number(r.calories_burned).toLocaleString() : '–'}</b> kcal</span></div>`;
  return `<div class="act-row" data-actdate="${date}"><label>걸음<input class="act-in" data-f="steps" type="number" inputmode="numeric" placeholder="0" value="${r.steps ?? ''}"></label>
    <label class="auto" title="걸음 + 운동으로 자동 계산">소모<b class="burn-val">${calcBurn(r) != null ? '≈ ' + calcBurn(r).toLocaleString() : '–'}</b><span>kcal 자동</span></label><i class="act-ok" aria-live="polite"></i></div>`;
}
function viewMeals() {
  const r = cache[mealDate] || {};
  const planned = dayPlan.meals.reduce((a, m) => a + (m.kcal || 0), 0);
  const ate = (r.meals || []).reduce((a, m) => a + (m.kcal || 0), 0);
  const exIdx = (r.meals || []).map((m, i) => [m, i]).filter(([m]) => !m.plan);
  const planTypes = new Set(dayPlan.meals.map((m) => m.type));
  const xRow = ([m, i]) => mealRowView(m, `${mealDate}:${i}`);
  const xRowPlain = ([m, i]) => mealRowView(m, `${mealDate}:${i}`).replace('<span class="tag t-x">추가</span>', '');
  const groups = MEAL_TYPES.map((type) => {
    const rows = dayPlan.meals.map((m, i) => [m, i]).filter(([m]) => m.type === type);
    if (!rows.length) return '';
    const allSkip = rows.every(([m]) => itemStatus(m) === 'skip');
    const key = `${mealDate}|${type}`, mine = exIdx.filter(([m]) => m.type === type);
    const head = `<div class="mg-label mg-flex">${type}<span class="mg-btns"><button type="button" class="skipall" data-swapmeal="${type}">다른 걸 먹었어요</button><button type="button" class="skipall${allSkip ? ' undo' : ''}" data-skipmeal="${type}">${allSkip ? '안 먹음 취소' : '안 먹었어요'}</button></span></div>`;
    // when the whole meal was skipped, fold the planned items into one line (less scrolling)
    const body = allSkip && !openMeals.has(key)
      ? `<button type="button" class="mg-collapsed" data-expand="${key}">계획 ${rows.length}개 · 안 먹음<span>펼치기 ▾</span></button>`
      : rows.map(([m, i]) => checkRow('meals', i, m)).join('') + (allSkip ? `<button type="button" class="mg-collapsed open" data-expand="${key}">접기 ▴</button>` : '');
    return head + body + mine.map(xRow).join('');
  }).join('');
  const bottomTypes = [...MEAL_TYPES, '기타'].filter((t) => !planTypes.has(t));
  const xMealsBottom = bottomTypes.map((t) => { const rows = exIdx.filter(([m]) => (MEAL_TYPES.includes(m.type) ? m.type : '기타') === t); return rows.length ? `<div class="mg-label">${t}</div>${rows.map(xRowPlain).join('')}` : ''; }).join('');
  const extra = (r.meals || []).filter((m) => !m.plan);
  const exExtra = (r.exercises || []).filter((x) => !x.plan);
  const xMeals = (r.meals || []).map((m, i) => [m, i]).filter(([m]) => !m.plan).map(([m, i]) => mealRowView(m, `${mealDate}:${i}`)).join('');
  const xEx = (r.exercises || []).map((e, i) => [e, i]).filter(([e]) => !e.plan).map(([e, i]) => exRowView(e, `${mealDate}:${i}`)).join('');
  const exExtraHtml = exExtra.length ? `<div class="mg-label">계획 외로 한 운동</div>${xEx}` : '';
  const bar = weekBar(mealDate, 'data-mealdate', 'openMealCal', (d) => d === mealDate ? dayPlan.meals.length > 0 : !!(cache[d]?.meals || []).length);
  if (!dayPlan.meals.length && !dayPlan.exercises.length) return `${bar}
    <div class="card"><div class="card-title">${dateLabel(mealDate)} 계획이 없어요</div><p class="desc">추천 플랜을 받으면 이 날 먹을 식단과 운동이 채워져요.</p>
    <button class="btn" id="genDay">추천 플랜 받기</button></div>
    ${extra.length ? `<div class="card"><div class="card-title">기록한 음식</div>${xMeals}</div>` : ''}
    ${exExtra.length ? `<div class="card"><div class="card-title">기록한 운동</div>${xEx}</div>` : ''}
    <div class="card">${activityRow(mealDate)}<button class="link-btn" style="padding:0" data-fooddate="${mealDate}">+ 음식 기록하기</button><button class="link-btn" style="padding:14px 0 0;display:block" data-exdate="${mealDate}">+ 운동 기록하기</button></div>`;
  return `${bar}
  <div class="card"><div class="card-title">${dateLabel(mealDate)} 식단<span class="sub">${ate.toLocaleString()} / ${planned.toLocaleString()} kcal</span></div>
    <p class="desc small">동그라미: 계획대로 먹음 · ⋯: 다른 걸 먹었거나 안 먹었을 때</p>${groups}
    ${xMealsBottom}
    <button class="link-btn" data-fooddate="${mealDate}">+ 계획에 없던 음식 기록하기</button></div>
  <div class="card"><div class="card-title">운동<span class="sub">${['일', '월', '화', '수', '목', '금', '토'][new Date(mealDate + 'T00:00:00').getDay()]}요일 루틴</span></div>
    <p class="desc small">동그라미: 계획대로 함 · ⋯: 다른 운동을 했거나 못 했을 때</p>
    ${activityRow(mealDate)}
    ${dayPlan.exercises.map((e, i) => checkRow('exercises', i, e)).join('') || '<div class="empty">쉬는 날이에요</div>'}
    ${exExtraHtml}
    <button class="link-btn" data-exdate="${mealDate}">+ 계획에 없던 운동 기록하기</button></div>`;
}

const EX_QUICK = [['걷기', '유산소'], ['러닝', '유산소'], ['자전거', '유산소'], ['수영', '유산소'], ['등산', '유산소'], ['요가', '스트레칭'], ['스트레칭', '스트레칭'], ['푸시업', '근력'], ['스쿼트', '근력'], ['플랭크', '근력']];
// exercise-only entry: adds to the day's record without touching weight, food or the plan
function openExerciseSheet(date) {
  openSheet(`<div class="sheet-head"><h2>${dateLabel(date)} 운동 추가</h2></div>
    <p class="desc small">계획에 없던 운동만 적어요. 칼로리를 비워두면 시간으로 자동 계산해요.</p>
    <div class="favpanel" id="quick">${EX_QUICK.map(([n, c], i) => `<button type="button" class="favchip" data-q="${i}">${n}</button>`).join('')}</div>
    <div id="rows">${exRowEdit({ category: '유산소' })}</div>
    <button class="add" id="add">+ 운동 더 추가</button>
    <div class="err" id="err"></div><button class="btn" id="save">저장</button>`);
  $('#add').onclick = () => $('#rows').insertAdjacentHTML('beforeend', exRowEdit({ category: '유산소' }));
  $('#quick').onclick = (e) => { const b = e.target.closest('[data-q]'); if (!b) return; const [name, category] = EX_QUICK[b.dataset.q];
    const first = $('#rows .exrow'); if (first && !first.querySelector('.f-name').value.trim()) first.remove();
    $('#rows').insertAdjacentHTML('beforeend', exRowEdit({ category, name })); };
  wireExRows($('#rows'));
  $('#save').onclick = async () => {
    const added = readExRows($('#rows')).map(({ done, ...x }) => x);
    if (!added.length) { $('#err').textContent = '운동 이름을 입력해주세요.'; return; }
    const r = cache[date] || {};
    const rec = { date, weight: r.weight ?? null, steps: r.steps ?? null, calories_consumed: r.calories_consumed ?? null, calories_burned: calcBurn({ ...r, exercises: [...(r.exercises || []), ...added] }) ?? r.calories_burned ?? null, meals: r.meals || [], exercises: [...(r.exercises || []), ...added] };
    try { await store.save(rec); closeSheet(); await refresh(); } catch (e) { $('#err').textContent = authMsg(e); }
  };
}

function guessMealType(date) {
  if (date !== today) return '아침';
  const h = new Date().getHours();
  return h < 4 ? '야식' : h < 10 ? '아침' : h < 15 ? '점심' : h < 21 ? '저녁' : '야식';
}
// food-only entry: adds to the day's record without touching weight, steps, exercise or the plan
function openFoodSheet(date) {
  openSheet(`<div class="sheet-head"><h2>${dateLabel(date)} 음식 추가</h2></div>
    <p class="desc small">계획에 없던 음식만 적어요. 다른 기록은 그대로예요.</p>
    ${foodSearchHtml()}
    <div id="rows">${mealRowEdit({ type: guessMealType(date) })}</div>
    <div class="favrow"><button class="add" id="add">+ 음식 더 추가</button><button class="add" id="favToggle">☆ 자주 먹는 음식에서 추가</button></div>
    <div class="favpanel" id="favPanel" hidden>${favChipsHtml()}</div>
    <div class="err" id="err"></div><button class="btn" id="save">저장</button>`);
  $('#add').onclick = wireMealRows($('#rows'));
  wireFavPanel($('#favToggle'), $('#favPanel'), $('#rows'));
  wireFoodSearch(sheet.querySelector('.fs'), (f) => addFoodRow($('#rows'), { type: SNACKISH.includes(f.cat) ? '간식' : guessMealType(date), name: f.name, grams: f.grams, kcal: f.kcal }));
  $('#save').onclick = async () => {
    const added = readMealRows($('#rows'));
    if (!added.length) { $('#err').textContent = '음식 이름을 입력해주세요.'; return; }
    const r = cache[date] || {};
    const meals = [...(r.meals || []), ...added];
    const rec = { date, weight: r.weight ?? null, steps: r.steps ?? null, calories_consumed: meals.reduce((a, m) => a + (m.kcal || 0), 0) || null, calories_burned: r.calories_burned ?? null, meals, exercises: r.exercises || [] };
    try { await store.save(rec); closeSheet(); await refresh(); } catch (e) { $('#err').textContent = authMsg(e); }
  };
}

function viewSettings() {
  return `<div class="card">
    <div class="eyebrow">계정</div><div class="big" style="font-size:17px;margin:6px 0 16px">${esc(accountLabel) || '–'}</div>
    <div class="eyebrow">다이어트 시작일</div>
    <button type="button" class="in daterow" id="startDateBtn" style="margin:6px 0 16px">${dateLabel(START)}<span class="chev">›</span></button>
    <div class="eyebrow">키 (BMI 계산용)</div>
    <button type="button" class="in daterow" id="heightBtn" style="margin:6px 0 16px">${HEIGHT ? HEIGHT + ' cm' : '입력해주세요'}<span class="chev">›</span></button>
    <div class="eyebrow">목표 체중</div>
    <button type="button" class="in daterow" id="goalBtn" style="margin:6px 0 16px">${GOAL} kg<span class="chev">›</span></button>
    <div class="eyebrow">자주 먹는 음식</div>
    <div class="favcats">${FAV_CATS.map((c) => `<button type="button" class="favcat-btn" data-favcat="${c}"><span>${c}</span><b>${favorites.filter((f) => favCat(f) === c).length}</b></button>`).join('')}</div>
    <button type="button" class="in daterow" id="favManageBtn" style="margin:8px 0 16px">전체 보기·편집 (${favorites.length})<span class="chev">›</span></button>
    <div class="eyebrow">운동 장소</div>
    <div class="seg" style="margin:6px 0 4px"><button class="${useGym ? '' : 'on'}" data-gym="0">집 (맨몸)</button><button class="${useGym ? 'on' : ''}" data-gym="1">헬스장 (머신)</button></div>
    <div class="eyebrow">허리·관절</div>
    <div class="seg" style="margin:6px 0 12px"><button class="${BACK ? '' : 'on'}" data-back="0">괜찮아요</button><button class="${BACK ? 'on' : ''}" data-back="1">불편해요 (허리 보호)</button></div>
    <div class="eyebrow">운동 경험</div>
    <div class="seg" style="margin:6px 0 4px">${[['new', '처음'], ['some', '가끔'], ['steady', '꾸준히']].map(([v, t]) => `<button class="${(PROFILE?.level || 'new') === v ? 'on' : ''}" data-level="${v}">${t}</button>`).join('')}</div>
    <p class="desc small" style="margin:0 0 16px">운동 장소·허리·경험은 추천 플랜을 새로 받을 때부터 적용돼요.</p>
    ${IS_ADMIN ? `<div class="eyebrow">관리자</div><button type="button" class="in daterow" id="foodAdminBtn" style="margin:6px 0 16px">음식 승인 대기 (${pendingFoodCount})<span class="chev">›</span></button>` : ''}
    <div class="eyebrow">도움말</div>
    <button type="button" class="in daterow" id="tourBtn" style="margin:6px 0 16px">사용방법 보기<span class="chev">›</span></button>
    <div class="eyebrow">모드</div><div style="margin:6px 0 16px">${store?.label || ''}</div>
    <div class="eyebrow">앱 버전</div><div style="margin:6px 0 16px;color:var(--sub);font-size:13px">${APP_VERSION}</div>
    ${store?.mode === 'supabase' ? `<div class="eyebrow">내 기록 공유하기</div>
    <button type="button" class="in daterow" id="shareBtn" style="margin:6px 0 16px">${shareToken ? '공유 중 · 링크 보기' : '읽기 전용 링크 만들기'}<span class="chev">›</span></button>
    <div class="eyebrow">계정 관리</div>
    <button class="btn ghost" id="chPw">비밀번호 변경</button><button class="btn ghost" id="doLogout">로그아웃</button>` : ''}
  </div>${store?.mode === 'supabase' ? '<div class="foot-link"><button type="button" id="delAcct">회원 탈퇴</button></div>' : ''}`;
}
async function setStartDate(d) {
  START = d;
  if (store.mode === 'supabase') {
    const { data: { user } } = await store.sb.auth.getUser();
    await store.sb.from('users').update({ start_date: d }).eq('id', user.id);
  } else {
    localStorage.setItem('diet.startDate', d);
  }
  await refresh();
}

let planData = { meals: [], exercises: [] };
function weekCard() {
  const w = weekStats; if (!w || !w.days) return '';
  const full = w.days >= 7;
  const ok = (c) => (full ? `<span class="pill ${c ? 's-done' : 's-swap'}">${c ? '권장 충족' : '권장 미달'}</span>` : `<span class="pill s-wait">${w.days}일 계획됨</span>`);
  const bar = (a, b) => `<div class="bar"><i style="width:${b ? Math.min(100, Math.round((a / b) * 100)) : 0}%"></i></div>`;
  const active = w.aer + w.str * 25;
  return `<div class="card"><div class="card-title">이번 주 운동 균형<span class="sub">${programWeek(planDate)}주차</span></div>
    <div class="sum-row"><span class="sum-k" style="width:48px">근력</span>${ok(w.str >= 2)}<b>${w.str}일 계획 <small>/ 주 2일 이상</small></b></div>${bar(w.strDone, w.str)}
    <div class="sum-row"><span class="sum-k" style="width:48px">유산소</span>${ok(w.aer >= 150)}<b>${w.aer}분 계획 <small>/ 150~300분</small></b></div>${bar(w.aerDone, w.aer)}
    <p class="desc small">근력 ${w.strDone}/${w.str}일 · 유산소 ${w.aerDone}/${w.aer}분 완료 · 근력 시간을 합친 활동량 약 ${active}분 (감량 목표 250분 이상)</p>
    <p class="desc small">근력은 전신을 주 2~3회, 같은 근육은 하루 이상 쉬게 배치했어요. 처음 2주는 2세트, 3~4주는 3세트, 5주부터 횟수를 늘려요. 강도는 "말은 할 수 있지만 노래는 못 부르는" 정도가 기준이에요.</p></div>`;
}
function trendCard() {
  const t = TREND;
  if (t.status === 'few') return `<div class="card"><div class="card-title">체중 추이 분석</div><p class="desc">다이어트 시작일 이후 체중을 4번 이상, 10일 이상 간격으로 기록하면 감량 속도를 분석해서 식단과 운동을 자동으로 맞춰드려요.</p></div>`;
  const label = { good: ['목표 속도예요', 's-done'], slow: ['조금 느려요', 's-part'], stall: ['정체 구간이에요', 's-wait'], fast: ['너무 빨라요', 's-swap'] }[t.status];
  const msg = {
    good: `주 0.3~${t.fastMax.toFixed(1)}kg이 건강한 속도예요. 지금 플랜을 그대로 유지해요.`,
    slow: '식단은 그대로 두고, 유산소를 회당 5분 늘렸어요.',
    stall: t.atFloor ? '식단은 이미 최저선(1,300kcal)이라 줄이지 않고, 유산소를 회당 10분 늘렸어요.' : '하루 목표를 100kcal 낮추고 유산소를 회당 10분 늘렸어요. (최저 1,300kcal은 지켜요)',
    fast: '근손실 위험이 있어 하루 목표를 100kcal 올렸어요. 단백질과 근력운동은 꼭 지켜주세요.',
  }[t.status];
  const left = t.w - GOAL, wks = t.loss > 0.1 ? left / t.loss : null;
  return `<div class="card"><div class="card-title">체중 추이 분석<span class="pill ${label[1]}">${label[0]}</span></div>
    <div class="sum-row"><span class="sum-k" style="width:auto">${Math.round(t.span)}일간</span><b>주 ${Math.abs(t.loss).toFixed(2)}kg ${t.loss >= 0 ? '감량' : '증가'} <small>/ ${t.n}회 측정</small></b></div>
    <p class="desc">${msg}</p>
    ${wks && wks <= 104 ? `<p class="desc small">이 속도라면 목표 ${GOAL}kg까지 약 ${Math.ceil(wks)}주 걸려요.</p>` : ''}
    <p class="desc small">새로 만드는 플랜부터 적용돼요. 이미 만든 날은 아래 '추천 플랜으로 채우기'를 눌러 바꿀 수 있어요.</p></div>`;
}
function viewPlan() {
  return `<div class="card"><button type="button" class="in daterow" id="planDateBtn">${dateLabel(planDate)}<span class="chev">›</span></button></div>
  ${trendCard()}
  ${weekCard()}
  <div class="card"><div class="card-title">추천 플랜<span class="sub">하루 ${kcalTarget(latestWeight()).toLocaleString()}kcal</span></div>
    <p class="desc">체중 기준 주 0.5kg 감량 속도로 맞췄어요. 건강을 위해 ${KCAL_FLOOR.toLocaleString()}kcal 아래로는 내려가지 않아요. 허리에 무리 없는 운동만 넣었어요.</p>
    <button class="btn" data-plan="gen">${dateLabel(planDate)} 추천 플랜으로 채우기</button><button class="btn ghost" data-plan="genweek">앞으로 7일 한 번에 채우기</button></div>
  <div class="card"><div class="card-title">식단<span class="sub">${(planData.meals || []).reduce((a, m) => a + (m.kcal || 0), 0).toLocaleString()} kcal</span></div>${mealGroupsHtml(planData.meals)}<button class="btn ghost" data-plan="meals">식단 편집</button></div>
  <div class="card"><div class="card-title">운동</div>${(planData.exercises || []).map((e) => exRowView(e)).join('') || '<div class="empty">계획된 운동이 없어요</div>'}<button class="btn ghost" data-plan="exercises">운동 편집</button></div>`;
}

/* ---------------- sheet (view / editor) ---------------- */
const sheet = $('#sheet'), bg = $('#sheetBg');
// iOS keyboard: keep the sheet inside the visible viewport and stop the page behind it from scrolling
let lockedY = 0, sheetTyping = false, baseH = window.innerHeight;
const isField = (t) => t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
// While typing (keyboard up) the sheet grows to fill all the visible space above the keyboard; otherwise it sizes to its content.
function syncSheetViewport() {
  const v = window.visualViewport; if (!v || sheet.hidden) return;
  const kb = Math.max(0, Math.round(window.innerHeight - v.height - v.offsetTop));
  const shrunk = window.innerHeight < baseH - 80; // webview itself was resized by the keyboard
  const full = sheetTyping && (kb > 0 || shrunk);
  sheet.classList.toggle('full', full);
  sheet.style.bottom = kb + 'px';
  if (full) { const h = Math.floor(v.height - 8) + 'px'; sheet.style.height = h; sheet.style.maxHeight = h; sheet.style.paddingBottom = '64px'; }
  else { sheet.style.height = ''; sheet.style.maxHeight = Math.floor(v.height * 0.94) + 'px'; sheet.style.paddingBottom = kb > 0 ? '16px' : ''; }
}
if (window.visualViewport) { visualViewport.addEventListener('resize', syncSheetViewport); visualViewport.addEventListener('scroll', syncSheetViewport); }
window.addEventListener('resize', syncSheetViewport);
sheet.addEventListener('focusin', (e) => {
  const t = e.target; if (!isField(t)) return;
  sheetTyping = true; syncSheetViewport();
  setTimeout(() => { syncSheetViewport(); t.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 320);
});
sheet.addEventListener('focusout', () => setTimeout(() => { if (!isField(document.activeElement) || !sheet.contains(document.activeElement)) { sheetTyping = false; syncSheetViewport(); } }, 120));
function openSheet(html) {
  sheet.innerHTML = `<div class="sheet-handle"></div>${html}`;
  sheet.style.transform = '';
  if (sheet.hidden) { lockedY = window.scrollY; document.body.style.top = `-${lockedY}px`; document.body.classList.add('sheet-open'); }
  sheet.hidden = bg.hidden = false;
  if (!sheetTyping) baseH = Math.max(baseH, window.innerHeight);
  syncSheetViewport();
}
function closeSheet() {
  if (!sheet.hidden) { try { document.activeElement?.blur(); } catch {} document.body.classList.remove('sheet-open'); document.body.style.top = ''; window.scrollTo(0, lockedY); }
  sheet.hidden = bg.hidden = true; sheetTyping = false; sheet.classList.remove('full'); sheet.style.transform = ''; sheet.style.bottom = ''; sheet.style.height = ''; sheet.style.maxHeight = ''; sheet.style.paddingBottom = '';
}
bg.onclick = closeSheet;
sheet.addEventListener('click', (e) => { const fav = e.target.closest('.favmini'); if (fav) favMiniClick(fav); });

// swipe-down-to-close: dragging the handle always works; dragging the content works
// once it's already scrolled to the top (so it reads as "nothing left to pull").
(() => {
  let startY = null, dragging = false, fromHandle = false;
  sheet.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
    if (e.target.closest('.drag')) { startY = null; return; }
    fromHandle = !!e.target.closest('.sheet-handle');
    dragging = fromHandle; // content-drag decided on first move
    if (fromHandle) sheet.style.transition = 'none';
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    const dy = e.touches[0].clientY - startY;
    if (!dragging) {
      if (!fromHandle && sheet.scrollTop <= 0 && dy > 0) { dragging = true; sheet.style.transition = 'none'; }
      else return;
    }
    if (dy <= 0) return; // only pulling down closes
    e.preventDefault();
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: false });
  const end = (e) => {
    if (!dragging) { startY = null; return; }
    dragging = false;
    sheet.style.transition = '';
    const y = (e.changedTouches && e.changedTouches[0].clientY) ?? startY;
    const dy = Math.max(0, y - startY);
    const threshold = fromHandle ? sheet.offsetHeight * (2 / 3) : sheet.offsetHeight * 0.22;
    if (dy > threshold) closeSheet();
    else sheet.style.transform = '';
    startY = null; fromHandle = false;
  };
  sheet.addEventListener('touchend', end);
  sheet.addEventListener('touchcancel', end);
})();

/* meal row editor: type + name + grams/kcal with unit labels */
const FOODS = `
현미밥 1공기|210|310|식사
백미밥 1공기|210|310|식사
잡곡밥 1공기|210|300|식사
김치찌개|400|250|식사
된장찌개|350|150|식사
순두부찌개|400|220|식사
부대찌개|450|480|식사
미역국|300|70|식사
소고기뭇국|300|110|식사
북엇국|300|90|식사
콩나물국|250|40|식사
계란국|250|70|식사
시금치 나물|70|45|식사
콩나물 무침|70|40|식사
김치|50|15|식사
깍두기|50|20|식사
계란후라이 1개|50|90|식사
삶은 계란 1개|50|75|식사
계란찜|120|100|식사
계란말이|100|150|식사
두부부침|100|120|식사
두부스테이크|150|180|식사
닭가슴살 구이|100|120|식사
닭가슴살 샐러드|250|250|식사
닭볶음탕|300|330|식사
제육볶음|200|380|식사
불고기|150|260|식사
소고기 우둔 구이|100|150|식사
삼겹살 구이|150|520|식사
수육|100|230|식사
고등어구이|100|230|식사
연어구이|100|200|식사
생선구이(조기·삼치)|100|150|식사
오징어볶음|200|260|식사
어묵볶음|80|120|식사
멸치볶음|30|90|식사
감자조림|100|110|식사
애호박볶음|100|60|식사
버섯볶음|100|60|식사
잡채|150|250|식사
김밥 1줄|230|450|식사
참치김밥 1줄|240|480|식사
삼각김밥 1개|110|180|식사
주먹밥 1개|100|170|식사
비빔밥|450|580|식사
나물 비빔밥|400|550|식사
김치볶음밥|400|650|식사
볶음밥|400|620|식사
오므라이스|400|700|식사
카레라이스|450|660|식사
덮밥(제육·불고기)|450|700|식사
회덮밥|450|620|식사
죽 (야채·닭)|400|230|식사
오트밀 1회분|40|150|식사
그릭요거트 1통|150|100|식사
요거트(플레인) 1컵|100|65|식사
우유 1컵|200|130|음료
두유 1팩|190|100|음료
샐러드(드레싱 포함)|150|120|식사
고구마 1개|120|150|식사
군고구마 큰 것|200|260|식사
감자 1개 (삶은)|130|100|식사
옥수수 1개|150|130|식사
바나나 1개|100|90|간식
텐텐 1개(낱개)|4|17|간식
사과 1개|200|100|간식
귤 1개|80|35|간식
오렌지 1개|150|70|간식
방울토마토 10개|150|30|간식
토마토 1개|180|35|간식
딸기 10알|150|50|간식
블루베리 한 줌|50|30|간식
포도 1송이(작은)|150|100|간식
수박 1조각|300|90|간식
참외 1개|250|90|간식
키위 1개|90|50|간식
견과류 1봉|25|150|간식
아몬드 10알|15|90|간식
단백질바 1개|50|190|간식
프로틴 쉐이크 1잔|300|150|음료
삶은 계란 2개|100|150|간식
치즈 1장|20|60|간식
오이 1개|100|15|간식
당근 스틱|100|40|간식
라면 1봉(국물 반)|500|500|외식
라면 1봉|550|520|외식
짜장면|600|800|외식
짬뽕|700|700|외식
탕수육 1인분|250|650|외식
볶음짬뽕밥|500|850|외식
칼국수|550|600|외식
잔치국수|500|450|외식
비빔국수|400|550|외식
냉면(물·비빔)|550|520|외식
막국수|500|480|외식
우동|500|450|외식
돈가스 정식|350|850|외식
치즈돈가스|300|900|외식
김치우동|500|470|외식
떡볶이 1인분|300|430|외식
순대 1인분|150|300|외식
튀김 1개|40|90|외식
오뎅(어묵) 1꼬치|50|60|외식
만두 5개|150|330|외식
군만두 5개|150|400|외식
냉동만두 5개 (찐)|150|320|외식
설렁탕|500|450|외식
갈비탕|600|500|외식
삼계탕|900|900|외식
순댓국|600|650|외식
돼지국밥|600|620|외식
육개장|450|380|외식
감자탕 1인분|500|520|외식
해장국|500|420|외식
곰탕|500|400|외식
꼬리곰탕|550|480|외식
샤브샤브 1인분(채소·고기)|500|450|외식
샤브샤브 칼국수 추가|200|300|외식
쌀국수|550|480|외식
팟타이|350|650|외식
초밥 10개|250|450|외식
회 1인분|150|200|외식
연어회 1인분|150|290|외식
연어덮밥|400|600|외식
소고기 스테이크 200g|200|450|외식
토마토 파스타|400|650|외식
크림 파스타|400|850|외식
알리오올리오|350|600|외식
까르보나라|400|900|외식
볼로네제 파스타|400|700|외식
리조또|350|600|외식
피자 1조각|110|280|외식
피자 2조각|220|560|외식
햄버거(싱글)|200|500|외식
치즈버거|200|520|외식
감자튀김(중)|110|340|외식
치킨 후라이드 1조각|100|250|외식
치킨 양념 1조각|110|290|외식
치킨 후라이드 반 마리|400|1000|외식
닭강정 1인분|200|550|외식
족발 1인분|200|500|외식
보쌈 1인분|200|450|외식
곱창 1인분|200|600|외식
삼겹살 1인분(구이)|180|620|외식
소고기 구이 1인분|150|350|외식
갈비 1인분|200|520|외식
냉동 닭가슴살 소시지 1개|100|110|간식
샌드위치(편의점)|180|320|외식
토스트(야채·계란)|150|300|외식
샐러드 파스타|300|420|외식
브런치 에그베네딕트|300|550|외식
시리얼 1회분 + 우유|230|250|식사
식빵 1장|35|100|식사
식빵 2장 + 잼|80|230|식사
베이글 1개|100|270|식사
크림치즈 베이글|130|380|식사
아메리카노|355|10|음료
카페라떼|355|150|음료
오트밀 라떼|355|180|음료
카푸치노|355|120|음료
바닐라라떼|355|250|음료
카라멜 마키아토|355|250|음료
카페모카|355|290|음료
아이스티|355|100|음료
녹차·차(무가당)|300|0|음료
콜라 1캔|250|105|음료
제로콜라 1캔|250|0|음료
사이다 1캔|250|100|음료
주스 1컵|200|100|음료
스무디 1잔|355|250|음료
밀크티|355|250|음료
버블티|500|400|음료
맥주 1캔|355|150|음료
맥주 500cc|500|210|음료
소주 1잔|50|60|음료
소주 1병|360|400|음료
막걸리 1잔|200|90|음료
와인 1잔|150|120|음료
하이볼 1잔|300|130|음료
이온음료 1병|500|100|음료
바스크 치즈케이크 1조각|120|380|디저트
치즈케이크 1조각|120|350|디저트
생크림 케이크 1조각|120|320|디저트
쿠키 1개|40|180|디저트
마카롱 1개|30|110|디저트
도넛 1개|70|250|디저트
글레이즈드 도넛|70|260|디저트
크루아상 1개|60|230|디저트
소금빵 1개|70|230|디저트
케이크 크림빵 1개|100|300|디저트
아이스크림 1컵|100|200|디저트
아이스크림 바 1개|80|150|디저트
빙수 1인분|500|550|디저트
호떡 1개|90|230|디저트
붕어빵 1개|50|100|디저트
와플 1개|100|290|디저트
초콜릿 1칸|10|55|디저트
초콜릿 바 1개|50|260|디저트
젤리 1봉|50|170|디저트
과자 1봉|60|320|디저트
감자칩 1봉|60|330|디저트
팝콘 1컵|60|250|디저트
떡 1개|50|110|디저트
인절미 3개|80|180|디저트
고구마 말랭이|50|150|간식
핫도그 1개|100|280|디저트
약과 1개|40|170|디저트
`.trim().split('\n').map((l) => { const [name, grams, kcal, cat] = l.split('|'); return { name, grams: +grams, kcal: +kcal, cat }; });

const SNACKISH = ['간식', '음료', '디저트'];
const foodNorm = (t) => t.toLowerCase().replace(/\s+/g, '');
let customFoods = [], IS_ADMIN = false, MY_UID = null, pendingFoodCount = 0;
const FOOD_CATS = ['식사', '외식', '간식', '음료', '디저트'];
// base list + approved foods + my own pending submissions
function allFoods(approvedOnly) {
  const names = new Set(FOODS.map((f) => f.name));
  const extra = customFoods.filter((f) => !names.has(f.name) && (f.status === 'approved' || (!approvedOnly && f.user_id === MY_UID)))
    .map((f) => ({ name: f.name + (f.status === 'pending' ? ' (승인 대기)' : ''), grams: Number(f.grams) || 0, kcal: Number(f.kcal), cat: f.cat }));
  return [...FOODS, ...extra];
}
function foodSearchHtml() {
  return `<div class="fs"><input class="in fs-in" placeholder="🔍 음식 검색 (예: 파스타, 라떼, 치킨)">
    <div class="seg fs-mult">${[0.5, 1, 1.5, 2].map((m) => `<button type="button" data-m="${m}"${m === 1 ? ' class="on"' : ''}>${m === 1 ? '1인분' : m + '배'}</button>`).join('')}</div>
    <div class="fs-res favpanel"></div>
    <button type="button" class="fs-addlink">+ 목록에 없는 음식 추가하기</button>
    <div class="fs-add" hidden>
      <input class="in fa-name" maxlength="40" placeholder="음식 이름 (예: 텐텐 1개)">
      <div class="two" style="margin-top:8px"><label class="unit-in"><input class="fa-g" type="number" inputmode="decimal" placeholder="0"><span>g</span></label><label class="unit-in"><input class="fa-k" type="number" inputmode="numeric" placeholder="0"><span>kcal</span></label></div>
      <div class="seg scroll fa-cat" style="margin-top:8px">${FOOD_CATS.map((c, i) => `<button type="button" data-c="${c}"${i === 2 ? ' class="on"' : ''}>${c}</button>`).join('')}</div>
      <p class="desc small" style="margin:4px 0 8px">1회 먹는 양(낱개면 1개) 기준으로 적어요. 관리자가 승인하면 모든 사용자의 검색에 보여요. 승인 전에는 나만 볼 수 있어요.</p>
      <button type="button" class="btn fa-submit">목록에 추가</button><div class="err fa-err"></div>
    </div></div>`;
}
function wireFoodSearch(root, onPick) {
  const inp = root.querySelector('.fs-in'), res = root.querySelector('.fs-res'); let mult = 1, ALL = allFoods();
  const draw = () => {
    ALL = allFoods();
    const q = foodNorm(inp.value); if (!q) { res.innerHTML = ''; return; }
    const hit = ALL.map((f, i) => [f, i, foodNorm(f.name).indexOf(q)]).filter((x) => x[2] >= 0).sort((a, b) => a[2] - b[2]).slice(0, 10);
    res.innerHTML = hit.length ? hit.map(([f, i]) => `<button type="button" class="favchip" data-i="${i}">${esc(f.name)} · ${Math.round(f.kcal * mult)}kcal</button>`).join('')
      : '<div class="empty" style="padding:6px 0">목록에 없어요. 아래 「목록에 없는 음식 추가하기」로 추가하거나 직접 적어주세요.</div>';
  };
  inp.oninput = draw;
  root.querySelector('.fs-mult').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return; mult = Number(b.dataset.m);
    root.querySelectorAll('.fs-mult button').forEach((x) => x.classList.toggle('on', x === b)); draw();
  };
  res.onclick = (e) => {
    const c = e.target.closest('.favchip'); if (!c) return; const f = ALL[c.dataset.i];
    onPick({ name: f.name, grams: Math.round(f.grams * mult), kcal: Math.round(f.kcal * mult), cat: f.cat });
    inp.value = ''; res.innerHTML = '';
  };
  // let users add foods that are missing from the list (visible to everyone after admin approval)
  const panel = root.querySelector('.fs-add'), fe = root.querySelector('.fa-err'); let cat = '간식';
  root.querySelector('.fs-addlink').onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) { root.querySelector('.fa-name').value = inp.value.trim(); root.querySelector('.fa-name').focus(); } };
  root.querySelector('.fa-cat').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; cat = b.dataset.c; root.querySelectorAll('.fa-cat button').forEach((x) => x.classList.toggle('on', x === b)); };
  root.querySelector('.fa-submit').onclick = async () => {
    const name = root.querySelector('.fa-name').value.trim(), kc = num(root.querySelector('.fa-k').value), g = num(root.querySelector('.fa-g').value);
    if (!name) { fe.textContent = '음식 이름을 입력해 주세요.'; return; }
    if (kc == null || kc < 0 || kc > 3000) { fe.textContent = 'kcal를 0~3000 사이로 입력해 주세요.'; return; }
    try {
      let row = await store.foods.add({ name, grams: g, kcal: kc, cat });
      if (IS_ADMIN && row?.id && row.status !== 'approved') { await store.foods.review(row.id, 'approved'); row = { ...row, status: 'approved' }; }
      customFoods.push(row); fe.textContent = ''; panel.hidden = true;
      ['.fa-name', '.fa-g', '.fa-k'].forEach((c) => (root.querySelector(c).value = ''));
      inp.value = name; draw();
      res.insertAdjacentHTML('afterbegin', `<div class="desc small" style="color:var(--blue);margin-bottom:6px">추가했어요${row.status === 'approved' ? '' : ' · 승인되면 모두에게 보여요'}</div>`);
    } catch (e) { fe.textContent = authMsg(e); }
  };
}
function addFoodRow(box, v) {
  const rows = box.querySelectorAll('.mealrow'), last = rows[rows.length - 1];
  if (last && !last.querySelector('.f-name').value.trim()) last.outerHTML = mealRowEdit(v); else box.insertAdjacentHTML('beforeend', mealRowEdit(v));
}
function altFoods(item) {
  const k = item.kcal || 200, snack = item.type === '간식' || item.type === '야식';
  return allFoods(true).filter((f) => (snack ? SNACKISH.includes(f.cat) : ['식사', '외식'].includes(f.cat)) && f.name !== item.name && Math.abs(f.kcal - k) <= Math.max(60, k * 0.25))
    .sort((a, b) => Math.abs(a.kcal - k) - Math.abs(b.kcal - k)).slice(0, 8);
}
function mealRowEdit(v = {}, opts = {}) {
  const on = v.name && isFavorite(v.name);
  const star = opts.star === false ? '' : `<button type="button" class="favstar${on ? ' on' : ''}" title="즐겨찾기에 저장">${on ? '★' : '☆'}</button>`;
  return `<div class="mealrow" data-plan="${v.plan ? 1 : ''}" ${stAttrs(v)}>
    <div class="mealrow-top">
      <select class="in sel-type">${MEAL_TYPES.map((t) => `<option${v.type === t ? ' selected' : ''}>${t}</option>`).join('')}</select>
      <input class="in f-name" placeholder="음식명" value="${esc(v.name ?? '')}">
      ${star}<button type="button" class="rm" aria-label="삭제">✕</button>
    </div>
    <div class="mealrow-bottom">
      <label class="unit-in"><input class="f-g" type="number" inputmode="decimal" placeholder="0" value="${v.grams ?? ''}"><span>g</span></label>
      <label class="unit-in"><input class="f-kcal" type="number" inputmode="numeric" placeholder="0" value="${v.kcal ?? ''}"><span>kcal</span></label>
    </div>
  </div>`;
}
function readMealRows(box) {
  return [...box.querySelectorAll('.mealrow')].map((row) => ({
    type: row.querySelector('.sel-type').value,
    name: row.querySelector('.f-name').value.trim(),
    grams: row.querySelector('.f-g').value === '' ? null : Number(row.querySelector('.f-g').value),
    kcal: row.querySelector('.f-kcal').value === '' ? null : Number(row.querySelector('.f-kcal').value),
    ...(row.dataset.plan ? { plan: true } : {}),
    ...(row.dataset.st ? { st: row.dataset.st, done: row.dataset.st === 'done' } : {}),
    ...(row.dataset.actual ? { actual: JSON.parse(decodeURIComponent(row.dataset.actual)) } : {}),
  })).filter((o) => o.name);
}
async function addFavorite(item) {
  const i = favorites.findIndex((f) => f.name === item.name);
  if (i >= 0) favorites[i] = { ...item, category: favorites[i].category || item.category }; else favorites.push({ category: '식사', ...item });
  await store.favorites.save(favorites);
}
function wireMealRows(box) {
  box.onclick = async (e) => {
    if (e.target.classList.contains('rm')) { e.target.closest('.mealrow').remove(); return; }
    if (e.target.classList.contains('favstar')) {
      const row = e.target.closest('.mealrow');
      const item = {
        name: row.querySelector('.f-name').value.trim(),
        grams: row.querySelector('.f-g').value === '' ? null : Number(row.querySelector('.f-g').value),
        kcal: row.querySelector('.f-kcal').value === '' ? null : Number(row.querySelector('.f-kcal').value),
      };
      if (!item.name) return;
      const type = row.querySelector('.sel-type')?.value;
      item.category = type === '간식' || type === '야식' ? '간식' : '식사';
      await addFavorite(item);
      e.target.textContent = '★'; e.target.classList.add('on');
    }
  };
  return () => box.insertAdjacentHTML('beforeend', mealRowEdit());
}
const FAV_CATS = ['식사', '간식', '음료', '디저트', '기타'];
const favCat = (f) => (FAV_CATS.includes(f.category) ? f.category : '기타');
function favChipsHtml() {
  if (!favorites.length) return '<div class="empty" style="padding:6px 0">저장된 즐겨찾기가 없어요</div>';
  return FAV_CATS.map((c) => {
    const items = favorites.map((f, i) => [f, i]).filter(([f]) => favCat(f) === c);
    return items.length ? `<div class="favcat">${c}</div>` + items.map(([f, i]) => `<button type="button" class="favchip" data-fav="${i}">${esc(f.name)}${f.kcal != null ? ` · ${f.kcal}kcal` : ''}</button>`).join('') : '';
  }).join('');
}
function wireFavPanel(toggleBtn, panelEl, mealsBox) {
  toggleBtn.onclick = () => { panelEl.hidden = !panelEl.hidden; };
  panelEl.onclick = (e) => {
    const c = e.target.closest('.favchip'); if (!c) return;
    mealsBox.insertAdjacentHTML('beforeend', mealRowEdit(favorites[c.dataset.fav]));
  };
}
/* favorites management: name + grams/kcal only, no meal-type */
function favRowEdit(v = {}) {
  return `<div class="mealrow">
    <div class="mealrow-top">
      <select class="in sel-fcat">${FAV_CATS.map((c) => `<option${favCat(v) === c ? ' selected' : ''}>${c}</option>`).join('')}</select>
      <input class="in f-name" placeholder="음식명" value="${esc(v.name ?? '')}"><span></span>
      <button type="button" class="rm" aria-label="삭제">✕</button>
    </div>
    <div class="mealrow-bottom">
      <label class="unit-in"><input class="f-g" type="number" inputmode="decimal" placeholder="0" value="${v.grams ?? ''}"><span>g</span></label>
      <label class="unit-in"><input class="f-kcal" type="number" inputmode="numeric" placeholder="0" value="${v.kcal ?? ''}"><span>kcal</span></label>
    </div>
  </div>`;
}
function readFavRows(box) {
  return [...box.querySelectorAll('.mealrow')].map((row) => ({
    name: row.querySelector('.f-name').value.trim(),
    category: row.querySelector('.sel-fcat').value,
    grams: row.querySelector('.f-g').value === '' ? null : Number(row.querySelector('.f-g').value),
    kcal: row.querySelector('.f-kcal').value === '' ? null : Number(row.querySelector('.f-kcal').value),
  })).filter((o) => o.name);
}

// rough MET-based estimate (kcal) used when an exercise's calorie burn isn't given
const EX_RATE = [[/걷기|산책/, 4], [/달리기|러닝|조깅/, 10], [/자전거|싸이클/, 8], [/수영/, 9], [/요가|스트레칭|필라테스/, 3], [/헬스|웨이트|근력|웨이트트레이닝/, 6], [/등산/, 8]];
function estimateExerciseKcal(name, duration) {
  if (!duration) return null;
  const hit = EX_RATE.find(([re]) => re.test(name || ''));
  const rate = hit ? hit[1] : 5;
  return Math.round(rate * duration);
}
/* record sheet: view mode by default, 편집 switches to edit mode */
function ibMini(ib) {
  if (!ib) return '';
  const c = ibCalc(ib);
  const cell = (l, v, d, u) => `<div class="ib-cell"><small>${l}</small><b>${ibFmt(v, d)}<span class="u">${u}</span></b></div>`;
  return `<label class="f">인바디</label><div class="ib-grid">${cell('체지방률', c.fat_pct, 1, '%')}${cell('골격근량', c.smm, 2, 'kg')}${cell('기초대사량', c.bmr, 0, 'kcal')}</div>`;
}
function openRecordSheet(date) {
  if (READONLY) { if (cache[date]) renderView(date); return; }
  if (cache[date]) renderView(date); else renderEdit(date);
}
function renderView(date) {
  const r = cache[date] || {};
  openSheet(`
  <div class="sheet-head"><h2>${dateLabel(date)} 기록</h2><button class="edit-link" id="toEdit">편집</button></div>
  <div class="two"><div class="stat"><small>몸무게</small><b>${r.weight != null ? Number(r.weight).toFixed(2) + ' kg' : '–'}</b></div><div class="stat"><small>걸음 수</small><b>${r.steps ?? '–'}</b></div></div>
  <div class="two" style="margin-top:10px"><div class="stat"><small>섭취</small><b>${kcal(r.calories_consumed)}</b></div><div class="stat"><small>소모</small><b>${kcal(r.calories_burned)}</b></div></div>
  ${ibMini(r.inbody)}<label class="f">식사</label>${mealGroupsHtml(r.meals)}
  <label class="f">운동</label>${(r.exercises || []).map((e) => exRowView(e)).join('') || '<div class="empty">기록된 운동이 없어요</div>'}`);
  $('#toEdit').onclick = () => renderEdit(date);
}
function renderEdit(date) {
  const r = cache[date] || {};
  openSheet(`<div class="sheet-head"><h2>${dateLabel(date)} 기록</h2><button class="edit-link" id="headSave">저장</button></div>
  <div class="two"><div><label class="f">몸무게 (kg)</label><input class="in" id="f-weight" type="number" step="0.01" inputmode="decimal" value="${r.weight ?? ''}"></div>
  <div><label class="f">걸음 수</label><input class="in" id="f-steps" type="number" inputmode="numeric" value="${r.steps ?? ''}"></div>
  <div><label class="f">섭취 칼로리</label><input class="in" id="f-in" type="number" inputmode="numeric" placeholder="식단 합계 자동" value="${r.calories_consumed ?? ''}"></div>
  <div><label class="f">소모 칼로리 (Apple Watch)</label><input class="in" id="f-out" type="number" inputmode="numeric" value="${r.calories_burned ?? ''}"></div></div>
  <label class="f">식사</label><div id="meals">${(r.meals || []).map((m) => mealRowEdit(m)).join('')}</div>
  <div class="favrow"><button class="add" id="addMeal">+ 식사 추가</button><button class="add" id="favToggle">☆ 즐겨찾기에서 추가</button></div>
  <div class="favpanel" id="favPanel" hidden>${favChipsHtml()}</div>
  <label class="f">운동</label><div id="exs">${(r.exercises || []).map((e) => exRowEdit(e, { collapsed: true })).join('')}</div><button class="add" id="addEx">+ 운동 추가</button>
  <div class="err" id="err"></div>
  <button class="btn" id="save">저장</button>${cache[date] ? '<button class="btn danger" id="del">기록 삭제</button>' : ''}`);
  $('#addMeal').onclick = wireMealRows($('#meals'));
  wireFavPanel($('#favToggle'), $('#favPanel'), $('#meals'));
  $('#addEx').onclick = () => $('#exs').insertAdjacentHTML('beforeend', exRowEdit({ category: '유산소' }));
  wireExRows($('#exs'));
  const doSave = async () => {
    const meals = readMealRows($('#meals'));
    const exercises = readExRows($('#exs')).map(({ done, ...e }) => e);
    const w = num($('#f-weight').value);
    const rec = {
      date, weight: w == null ? null : Math.round(w * 100) / 100, steps: num($('#f-steps').value),
      calories_consumed: num($('#f-in').value) ?? (meals.length ? meals.reduce((a, m) => a + (m.kcal || 0), 0) : null),
      calories_burned: num($('#f-out').value), meals, exercises,
    };
    try { await store.save(rec); closeSheet(); await refresh(); } catch (e) { $('#err').textContent = authMsg(e); }
  };
  $('#save').onclick = doSave;
  $('#headSave').onclick = doSave;
  if ($('#del')) $('#del').onclick = async () => { if (confirm('이 날의 기록을 삭제할까요?')) { await store.remove(date); closeSheet(); await refresh(); } };
}

/* date-picker sheet (jump to any date): generic, used by 기록 tab and 계획 tab */
let pickerMonth = null, pickerSelected = null, pickerOnPick = null;
function openDatePicker(initial, onPick) {
  pickerMonth = new Date(initial.slice(0, 7) + '-01T00:00:00');
  pickerSelected = initial;
  pickerOnPick = onPick;
  renderPicker();
}
function renderPicker() {
  const y = pickerMonth.getFullYear(), m = pickerMonth.getMonth();
  const lead = new Date(y, m, 1).getDay(), dim = new Date(y, m + 1, 0).getDate();
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<div class="day out"></div>';
  for (let d = 1; d <= dim; d++) {
    const date = `${y}-${pad(m + 1)}-${pad(d)}`;
    cells += `<button class="day${date === pickerSelected ? ' sel' : ''}${date === today ? ' today' : ''}" data-pick="${date}">${cache[date]?.inbody ? '<i class="ibmark">IN</i>' : ''}<span class="n">${d}</span></button>`;
  }
  openSheet(`<div class="sheet-head"><h2>날짜 선택</h2></div>
    <div class="cal-head"><button id="pPrev">‹</button><b>${y}년 ${m + 1}월</b><button id="pNext">›</button></div>
    <div class="dow">${'일월화수목금토'.split('').map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="days">${cells}</div>`);
  $('#pPrev').onclick = () => { pickerMonth = new Date(y, m - 1, 1); renderPicker(); };
  $('#pNext').onclick = () => { pickerMonth = new Date(y, m + 1, 1); renderPicker(); };
  sheet.querySelectorAll('[data-pick]').forEach((b) => { b.onclick = () => { closeSheet(); pickerOnPick(b.dataset.pick); }; });
}

async function editPlanMeals() {
  const rows = (planData.meals || []).map((x) => mealRowEdit(x)).join('');
  openSheet(`<div class="sheet-head"><h2>${dateLabel(planDate)} 식단 계획</h2></div>${foodSearchHtml()}<div id="rows">${rows}</div>
  <div class="favrow"><button class="add" id="add">+ 추가</button><button class="add" id="favToggle">☆ 즐겨찾기에서 추가</button></div>
  <div class="favpanel" id="favPanel" hidden>${favChipsHtml()}</div>
  <div class="err" id="err"></div><button class="btn" id="save">저장</button>`);
  $('#add').onclick = wireMealRows($('#rows'));
  wireFavPanel($('#favToggle'), $('#favPanel'), $('#rows'));
  wireFoodSearch(sheet.querySelector('.fs'), (f) => addFoodRow($('#rows'), { type: SNACKISH.includes(f.cat) ? '간식' : '점심', name: f.name, grams: f.grams, kcal: f.kcal }));
  $('#save').onclick = async () => {
    try {
      const old = planData.meals || [];
      const meals = readMealRows($('#rows')).map((m) => {
        const o = old.find((x) => x.name === m.name && x.type === m.type);
        return o ? { ...m, ...(o.st ? { st: o.st } : {}), ...(o.actual ? { actual: o.actual } : {}), done: !!o.done } : m;
      });
      await store.meals.save(planDate, meals); closeSheet(); await refreshPlan();
    } catch (e) { $('#err').textContent = authMsg(e); }
  };
}
function editFavorites() { renderFavoritesView(); }
let favFilter = null;
function renderFavoritesView(only = favFilter) {
  favFilter = only;
  const cats = only ? [only] : FAV_CATS;
  const rows = cats.map((c) => {
    const items = favorites.filter((f) => favCat(f) === c);
    return items.length ? `<div class="mg-label">${c} · ${items.length}</div>` + items.map((f) => `<div class="li"><div>${esc(f.name)}${f.grams ? `<span class="g">${f.grams}g</span>` : ''}</div><b class="kcal">${f.kcal ?? '–'} kcal</b></div>`).join('') : '';
  }).join('') || '<div class="empty">저장된 음식이 없어요</div>';
  const tabsHtml = `<div class="seg fav-seg"><button class="${only ? '' : 'on'}" data-fcat="">전체</button>${FAV_CATS.map((c) => `<button class="${only === c ? 'on' : ''}" data-fcat="${c}">${c}</button>`).join('')}</div>`;
  openSheet(`<div class="sheet-head"><h2>자주 먹는 음식</h2><button class="edit-link" id="toEditFav">편집</button></div>${tabsHtml}${rows}`);
  sheet.querySelectorAll('[data-fcat]').forEach((b) => { b.onclick = () => renderFavoritesView(b.dataset.fcat || null); });
  $('#toEditFav').onclick = () => renderFavoritesEdit();
}
function renderFavoritesEdit() {
  const rows = favorites.map((x) => favRowEdit(x)).join('');
  openSheet(`<div class="sheet-head"><h2>자주 먹는 음식 편집</h2><button class="edit-link" id="headSaveFav">저장</button></div><p class="desc small">분류를 바꾸려면 왼쪽 칸을 눌러 고르세요.</p><div id="rows">${rows}</div><button class="add" id="add">+ 추가</button><div class="err" id="err"></div><button class="btn" id="save">저장</button>`);
  $('#add').onclick = () => $('#rows').insertAdjacentHTML('beforeend', favRowEdit({ category: favFilter || '식사' }));
  $('#rows').onclick = (e) => { if (e.target.classList.contains('rm')) e.target.closest('.mealrow').remove(); };
  const doSave = async () => {
    try { favorites = readFavRows($('#rows')); await store.favorites.save(favorites); renderFavoritesView(); render(); } catch (e) { $('#err').textContent = authMsg(e); }
  };
  $('#save').onclick = doSave;
  $('#headSaveFav').onclick = doSave;
}
const stAttrs = (v) => `data-st="${v.st || ''}" data-actual="${v.actual ? encodeURIComponent(JSON.stringify(v.actual)) : ''}"`; // keep check-off state when a plan is edited
function exRowEdit(v = {}, o = {}) {
  const ci = EX_CATS.indexOf(v.category);
  return `<div class="mealrow exrow${o.collapsed ? ' collapsed' : ''}" data-done="${v.done ? 1 : ''}" data-plan="${v.plan ? 1 : ''}" data-feel="${v.feel || ''}" ${stAttrs(v)}>
    <div class="exsum"><button type="button" class="drag" aria-label="순서 바꾸기">≡</button>
      <button type="button" class="exopen"><span class="tag t-${ci}">${esc(v.category || '')}</span><b>${esc(v.name || '')}</b><small>${esc(exDetail(v))}</small><i>▾</i></button>
      <button type="button" class="rm" aria-label="삭제">✕</button></div>
    <div class="exfull">
      <div class="mealrow-top exhead"><button type="button" class="drag" aria-label="순서 바꾸기">≡</button>
        <select class="in sel-cat">${EX_CATS.map((c) => `<option${v.category === c ? ' selected' : ''}>${c}</option>`).join('')}</select>
        <input class="in f-name" placeholder="운동명" value="${esc(v.name ?? '')}"><button type="button" class="exfold" aria-label="접기">▴</button><button type="button" class="rm" aria-label="삭제">✕</button></div>
      <div class="mealrow-bottom four">
        <label class="unit-in"><input class="f-min" type="number" inputmode="numeric" placeholder="0" value="${v.duration ?? ''}"><span>분</span></label>
        <label class="unit-in"><input class="f-sets" type="number" inputmode="numeric" placeholder="0" value="${v.sets ?? ''}"><span>세트</span></label>
        <label class="unit-in"><input class="f-w" type="number" step="0.5" inputmode="decimal" placeholder="0" value="${v.weight ?? ''}"><span>kg</span></label>
        <label class="unit-in"><input class="f-kcal" type="number" inputmode="numeric" placeholder="자동" value="${v.kcal ?? ''}"><span>kcal</span></label>
      </div>
      <div class="exrow2"><input class="in f-reps" placeholder="횟수 (12회)" value="${esc(v.reps ?? '')}">
        <textarea class="in f-notes" rows="3" placeholder="메모 (자세, 속도, 느낌 등)">${esc(v.notes ?? '')}</textarea></div>
    </div>
  </div>`;
}
function readExRow(row) {
  const q = (c) => row.querySelector(c).value.trim();
  const name = q('.f-name'), duration = num(q('.f-min')), sets = num(q('.f-sets'));
  const e = { category: q('.sel-cat'), name, duration, sets, reps: q('.f-reps') || null, kcal: num(q('.f-kcal')), notes: q('.f-notes') || null, ...(num(q('.f-w')) ? { weight: num(q('.f-w')) } : {}), ...(row.dataset.feel ? { feel: row.dataset.feel } : {}), done: !!row.dataset.done, ...(row.dataset.plan ? { plan: true } : {}),
    ...(row.dataset.st ? { st: row.dataset.st } : {}), ...(row.dataset.actual ? { actual: JSON.parse(decodeURIComponent(row.dataset.actual)) } : {}) };
  if (e.kcal == null) e.kcal = estimateExerciseKcal(name, duration || (sets ? sets * 2 : null)) ?? (e.category === '근력' && sets ? sets * 8 : null);
  return e;
}
const readExRows = (box) => [...box.querySelectorAll('.exrow')].map(readExRow).filter((e) => e.name);
// fold / unfold rows, delete, and drag-to-reorder (grab the ≡ handle)
function wireExRows(box) {
  box.onclick = (e) => {
    const row = e.target.closest('.exrow'); if (!row) return;
    if (e.target.closest('.rm')) return row.remove();
    if (e.target.closest('.exopen')) return row.classList.remove('collapsed');
    if (e.target.closest('.exfold')) {
      const v = readExRow(row), sum = row.querySelector('.exopen');
      sum.querySelector('.tag').textContent = v.category; sum.querySelector('.tag').className = `tag t-${EX_CATS.indexOf(v.category)}`;
      sum.querySelector('b').textContent = v.name || '(이름 없음)'; sum.querySelector('small').textContent = exDetail(v);
      row.classList.add('collapsed');
    }
  };
  box.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.drag'); if (!h) return;
    const row = h.closest('.exrow'); e.preventDefault(); row.classList.add('dragging');
    const move = (ev) => {
      const rect = sheet.getBoundingClientRect();
      if (ev.clientY < rect.top + 70) sheet.scrollTop -= 10; else if (ev.clientY > rect.bottom - 70) sheet.scrollTop += 10;
      let before = null;
      for (const r of box.querySelectorAll('.exrow')) { if (r === row) continue; const b = r.getBoundingClientRect(); if (ev.clientY < b.top + b.height / 2) { before = r; break; } }
      box.insertBefore(row, before);
    };
    const up = () => { row.classList.remove('dragging'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  });
}
async function editPlanExercises() {
  const rows = (planData.exercises || []).map((x) => exRowEdit(x, { collapsed: true })).join('');
  openSheet(`<div class="sheet-head"><h2>${dateLabel(planDate)} 운동 계획</h2></div><p class="desc small">탭하면 펼쳐져요 · ≡를 잡고 끌어서 순서를 바꿔요.</p><div id="rows">${rows}</div><button class="add" id="add">+ 추가</button><div class="err" id="err"></div><button class="btn" id="save">저장</button>`);
  $('#add').onclick = () => $('#rows').insertAdjacentHTML('beforeend', exRowEdit({ category: '유산소' }));
  wireExRows($('#rows'));
  $('#save').onclick = async () => {
    try {
      const exercises = readExRows($('#rows'));
      await store.exercises.save(planDate, exercises); closeSheet(); await refreshPlan();
    } catch (e) { $('#err').textContent = authMsg(e); }
  };
}

/* ---------------- swipe between weeks on 기록 탭 ---------------- */
function wireWeekSwipe(el) {
  if (!el) return;
  let x0 = null, y0 = null;
  el.addEventListener('touchstart', (e) => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      if (el.dataset.week === 'data-mealdate') setMealDate(addDays(mealDate, dx < 0 ? 7 : -7));
      else { recordDate = addDays(recordDate, dx < 0 ? 7 : -7); render(); }
    }
    x0 = y0 = null;
  }, { passive: true });
}

/* ---------------- wiring ---------------- */
let weekStats = null;
async function loadWeekStats(date) {
  let aer = 0, aerDone = 0, str = 0, strDone = 0, days = 0;
  for (const d of weekDates(date)) {
    const ex = d === date ? planData.exercises : await store.exercises.get(d);
    if (!ex.length) continue; days++;
    const cardio = ex.filter((e) => e.category === '유산소'), st = ex.filter((e) => e.category === '근력');
    aer += cardio.reduce((a, e) => a + (e.duration || 0), 0);
    aerDone += cardio.reduce((a, e) => a + (actualOf(e, 'exercises')?.duration || 0), 0)
      + (cache[d]?.exercises || []).filter((x) => !x.plan && x.category === '유산소').reduce((a, x) => a + (x.duration || 0), 0);
    if (st.length) { str++; if (st.every((e) => ['done', 'swap'].includes(itemStatus(e)))) strDone++; }
  }
  return { aer, aerDone, str, strDone, days };
}
async function refreshPlan() { planData = { meals: await store.meals.get(planDate), exercises: await store.exercises.get(planDate) }; weekStats = await loadWeekStats(planDate); render(); }
async function loadToday() { todayPlan = { meals: await store.meals.get(today), exercises: await store.exercises.get(today) }; if (mealDate === today) dayPlan = todayPlan; }
async function loadDay() { dayPlan = mealDate === today ? todayPlan : { meals: await store.meals.get(mealDate), exercises: await store.exercises.get(mealDate) }; }
async function setMealDate(d) { mealDate = d; await loadDay(); render(); }
async function refresh() { await loadAll(); await loadToday(); if (tab === 'plan') { planData = { meals: await store.meals.get(planDate), exercises: await store.exercises.get(planDate) }; weekStats = await loadWeekStats(planDate); } if (tab === 'meals') await loadDay(); render(); }
function render() {
  const v = $('#view');
  v.innerHTML = { home: viewHome, meals: viewMeals, record: viewRecord, stats: viewStats, plan: viewPlan, settings: viewSettings }[tab]();
  $('#title').textContent = { home: '오늘', meals: '체크', record: '기록', stats: '통계', plan: '계획', settings: '설정' }[tab];
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  if (tab === 'record' || tab === 'meals') wireWeekSwipe($('.weekbar'));
}
$('#view').addEventListener('click', (e) => {
  const fav = e.target.closest('.favmini'); if (fav) return favMiniClick(fav);
  const ck = e.target.closest('[data-check]');
  if (ck && READONLY) return;
  if (ck) { const [kind, i] = ck.dataset.check.split(':'); return togglePlanItem(kind, Number(i)); }
  const more = e.target.closest('[data-more]');
  if (more) { if (READONLY) return; const [kind, i] = more.dataset.more.split(':'); return openStatusSheet(kind, Number(i)); }
  const xd = e.target.closest('[data-exdate]');
  if (xd) return openExerciseSheet(xd.dataset.exdate);
  const fd = e.target.closest('[data-fooddate]');
  if (fd) return openFoodSheet(fd.dataset.fooddate);
  const ibd = e.target.closest('[data-ibdate]');
  if (ibd) { if (READONLY && !cache[ibd.dataset.ibdate]?.inbody) return; if (READONLY) { recordDate = ibd.dataset.ibdate; tab = 'record'; return render(); } return openInbodySheet(ibd.dataset.ibdate); }
  const ibm = e.target.closest('[data-ibmetric]');
  if (ibm) { ibMetric = ibm.dataset.ibmetric; return render(); }
  if (e.target.closest('#heightBtn')) return setHeightSheet();
  const fc = e.target.closest('[data-favcat]');
  if (fc) return renderFavoritesView(fc.dataset.favcat);
  const gy = e.target.closest('[data-gym]');
  if (gy) { useGym = gy.dataset.gym === '1'; try { localStorage.setItem('diet.gym', useGym ? '1' : '0'); } catch {} saveProfilePatch({ place: useGym ? 'gym' : 'home' }); return render(); }
  const bk = e.target.closest('[data-back]');
  if (bk) { BACK = bk.dataset.back === '1'; saveProfilePatch({ back: BACK }); return render(); }
  const lv = e.target.closest('[data-level]');
  if (lv) { const mon = new Date(today + 'T00:00:00'); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7) - 7 * { new: 0, some: 1, steady: 2 }[lv.dataset.level]); PROGRAM_START = mon.toLocaleDateString('sv'); saveProfilePatch({ level: lv.dataset.level, program_start: PROGRAM_START }); return render(); }
  const go = e.target.closest('[data-gotab]');
  if (go) { tab = go.dataset.gotab; mealDate = today; return loadDay().then(render); }
  const md = e.target.closest('[data-mealdate]');
  if (md) return setMealDate(md.dataset.mealdate);
  if (e.target.closest('#openMealCal')) return openDatePicker(mealDate, setMealDate);
  if (e.target.closest('#genDay')) return generatePlan(mealDate).then(async () => { if (mealDate === today) await loadToday(); await loadDay(); render(); });
  if (e.target.closest('#quickWeight')) return openWeightSheet();
  if (e.target.closest('#genToday')) return generatePlan(today).then(refresh);
  const sk = e.target.closest('[data-skipmeal]'); if (sk) return setMealSkip(sk.dataset.skipmeal);
  const sw = e.target.closest('[data-swapmeal]'); if (sw) return openMealSwapSheet(sw.dataset.swapmeal);
  const ex = e.target.closest('[data-expand]'); if (ex) { const k = ex.dataset.expand; if (openMeals.has(k)) openMeals.delete(k); else openMeals.add(k); return render(); }
  const t = e.target.closest('[data-date],#prev,#next,[data-metric],[data-plan],[data-recdate],#openCal,#doLogout,#planDateBtn,#startDateBtn,#favManageBtn,[data-recedit]'); if (!t) return;
  if (t.id === 'doLogout') return store.sb.auth.signOut().then(() => location.reload());
  if (t.id === 'openCal') return openDatePicker(recordDate, (d) => { recordDate = d; render(); });
  if (t.id === 'planDateBtn') return openDatePicker(planDate, async (d) => { planDate = d; await refreshPlan(); });
  if (t.id === 'startDateBtn') return openDatePicker(START, async (d) => { await setStartDate(d); });
  if (t.id === 'favManageBtn') { favFilter = null; return editFavorites(); }
  if (t.dataset.recedit) return renderEdit(t.dataset.recedit);
  if (t.dataset.recdate) { recordDate = t.dataset.recdate; render(); return; }
  if (t.dataset.date) openRecordSheet(t.dataset.date);
  else if (t.id === 'prev' || t.id === 'next') { month = new Date(month.getFullYear(), month.getMonth() + (t.id === 'next' ? 1 : -1), 1); render(); }
  else if (t.dataset.metric) { metric = t.dataset.metric; render(); }
  else if (t.dataset.plan === 'meals') editPlanMeals();
  else if (t.dataset.plan === 'exercises') editPlanExercises();
  else if (t.dataset.plan === 'gen') { if ((planData.meals.length || planData.exercises.length) && !confirm('체크하거나 기록한 항목은 그대로 두고, 나머지만 추천 플랜으로 바꿀까요?')) return; generatePlan(planDate).then(refreshPlan).then(loadToday); }
  else if (t.dataset.plan === 'genweek') {
    if (!confirm('오늘부터 7일 계획을 추천 플랜으로 채울까요? (이미 있는 날은 건너뛰어요)')) return;
    (async () => { for (let i = 0; i < 7; i++) { const d = addDays(today, i); if (!(await store.meals.get(d)).length) await generatePlan(d); } await loadToday(); await refreshPlan(); })();
  }
});
document.addEventListener('change', async (e) => {
  const inp = e.target.closest?.('.act-in'); if (!inp) return;
  const row = inp.closest('[data-actdate]'), date = row.dataset.actdate, r = cache[date] || {}, ok = row.querySelector('.act-ok');
  const val = (f) => num(row.querySelector(`[data-f="${f}"]`).value);
  const rec = { date, weight: r.weight ?? null, steps: val('steps'), calories_consumed: r.calories_consumed ?? null, calories_burned: calcBurn({ ...r, steps: val('steps') }), meals: r.meals || [], exercises: r.exercises || [] };
  try { await store.save(rec); cache[date] = { ...r, ...rec }; const bv = row.querySelector('.burn-val'); if (bv) bv.textContent = rec.calories_burned != null ? '≈ ' + rec.calories_burned.toLocaleString() : '–'; ok.textContent = '저장됨 ✓'; ok.className = 'act-ok on'; setTimeout(() => { ok.textContent = ''; }, 1500); }
  catch (er) { ok.textContent = authMsg(er); ok.className = 'act-ok err'; }
});
document.querySelector('.tabs').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  tab = b.dataset.tab;
  if (tab === 'plan') await refreshPlan(); else if (tab === 'meals') { await loadDay(); render(); } else render();
});

// password reset by emailed 6-digit code (needs {{ .Token }} in Supabase's "Reset password" email template)
function showReset(sb, email0 = '') {
  const box = $('#login'); box.hidden = false;
  box.innerHTML = `<div class="card"><h2 style="margin-bottom:6px">비밀번호 재설정</h2><div class="eyebrow">가입한 이메일로 인증 코드를 보내드려요</div>
    <input class="in" id="em" type="email" placeholder="이메일" value="${esc(email0)}" autocomplete="username">
    <div class="err" id="lerr"></div><button class="btn" id="send">인증 코드 받기</button><button class="btn ghost" id="back">로그인으로 돌아가기</button></div>`;
  $('#back').onclick = () => showLogin(sb);
  $('#send').onclick = async () => {
    const email = $('#em').value.trim(); if (!email) return;
    const { error } = await sb.auth.resetPasswordForEmail(email);
    if (error) { $('#lerr').textContent = authMsg(error); return; }
    box.innerHTML = `<div class="card"><h2 style="margin-bottom:6px">새 비밀번호 설정</h2><div class="eyebrow">${esc(email)}로 보낸 메일의 인증 코드를 입력하세요</div>
      <input class="in" id="code" inputmode="numeric" autocomplete="one-time-code" placeholder="인증 코드">
      <input class="in" id="np" type="password" placeholder="새 비밀번호 (6자 이상)" autocomplete="new-password">
      <div class="err" id="lerr"></div><button class="btn" id="setpw">비밀번호 바꾸기</button><button class="btn ghost" id="back">취소</button></div>`;
    $('#back').onclick = () => showLogin(sb);
    $('#setpw').onclick = async () => {
      const np = $('#np').value; if (np.length < 6) { $('#lerr').textContent = '비밀번호는 6자 이상이에요.'; return; }
      const v = await sb.auth.verifyOtp({ email, token: $('#code').value.trim(), type: 'recovery' });
      if (v.error) { $('#lerr').textContent = '코드가 맞지 않거나 만료됐어요.'; return; }
      const u = await sb.auth.updateUser({ password: np });
      if (u.error) { $('#lerr').textContent = authMsg(u.error); return; }
      location.reload();
    };
  };
}
// Supabase auth errors → Korean
function authMsg(err) {
  if (/[가-힣]/.test(err?.message || '')) return err.message;
  const m = `${err?.code || ''} ${err?.message || ''}`.toLowerCase();
  const T = [
    [/invalid login|invalid_credentials/, '이메일 또는 비밀번호가 맞지 않아요.'],
    [/not confirmed|email_not_confirmed/, '이메일 인증이 아직 안 됐어요. 받은 메일의 링크를 눌러 주세요.'],
    [/already registered|user_already_exists|already been registered/, '이미 가입된 이메일이에요. 로그인해 주세요.'],
    [/at least 6|weak_password|password should be/, '비밀번호는 6자 이상이어야 해요.'],
    [/different from the old|same_password/, '이전과 다른 비밀번호를 입력해 주세요.'],
    [/rate limit|too many|over_.*_rate/, '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.'],
    [/valid email|invalid format|validate email|email_address_invalid/, '이메일 형식이 올바르지 않아요.'],
    [/signup.*disabled|signups not allowed/, '지금은 가입할 수 없어요.'],
    [/otp.*expired|token.*expired|invalid.*token|otp_expired/, '코드가 맞지 않거나 만료됐어요.'],
    [/failed to fetch|network|load failed/, '인터넷 연결을 확인해 주세요.'],
    [/not authenticated|jwt|session/, '로그인이 만료됐어요. 다시 로그인해 주세요.'],
  ];
  return (T.find(([re]) => re.test(m)) || [0, '문제가 생겼어요. 잠시 후 다시 시도해 주세요.'])[1];
}
function showLogin(sb, mode = 'login', keep = {}) {
  const su = mode === 'signup';
  const box = $('#login'); box.hidden = false;
  box.innerHTML = `<div class="card"><h2 style="margin-bottom:6px">${su ? '회원가입' : '로그인'}</h2>
    <div class="eyebrow">${su ? '이메일과 비밀번호를 정해 주세요' : '이메일과 비밀번호로 로그인하세요'}</div>
    <input class="in" id="em" type="email" placeholder="이메일" autocomplete="username" value="${esc(keep.em || '')}">
    <input class="in" id="pw" type="password" placeholder="${su ? '비밀번호 (6자 이상)' : '비밀번호'}" autocomplete="${su ? 'new-password' : 'current-password'}">
    ${su ? '<input class="in" id="pw2" type="password" placeholder="비밀번호 확인" autocomplete="new-password">' : ''}
    <div class="err" id="lerr"></div>
    <button class="btn" id="go">${su ? '가입하기' : '로그인'}</button>
    <button class="link-btn" id="swap" style="text-align:center;width:100%;margin-top:10px">${su ? '이미 계정이 있어요 · 로그인' : '처음이에요 · 회원가입'}</button>
    ${su ? '' : '<button class="link-btn" id="forgot" style="text-align:center;width:100%;margin-top:2px">비밀번호를 잊으셨나요?</button>'}
    ${/^https?:$/.test(location.protocol) ? '<p class="desc small" style="margin:14px 0 0">아이폰: Safari 공유 버튼 → <b>홈 화면에 추가</b>하면 앱처럼 쓸 수 있어요.</p>' : ''}</div>`;
  const err = (t, ok) => { const el = $('#lerr'); el.style.color = ok ? 'var(--blue)' : ''; el.textContent = t; };
  $('#swap').onclick = () => showLogin(sb, su ? 'login' : 'signup', { em: $('#em').value });
  if ($('#forgot')) $('#forgot').onclick = () => showReset(sb, $('#em').value);
  $('#go').onclick = async () => {
    const email = $('#em').value.trim(), pw = $('#pw').value;
    if (!email) return err('이메일을 입력해 주세요.');
    if (!pw) return err('비밀번호를 입력해 주세요.');
    if (su) {
      if (pw.length < 6) return err('비밀번호는 6자 이상이어야 해요.');
      if (pw !== $('#pw2').value) return err('비밀번호가 서로 달라요. 다시 확인해 주세요.');
    }
    $('#go').disabled = true;
    const { data, error } = su ? await sb.auth.signUp({ email, password: pw }) : await sb.auth.signInWithPassword({ email, password: pw });
    $('#go').disabled = false;
    if (error) return err(authMsg(error));
    if (su && !data.session) return err('확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요.', true);
    location.reload();
  };
}


/* ---------------- onboarding (first launch) ---------------- */
// the local copy is keyed by account so one login never inherits another account's profile
let PROFILE_UID = null;
const profKey = () => 'diet.profile' + (PROFILE_UID ? '.' + PROFILE_UID : '');
function applyProfile(p) {
  PROFILE = p; if (!p) return;
  if (p.goal) GOAL = Number(p.goal);
  BACK = p.back !== false;
  if (p.place) useGym = p.place === 'gym';
  if (p.program_start) PROGRAM_START = p.program_start;
}
async function loadProfile() {
  let p = null;
  if (store.mode === 'supabase') {
    const { data: u } = await store.sb.auth.getUser();
    PROFILE_UID = u.user.id;
    try { p = JSON.parse(lsGet(profKey())); } catch {}
    const { data, error } = await store.sb.from('users').select('profile').eq('id', u.user.id).maybeSingle();
    if (!error && data?.profile) p = data.profile;
  } else { try { p = JSON.parse(lsGet(profKey())); } catch {} }
  applyProfile(p);
}
function showOnboarding(mode) {
  const edit = mode === 'edit';
  const box = $('#login'); box.hidden = false; box.classList.add('ob');
  const A = edit ? { h: HEIGHT ?? '', w: latestWeight() ?? '', g: GOAL, place: useGym ? 'gym' : 'home', back: BACK ? 'yes' : 'no', level: PROFILE?.level || 'new' }
    : { h: '', w: '', g: '', place: null, back: null, level: null };
  let step = 0; const N = 4;
  const pickCards = (key, opts) => `<div class="ob-cards">${opts.map(([v, t, d, ic]) => `<button class="ob-card${A[key] === v ? ' on' : ''}" data-k="${key}" data-v="${v}"><span class="ob-ic">${ic}</span><b>${t}</b><small>${d}</small></button>`).join('')}</div>`;
  const STEPS = [
    () => ['몸 정보를 알려주세요', '목표 칼로리와 BMI를 계산하는 데 써요.',
      `<label class="f">키</label><label class="unit-in"><input class="in" id="oh" type="number" step="0.1" inputmode="decimal" value="${A.h}" placeholder="0"><span>cm</span></label>
       <label class="f">현재 체중</label><label class="unit-in"><input class="in" id="ow" type="number" step="0.01" inputmode="decimal" value="${A.w}" placeholder="0.00"><span>kg</span></label>
       <label class="f">목표 체중</label><label class="unit-in"><input class="in" id="og" type="number" step="0.1" inputmode="decimal" value="${A.g}" placeholder="0"><span>kg</span></label>`],
    () => ['어디서 운동하실 건가요?', '나중에 설정에서 바꿀 수 있어요.',
      pickCards('place', [['home', '집에서 맨몸', '기구 없이 바로 시작해요', '🏠'], ['gym', '헬스장', '머신 위주 루틴으로 짜 드려요', '🏋️']])],
    () => ['허리나 관절이 불편한가요?', '불편하면 허리를 보호하는 운동(맥길 빅3)을 매번 넣어요.',
      pickCards('back', [['no', '괜찮아요', '일반 전신 루틴', '👍'], ['yes', '허리가 불편해요', '허리 안전 운동 포함', '🩹']])],
    () => ['운동 경험은 어느 정도예요?', '강도와 세트 수를 여기에 맞춰 시작해요.',
      pickCards('level', [['new', '처음이에요', '2세트부터 천천히', '🌱'], ['some', '가끔 해요', '2주 차 강도부터', '🚶'], ['steady', '꾸준히 해요', '3주 차 강도부터', '🔥']])],
  ];
  const draw = () => {
    const [h, sub, body] = STEPS[step]();
    box.innerHTML = `<div class="ob-wrap"><div class="ob-top">${step || edit ? '<button class="ob-back" id="obBack" aria-label="이전">‹</button>' : '<span></span>'}<div class="ob-bar"><i style="width:${((step + 1) / N) * 100}%"></i></div><span class="ob-n">${step + 1}/${N}</span></div>
      <h1 class="ob-h">${h}</h1><p class="desc">${sub}</p>${body}<div class="err" id="oerr"></div>
      <button class="btn ob-next" id="obNext">${step === N - 1 ? (edit ? '저장하기' : '시작하기') : '다음'}</button></div>`;
    box.querySelectorAll('.ob-card').forEach((b) => { b.onclick = () => { A[b.dataset.k] = b.dataset.v; draw(); }; });
    if ($('#obBack')) $('#obBack').onclick = () => { collect(); if (step === 0) { box.hidden = true; box.classList.remove('ob'); box.innerHTML = ''; return; } step--; draw(); };
    $('#obNext').onclick = next;
  };
  const collect = () => { if (step === 0) { A.h = $('#oh').value; A.w = $('#ow').value; A.g = $('#og').value; } };
  const fail = (m) => { $('#oerr').textContent = m; };
  const next = async () => {
    collect();
    if (step === 0) {
      const h = num(A.h), w = num(A.w), g = num(A.g);
      if (h == null || h < 120 || h > 220) return fail('키를 120~220cm 사이로 입력해 주세요.');
      if (w == null || w < 30 || w > 250) return fail('현재 체중을 입력해 주세요.');
      if (g == null || g >= w) return fail('목표 체중은 현재 체중보다 낮게 입력해 주세요.');
      const minW = 18.5 * (h / 100) ** 2;
      if (g < minW) return fail(`키 ${h}cm에서 건강한 최저 체중은 약 ${minW.toFixed(1)}kg이에요. 목표를 그 위로 잡아 주세요.`);
    }
    if (step === 1 && !A.place) return fail('운동 장소를 골라 주세요.');
    if (step === 2 && !A.back) return fail('하나를 골라 주세요.');
    if (step === 3 && !A.level) return fail('하나를 골라 주세요.');
    if (step < N - 1) { step++; return draw(); }
    $('#obNext').disabled = true; $('#obNext').textContent = '플랜 만드는 중…';
    try { await (edit ? saveProfileEdit(A) : finishOnboarding(A)); location.reload(); } catch (e) { $('#obNext').disabled = false; $('#obNext').textContent = '시작하기'; fail(authMsg(e)); }
  };
  draw();
}
// settings: change one profile field at a time (saved right away)
async function saveProfilePatch(patch) {
  PROFILE = { ...(PROFILE || {}), ...patch };
  try { localStorage.setItem(profKey(), JSON.stringify(PROFILE)); } catch {}
  if (store.mode === 'supabase') { try { const { data: u } = await store.sb.auth.getUser(); await store.sb.from('users').update({ profile: PROFILE }).eq('id', u.user.id); } catch {} }
}
function openGoalSheet() {
  openSheet(`<div class="sheet-head"><h2>목표 체중</h2></div><p class="desc small">현재 체중보다 낮게, 키에 맞는 건강한 체중 이상으로 정해요.</p>
    <label class="unit-in big-in"><input id="gIn" type="number" step="0.1" inputmode="decimal" value="${GOAL}" placeholder="0"><span>kg</span></label>
    <div class="err" id="err"></div><button class="btn" id="gSave">저장</button>`);
  $('#gSave').onclick = async () => {
    const g = num($('#gIn').value), w = latestWeight();
    if (g == null || g < 30) { $('#err').textContent = '목표 체중을 입력해 주세요.'; return; }
    if (w != null && g >= w) { $('#err').textContent = '목표 체중은 현재 체중보다 낮게 입력해 주세요.'; return; }
    if (HEIGHT && g < 18.5 * (HEIGHT / 100) ** 2) { $('#err').textContent = `키 ${HEIGHT}cm에서 건강한 최저 체중은 약 ${(18.5 * (HEIGHT / 100) ** 2).toFixed(1)}kg이에요.`; return; }
    GOAL = g; await saveProfilePatch({ goal: g }); closeSheet(); render();
  };
}
async function saveProfileEdit(A) {
  const h = num(A.h), g = num(A.g);
  const profile = { ...(PROFILE || {}), goal: g, place: A.place, back: A.back === 'yes', level: A.level };
  try { localStorage.setItem(profKey(), JSON.stringify(profile)); localStorage.setItem('diet.gym', A.place === 'gym' ? '1' : '0'); localStorage.setItem('diet.height', String(h)); } catch {}
  if (store.mode === 'supabase') {
    const { data: u } = await store.sb.auth.getUser();
    const r = await store.sb.from('users').update({ height: h, profile }).eq('id', u.user.id);
    if (r.error) throw new Error(r.error.message);
  }
}
async function finishOnboarding(A) {
  const h = num(A.h), w = num(A.w), g = num(A.g);
  const mon = new Date(today + 'T00:00:00'); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  const back = { new: 0, some: 1, steady: 2 }[A.level]; mon.setDate(mon.getDate() - 7 * back);
  const profile = { goal: g, place: A.place, back: A.back === 'yes', level: A.level, program_start: mon.toLocaleDateString('sv'), tour: 'pending' };
  try { localStorage.setItem(profKey(), JSON.stringify(profile)); localStorage.setItem('diet.gym', A.place === 'gym' ? '1' : '0'); localStorage.setItem('diet.height', String(h)); localStorage.setItem('diet.startDate', today); } catch {}
  if (store.mode === 'supabase') {
    const { data: u } = await store.sb.auth.getUser();
    const upd = (o) => store.sb.from('users').update(o).eq('id', u.user.id);
    let r = await upd({ height: h, start_date: today, profile });
    if (r.error) r = await upd({ start_date: today }); // profile/height columns missing → migration 0005 not run yet; keep local copy
    if (r.error) throw new Error(r.error.message);
  }
  applyProfile(profile); HEIGHT = h; START = today;
  await store.save({ date: today, weight: w, meals: [], exercises: [] });
  await loadAll();
  for (let i = 0; i < 7; i++) await generatePlan(addDays(today, i));
}

/* ---------------- exercise guide (tap an exercise to see how-to + video) ----------------
   yt = YouTube video id (null → search link only). Videos are shown as tap-to-play (playsinline) with an "open in YouTube" fallback. */
const EX_GUIDE = [
  { k: '맥길 컬업', m: '복직근 · 코어', yt: 'p6X1-Hb30I4', q: '맥길 컬업 방법', steps: ['바닥에 누워 한쪽 무릎은 세우고 다른 다리는 편하게 펴요.', '두 손을 허리 밑 빈 공간에 깔아 허리 커브를 유지해요.', '머리와 어깨만 살짝(몇 cm) 들어 8초 버텨요. 허리는 바닥에서 뜨지 않아야 해요.', '천천히 내려오고 6→4→2회 순서로 반복해요. 다리를 바꿔 반복해도 좋아요.'], tips: ['윗몸일으키기가 아니에요. 높이 올라갈수록 허리에 부담이 커져요.', '버티는 동안 숨을 참지 말고 짧게 나눠 쉬어요.'] },
  { k: '사이드 플랭크', m: '옆구리 · 허리 안정근', yt: 'p6X1-Hb30I4', q: '무릎 대고 사이드 플랭크', steps: ['옆으로 누워 팔꿈치를 어깨 바로 아래에 둬요.', '무릎은 굽혀 바닥에 대고, 머리-어깨-골반이 일직선이 되게 골반을 들어요.', '8초 버티고 내려와요. 좌우 각각 6→4→2회 반복해요.'], tips: ['골반이 앞뒤로 말리지 않게 배에 힘을 줘요.', '쉬워지면 무릎을 펴고 발로 지지해요.'] },
  { k: '버드독', m: '허리 · 엉덩이 · 코어', yt: 'p6X1-Hb30I4', q: '버드독 운동 방법', steps: ['네발기기 자세에서 손은 어깨 아래, 무릎은 고관절 아래에 둬요.', '배에 힘을 주고 한쪽 팔과 반대쪽 다리를 천천히 길게 뻗어요.', '8초 버티고 돌아와요. 좌우 번갈아 6→4→2회 반복해요.'], tips: ['다리를 높이 올리지 말고 몸과 일직선까지만. 허리가 꺾이면 안 돼요.', '골반이 한쪽으로 기울지 않게 등 위에 컵이 있다고 생각해요.'] },
  { k: '맨몸 스쿼트', m: '허벅지 · 엉덩이', yt: 'J-eLKNd7Fyo', q: '맨몸 스쿼트 올바른 자세', steps: ['발을 어깨너비로 벌리고 발끝은 살짝 바깥으로 향해요.', '엉덩이를 뒤로 빼며 의자에 앉듯 내려가요. 가슴은 펴고 시선은 정면.', '허벅지가 바닥과 평행해지면(편한 깊이까지) 발바닥 전체로 바닥을 밀며 일어서요.', '무릎은 발끝 방향으로 향하게 하고, 내려갈 때 숨을 마시고 올라올 때 내쉬어요.'], tips: ['뒤꿈치가 뜨거나 무릎이 안쪽으로 모이면 깊이를 줄여요.', '허리가 둥글게 말리면 멈춰요.'] },
  { k: '글루트 브릿지', m: '엉덩이 · 햄스트링', yt: 'FG-FdqMGaY8', q: '글루트 브릿지 방법', steps: ['누워서 무릎을 세우고 발은 엉덩이 너비로 둬요.', '엉덩이를 조이며 골반을 들어 무릎-골반-어깨가 일직선이 되게 해요.', '위에서 1~2초 멈추고 천천히 내려와요.'], tips: ['허리로 들지 말고 엉덩이 힘으로 올려요. 허리가 과하게 꺾이면 높이를 낮춰요.'] },
  { k: '무릎 푸시업', m: '가슴 · 어깨 · 팔', yt: 'm0X3PLXX8Qc', q: '무릎 푸시업 자세', steps: ['무릎을 바닥에 대고 손은 어깨보다 약간 넓게 짚어요.', '머리-어깨-엉덩이-무릎이 일직선이 되게 배에 힘을 줘요.', '팔꿈치를 몸에서 약 45도로 벌리며 가슴이 바닥 가까이 내려가요.', '바닥을 밀며 올라와요.'], tips: ['엉덩이가 뒤로 빠지거나 허리가 처지지 않게 해요.', '천천히 내려가면(3초) 더 효과적이에요.'] },
  { k: '리버스 런지', m: '허벅지 · 엉덩이', yt: 'k1xIOOo_w9A', q: '리버스 런지 올바른 자세', steps: ['발을 모으고 서서 한 발을 뒤로 크게 내딛어요.', '양 무릎이 90도 정도 되게 몸을 수직으로 내려요.', '앞발 뒤꿈치로 밀며 처음 자세로 돌아와요. 반대 다리도 같은 방법으로 해요.'], tips: ['상체는 곧게, 앞무릎은 발끝을 넘지 않게. 균형이 안 잡히면 벽을 짚어요.'] },
  { k: '힙 힌지', m: '엉덩이 · 햄스트링 · 허리 보호', yt: 'JbfrA2w8uUI', q: '힙 힌지 맨몸 방법', steps: ['발은 어깨너비, 무릎은 살짝만 굽혀요.', '손을 골반에 대고 엉덩이를 뒤로 쭉 밀며 상체를 숙여요. 등은 곧게 유지해요.', '햄스트링이 당겨지는 지점에서 멈추고 엉덩이를 앞으로 밀며 일어나요.'], tips: ['허리가 아니라 고관절에서 접히는 느낌이 핵심이에요. 허리가 아프면 범위를 줄여요.'] },
  { k: '옆으로 누워 다리 들기', m: '엉덩이 옆 · 고관절', yt: null, q: '옆으로 누워 다리 들기 중둔근', steps: ['옆으로 누워 아래 다리는 굽히고 위 다리는 곧게 펴요.', '골반이 뒤로 말리지 않게 고정하고 위 다리를 천천히 들어요.', '1초 멈추고 천천히 내려요. 좌우 같은 횟수로 해요.'], tips: ['다리를 높이 들기보다 엉덩이 옆 힘으로 천천히. 몸통이 흔들리면 범위를 줄여요.'] },
  { k: '엎드려 Y-T', m: '등 · 어깨 뒤쪽', yt: '9UjOG68QlxA', q: '엎드려 Y T W 레이즈', steps: ['엎드려서 이마를 바닥에 두고 팔을 Y자로 머리 위에 뻗어요.', '엄지를 천장으로 향하게 하고 팔만 살짝 들어 1초 멈춰요. 이어서 T자도 같은 방식으로 해요.', '날개뼈를 아래로 모으는 느낌으로, 허리는 들지 않아요.'], tips: ['가볍게 들어도 충분해요. 목에 힘이 들어가면 시선을 바닥에 둬요.'] },
  { k: '엎드려 W', m: '등 · 어깨 뒤쪽', yt: '9UjOG68QlxA', q: '엎드려 W 레이즈', steps: ['엎드려서 팔꿈치를 굽혀 W 모양으로 만들어요.', '날개뼈를 모으며 팔을 살짝 들어 1초 멈추고 내려요.'], tips: ['허리가 꺾이지 않게 배를 살짝 조여요.'] },
  { k: '전신 스트레칭', m: '허리 · 햄스트링 · 고관절', yt: 'XZCJRfhYJ-w', q: '운동 후 전신 스트레칭', steps: ['목, 어깨, 가슴을 먼저 부드럽게 풀어요.', '허리는 고양이-소 자세, 햄스트링은 누워서 다리 당기기, 고관절은 런지 자세로 늘려요.', '각 동작을 20~30초씩, 아프지 않고 시원한 정도까지만 유지해요.'], tips: ['반동을 주지 말고 호흡을 길게 내쉬며 천천히 늘려요.'] },
  { k: '인터벌 걷기', m: '심폐 · 하체', yt: null, q: '인터벌 걷기 방법', steps: ['5분 정도 천천히 걸으며 몸을 풀어요.', '빠르게 3분(숨이 차지만 짧게 말은 할 수 있는 정도) → 보통 속도 2분을 7번 반복해요.', '마지막에 천천히 걸으며 마무리해요.'], tips: ['팔은 90도로 굽혀 자연스럽게 흔들고, 발뒤꿈치부터 닿아요.', '숨이 너무 차면 빠른 구간 속도를 낮춰요.'] },
  { k: '빠르게 걷기', m: '심폐 · 하체', yt: null, q: '올바른 걷기 자세 빠르게 걷기', steps: ['시선은 정면, 가슴은 열고 턱은 살짝 당겨요.', '보폭은 평소보다 약간 넓게, 팔은 자연스럽게 앞뒤로 흔들어요.', '말은 할 수 있지만 노래는 못 부를 정도의 속도를 유지해요.'], tips: ['발은 뒤꿈치 → 발바닥 → 앞꿈치 순서로 닿게 해요.'] },
  { k: '길게 걷기', m: '심폐 · 하체', yt: null, q: '올바른 걷기 자세', steps: ['편한 신발을 신고 쉬지 않고 이어서 걸어요.', '평소보다 조금 빠르게, 대화가 가능한 강도로 유지해요.'], tips: ['물을 챙기고, 허리가 아프면 보폭을 줄여요.'] },
  { k: '산책', m: '회복 · 심폐', yt: null, q: '올바른 걷기 자세', steps: ['편한 속도로 걸으며 몸을 풀어줘요.', '어깨와 목에 힘을 빼고 호흡을 편하게 해요.'], tips: ['회복일에는 숨이 차지 않는 강도가 좋아요.'] },
  { k: '레그 프레스', m: '허벅지 · 엉덩이', yt: null, q: '레그프레스 머신 사용법', steps: ['등과 엉덩이를 등받이에 붙이고 발은 어깨너비로 플레이트 중간에 둬요.', '무릎을 끝까지 펴지 않는 지점까지 밀어요.', '천천히 무릎이 90도 정도 되도록 돌아와요. 엉덩이가 들리지 않게 해요.'], tips: ['무릎이 안쪽으로 모이지 않게. 처음엔 가벼운 무게로 자세부터 익혀요.'] },
  { k: '레그 컬', m: '햄스트링', yt: null, q: '시티드 레그컬 머신 사용법', steps: ['패드를 종아리 아래쪽에 맞추고 등받이에 기대요.', '발뒤꿈치를 엉덩이 쪽으로 천천히 당겨요.', '천천히 돌아오며 햄스트링의 긴장을 유지해요.'], tips: ['반동 없이, 올라올 때 2초 내려갈 때 3초 정도로 천천히 해요.'] },
  { k: '힙 어브덕션', m: '엉덩이 옆', yt: null, q: '힙 어브덕션 머신 사용법', steps: ['등받이에 허리를 붙이고 무릎 바깥쪽에 패드를 대요.', '엉덩이 옆 힘으로 다리를 천천히 벌려요.', '천천히 모으되 완전히 닫지 말고 긴장을 유지해요.'], tips: ['상체를 앞뒤로 흔들지 않아요.'] },
  { k: '체스트 프레스', m: '가슴 · 어깨 · 팔', yt: null, q: '체스트 프레스 머신 사용법', steps: ['손잡이가 가슴 중간 높이에 오도록 의자를 조절해요.', '등을 등받이에 붙이고 어깨를 내린 채 앞으로 밀어요.', '팔꿈치를 완전히 펴지 않고 천천히 돌아와요.'], tips: ['어깨가 으쓱 올라가지 않게 해요.'] },
  { k: '랫 풀다운', m: '등 · 팔', yt: null, q: '랫풀다운 올바른 자세', steps: ['허벅지 패드를 고정하고 바를 어깨너비보다 넓게 잡아요.', '가슴을 펴고 바를 쇄골 쪽으로 팔꿈치를 아래로 당겨요.', '천천히 팔을 펴며 올려요.'], tips: ['몸을 뒤로 젖혀 반동으로 당기지 않아요. 허리가 꺾이지 않게 해요.'] },
  { k: '시티드 로우', m: '등 · 팔', yt: null, q: '시티드 로우 머신 사용법', steps: ['가슴을 패드에 붙이고 손잡이를 잡아요.', '날개뼈를 모으며 팔꿈치를 뒤로 당겨요.', '천천히 팔을 펴며 돌아와요.'], tips: ['허리는 세우고 어깨는 귀에서 멀리 내려요.'] },
  { k: '숄더 프레스', m: '어깨', yt: null, q: '숄더 프레스 머신 사용법', steps: ['손잡이가 어깨 높이에 오도록 시트를 맞춰요.', '허리를 등받이에 붙인 채 위로 밀어요.', '팔꿈치를 완전히 펴지 않고 천천히 내려와요.'], tips: ['가벼운 무게로. 허리가 꺾이면 무게를 낮춰요.'] },
  { k: '트레드밀', m: '심폐 · 하체', yt: null, q: '트레드밀 경사 걷기 방법', steps: ['속도 4~5km/h, 경사 5~7%로 맞춰요.', '손잡이를 잡지 않고 자연스럽게 팔을 흔들며 걸어요.', '말은 할 수 있지만 노래는 못 부를 정도의 강도를 유지해요.'], tips: ['경사가 높아도 몸을 앞으로 심하게 숙이지 않아요.'] },
  { k: '사이클', m: '심폐 · 하체', yt: null, q: '실내 사이클 올바른 자세', steps: ['안장 높이를 페달이 가장 아래일 때 무릎이 살짝 굽혀지게 맞춰요.', '허리를 곧게 세우고 어깨에 힘을 빼요.', '지정된 강도(빠르게/보통)를 번갈아 유지해요.'], tips: ['무릎이 안쪽으로 모이지 않게 해요.'] },
];
const guideFor = (name) => EX_GUIDE.find((g) => name.includes(g.k)) || null;
const ytThumb = (id) => `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
function openExerciseGuide(name) {
  const g = guideFor(name), base = name.replace(/\s*\(.*?\)/g, '');
  const q = encodeURIComponent((g?.q || base + ' 운동 방법'));
  const search = `https://www.youtube.com/results?search_query=${q}`;
  const plan = [...(dayPlan?.exercises || []), ...(planData?.exercises || [])].find((x) => x.name === name);
  openSheet(`<div class="sheet-head"><h2>${esc(name)}</h2></div>
    ${plan ? `<p class="desc small">${esc(exDetail(plan))}${plan.notes ? ' · ' + esc(plan.notes) : ''}</p>` : ''}
    ${g ? `<div class="eyebrow">자극 부위 · ${esc(g.m)}</div>
      ${g.yt ? `<button type="button" class="yt" data-yt="${g.yt}" aria-label="영상 재생"><img src="${ytThumb(g.yt)}" alt=""><span class="yt-play">▶</span></button>` : ''}
      <label class="f">이렇게 해요</label><ol class="guide">${g.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      ${(() => { const h = liftHistory(name); if (!h.length) return ''; const first = h[h.length - 1], last = h[0], d = last.weight - first.weight;
        return `<label class="f">내 무게 기록</label><div class="lift-hist">${h.slice(0, 6).map((x) => `<span>${mmdd(x.date)} <b>${x.weight}kg</b></span>`).join('')}</div>
          <p class="desc small">${h.length > 1 ? `처음 ${first.weight}kg → 지금 ${last.weight}kg ${d > 0 ? '▲' + d : d < 0 ? '▼' + Math.abs(d) : '(변화 없음)'}` : '첫 기록이에요. 다음엔 조금씩 올려봐요.'}</p>`; })()}
      <label class="f">자세 팁 · 주의</label><ul class="guide tips">${g.tips.map((s) => `<li>${esc(s)}</li>`).join('')}<li>허리나 관절에 날카로운 통증이 느껴지면 바로 멈춰요.</li></ul>`
      : '<p class="desc">이 운동은 아직 설명이 없어요. 아래 버튼으로 영상을 찾아보세요.</p>'}
    <a class="btn ghost yt-link" href="${search}" target="_blank" rel="noopener">${g?.yt ? '▶ YouTube에서 열기 / 다른 영상 찾기' : '▶ YouTube에서 영상 찾아보기'}</a>`);
}
document.addEventListener('click', async (e) => {
  const xm = e.target.closest('[data-xmeal]'); if (xm) return openExtraMealSheet(xm.dataset.xmeal);
  const xe = e.target.closest('[data-xex]'); if (xe) return openExtraExSheet(xe.dataset.xex);
  if (e.target.closest('#chPw')) return openPasswordSheet();
  if (e.target.closest('#delAcct')) return openDeleteSheet();
  if (e.target.closest('#shareBtn')) return openShareSheet();
  if (e.target.closest('#goalBtn')) return openGoalSheet();
  if (e.target.closest('#tourBtn')) return startTour();
  if (e.target.closest('#foodAdminBtn')) return openFoodAdminSheet();
  const yb = e.target.closest('[data-yt]');
  if (yb) { yb.outerHTML = `<div class="yt"><iframe src="https://www.youtube-nocookie.com/embed/${yb.dataset.yt}?playsinline=1&autoplay=1&rel=0&modestbranding=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`; return; }
  const t = e.target.closest('[data-exinfo]'); if (t) openExerciseGuide(t.dataset.exinfo);
});

function openExtraMealSheet(x) {
  const [date, i] = [x.slice(0, 10), Number(x.slice(11))], r = cache[date] || {}, m = (r.meals || [])[i]; if (!m) return;
  openSheet(`<div class="sheet-head"><h2>${dateLabel(date)} 음식 수정</h2></div><div id="rows">${mealRowEdit(m, { star: false })}</div>
    <div class="err" id="err"></div><button class="btn" id="save">저장</button><button class="btn ghost" id="del" style="color:var(--up)">삭제</button>`);
  sheet.querySelectorAll('.rm').forEach((b) => b.remove());
  const put = async (meals) => {
    const rec = { date, weight: r.weight ?? null, steps: r.steps ?? null, calories_consumed: meals.reduce((a, v) => a + (v.kcal || 0), 0) || null, calories_burned: r.calories_burned ?? null, meals, exercises: r.exercises || [] };
    try { await store.save(rec); closeSheet(); await refresh(); } catch (e) { $('#err').textContent = authMsg(e); }
  };
  $('#save').onclick = () => { const n = readMealRows($('#rows'))[0]; if (!n) { $('#err').textContent = '음식 이름을 입력해주세요.'; return; } const meals = [...r.meals]; meals[i] = n; put(meals); };
  $('#del').onclick = () => { if (confirm('이 음식 기록을 삭제할까요?')) put(r.meals.filter((_, k) => k !== i)); };
}
function openExtraExSheet(x) {
  const [date, i] = [x.slice(0, 10), Number(x.slice(11))], r = cache[date] || {}, e = (r.exercises || [])[i]; if (!e) return;
  openSheet(`<div class="sheet-head"><h2>${dateLabel(date)} 운동 수정</h2></div><div id="rows">${exRowEdit(e)}</div>
    <div class="err" id="err"></div><button class="btn" id="save">저장</button><button class="btn ghost" id="del" style="color:var(--up)">삭제</button>`);
  sheet.querySelectorAll('.rm, .drag, .exfold').forEach((b) => b.remove());
  const put = async (exercises) => {
    const rec = { date, weight: r.weight ?? null, steps: r.steps ?? null, calories_consumed: r.calories_consumed ?? null, calories_burned: calcBurn({ ...r, exercises }) ?? r.calories_burned ?? null, meals: r.meals || [], exercises };
    try { await store.save(rec); closeSheet(); await refresh(); } catch (er) { $('#err').textContent = authMsg(er); }
  };
  $('#save').onclick = () => { const n = readExRows($('#rows'))[0]; if (!n) { $('#err').textContent = '운동 이름을 입력해주세요.'; return; } const { done, ...v } = n; const list = [...r.exercises]; list[i] = v; put(list); };
  $('#del').onclick = () => { if (confirm('이 운동 기록을 삭제할까요?')) put(r.exercises.filter((_, k) => k !== i)); };
}

async function openFoodAdminSheet() {
  let list = [];
  try { list = await store.foods.pending(); } catch (e) {}
  pendingFoodCount = list.length;
  openSheet(`<div class="sheet-head"><h2>음식 승인 대기</h2></div>
    <p class="desc small">승인하면 모든 사용자의 음식 검색에 나와요. 값이 이상하면 거절하세요.</p>
    ${list.length ? list.map((f) => `<div class="li"><div class="li-left"><div><span class="li-name">${esc(f.name)}</span><small>${f.grams ? f.grams + 'g · ' : ''}${f.kcal}kcal · ${esc(f.cat)}</small></div></div>
      <span class="mg-btns"><button class="skipall" data-fa="${f.id}:approved">승인</button><button class="skipall undo" data-fa="${f.id}:rejected">거절</button></span></div>`).join('') : '<div class="empty">대기 중인 음식이 없어요</div>'}
    <div class="err" id="err"></div>`);
  sheet.querySelectorAll('[data-fa]').forEach((b) => { b.onclick = async () => {
    const [id, st] = b.dataset.fa.split(':');
    try { await store.foods.review(id, st); if (st === 'approved') customFoods = await store.foods.list(); openFoodAdminSheet(); render(); } catch (e) { $('#err').textContent = authMsg(e); }
  }; });
}
function shareBase() {
  if (CFG.SHARE_BASE) return CFG.SHARE_BASE;
  return /^https?:$/.test(location.protocol) && !/^(localhost|127\.|192\.168\.|10\.)/.test(location.hostname) ? location.origin + location.pathname : null;
}
const shareUrl = () => `${shareBase() || '(웹앱 주소)/'}?share=${shareToken}`;
function openShareSheet() {
  const base = shareBase();
  openSheet(`<div class="sheet-head"><h2>내 기록 공유하기</h2></div>
    <p class="desc">링크를 받은 사람은 내 체중·식단·운동·인바디를 <b>보기만</b> 할 수 있어요(수정 불가). 메모와 계정 정보는 공유되지 않아요. 링크를 아는 사람은 누구나 볼 수 있으니 믿는 사람에게만 보내세요.</p>
    ${shareToken ? `<input class="in" id="shUrl" readonly value="${esc(shareUrl())}">
      ${base ? '' : '<p class="desc small" style="color:var(--up)">지금은 이 앱이 인터넷에 올라간 주소가 아니라서 링크 앞부분을 알 수 없어요. 웹앱 주소가 정해지면 설정 파일(SHARE_BASE)에 넣어야 해요.</p>'}
      <button class="btn" id="shCopy">링크 복사</button>${navigator.share ? '<button class="btn ghost" id="shSend">공유하기…</button>' : ''}
      <button class="btn ghost" id="shNew">링크 새로 만들기 (이전 링크는 못 열어요)</button>
      <button class="btn ghost" id="shOff" style="color:var(--up)">공유 끝내기</button>`
      : '<button class="btn" id="shOn">읽기 전용 링크 만들기</button>'}
    <div class="err" id="err"></div>`);
  const set = async (en) => { const { data, error } = await store.sb.rpc('set_share', { enable: en }); if (error) { $('#err').textContent = authMsg(error); return; } shareToken = data; openShareSheet(); render(); };
  if ($('#shOn')) $('#shOn').onclick = () => set(true);
  if ($('#shNew')) $('#shNew').onclick = () => { if (confirm('이전 링크는 더 이상 열리지 않아요. 새로 만들까요?')) set(true); };
  if ($('#shOff')) $('#shOff').onclick = () => { if (confirm('공유를 끝내면 링크가 열리지 않아요.')) set(false); };
  if ($('#shCopy')) $('#shCopy').onclick = async () => { try { await navigator.clipboard.writeText(shareUrl()); $('#shCopy').textContent = '복사했어요 ✓'; } catch { $('#shUrl').select(); $('#err').textContent = '길게 눌러 복사해 주세요.'; } };
  if ($('#shSend')) $('#shSend').onclick = () => navigator.share({ title: '다이어트 기록', url: shareUrl() }).catch(() => {});
}
function openPasswordSheet() {
  openSheet(`<div class="sheet-head"><h2>비밀번호 변경</h2></div>
    <input class="in" id="np1" type="password" placeholder="새 비밀번호 (6자 이상)" autocomplete="new-password">
    <input class="in" id="np2" type="password" placeholder="새 비밀번호 확인" autocomplete="new-password" style="margin-top:10px">
    <div class="err" id="err"></div><button class="btn" id="npSave">변경하기</button>`);
  $('#npSave').onclick = async () => {
    const a = $('#np1').value, b = $('#np2').value;
    if (a.length < 6) { $('#err').textContent = '비밀번호는 6자 이상이에요.'; return; }
    if (a !== b) { $('#err').textContent = '두 비밀번호가 달라요.'; return; }
    const { error } = await store.sb.auth.updateUser({ password: a });
    if (error) { $('#err').textContent = authMsg(error); return; }
    closeSheet(); alert('비밀번호를 바꿨어요.');
  };
}
function openDeleteSheet() {
  openSheet(`<div class="sheet-head"><h2>회원 탈퇴</h2></div>
    <p class="desc">탈퇴하면 <b>계정과 모든 기록(체중·식단·운동·인바디·즐겨찾기)이 영구 삭제</b>되고 되돌릴 수 없어요. 공유 링크도 함께 사라져요.</p>
    <p class="desc small">계속하려면 아래에 <b>탈퇴</b>라고 입력해 주세요.</p>
    <input class="in" id="delIn" placeholder="탈퇴">
    <div class="err" id="err"></div><button class="btn" id="delGo" style="background:var(--up)">영구 삭제하고 탈퇴</button><button class="btn ghost" id="delNo">취소</button>`);
  $('#delNo').onclick = closeSheet;
  $('#delGo').onclick = async () => {
    if ($('#delIn').value.trim() !== '탈퇴') { $('#err').textContent = "'탈퇴'를 정확히 입력해 주세요."; return; }
    $('#delGo').disabled = true;
    const { error } = await store.sb.rpc('delete_my_account');
    if (error) { $('#delGo').disabled = false; $('#err').textContent = authMsg(error); return; }
    try { await store.sb.auth.signOut(); } catch {}
    try { Object.keys(localStorage).filter((k) => k.startsWith('diet.')).forEach((k) => localStorage.removeItem(k)); } catch {}
    location.reload();
  };
}

/* ---------------- first-run guided tour (spotlight) ---------------- */
const TOUR_TAB = (t) => `.tabs [data-tab="${t}"]`;
const TOUR = [
  { center: true, title: '환영해요! 👋', text: '처음이시죠? 앱 사용법을 직접 눌러보며 알려드릴게요.\n\n건너뛰어도 괜찮아요. 설정 탭의 「사용방법 보기」에서 언제든 다시 볼 수 있어요.' },
  { tab: 'home', sel: TOUR_TAB('home'), tap: true, title: '오늘 탭', text: '오늘 체중과 할 일 진행률을 한눈에 보는 곳이에요. 빛나는 버튼을 눌러보세요!' },
  { tab: 'home', sel: '#quickWeight', tap: true, title: '체중 입력', text: '아침 공복에 체중을 입력해요. 눌러서 입력창을 열어볼까요?' },
  { sheet: true, title: '체중 입력창', text: '체중을 적고 저장하면 오늘 기록에 들어가요. 체중이 쌓이면 감량 속도를 분석해서 식단과 운동을 자동으로 맞춰드려요. (지금은 저장하지 않아도 돼요)' },
  { tab: 'home', sel: TOUR_TAB('meals'), tap: true, title: '체크 탭', text: '오늘 먹을 식단과 할 운동이 여기 있어요. 눌러보세요!' },
  { tab: 'meals', sel: '.check-row .box', title: '체크하기', text: '계획대로 먹거나 운동했다면 동그라미를 눌러 체크해요. 기록에 자동으로 반영돼요.' },
  { tab: 'meals', sel: '.check-row .more', title: '다르게 했을 때', text: '⋯ 버튼: 다른 걸 먹었거나 안 먹었을 때, 대신 한 운동이 있을 때 눌러요. 계획은 그대로 남아요.' },
  { tab: 'meals', sel: '[data-fooddate]', tap: true, title: '계획에 없던 음식', text: '간식이나 외식처럼 계획에 없던 음식은 여기서 추가해요. 눌러볼까요?' },
  { sheet: true, title: '음식 추가창', text: '음식 이름을 검색하면 칼로리가 자동으로 채워져요. 0.5배·1.5배로 양도 조절하고, 자주 먹는 음식은 즐겨찾기에서 골라요. (지금은 저장하지 않아도 돼요)' },
  { tab: 'meals', sel: TOUR_TAB('record'), tap: true, title: '기록 탭', text: '날짜별 체중·식단·운동과 인바디를 모아보는 곳이에요. 눌러보세요!' },
  { tab: 'record', sel: '[data-recedit]', tap: true, title: '기록 입력', text: '체중, 걸음 수, 식사, 운동을 날짜별로 한 번에 입력하는 곳이에요. 「편집」을 눌러보세요!' },
  { sheet: true, title: '기록 입력창', text: '이 창에서 그날의 체중·걸음·먹은 것·운동을 한꺼번에 적어요. 날짜를 지난 기록도 같은 방법으로 고칠 수 있어요. (지금은 저장하지 않아도 돼요)' },
  { tab: 'record', sel: '#openCal', tap: true, title: '날짜 고르기', text: '달력 아이콘을 눌러 원하는 날짜로 바로 이동해요. 눌러보세요!' },
  { sheet: true, title: '달력', text: '날짜를 누르면 그날 기록으로 이동해요. 인바디를 잰 날은 IN 표시가 붙어 있어요.' },
  { tab: 'record', sel: TOUR_TAB('stats'), tap: true, title: '통계 탭', text: '체중과 섭취·소모 칼로리 그래프, 인바디 변화를 봐요. 눌러보세요!' },
  { tab: 'stats', sel: TOUR_TAB('plan'), tap: true, title: '계획 탭', text: '앞으로의 식단·운동 계획과 체중 추이 분석이 있어요. 눌러보세요!' },
  { tab: 'plan', sel: '#planDateBtn', title: '날짜 고르기', text: '계획을 볼 날짜를 골라요. 눌러서 다른 날의 식단과 운동 계획으로 이동할 수 있어요.' },
  { tab: 'plan', sel: '[data-plan="gen"]', title: '추천 플랜으로 채우기', text: '고른 날의 식단과 운동을 추천 플랜으로 새로 채워요. 내 체중과 감량 속도에 맞춰 칼로리가 정해져요. 체크하거나 기록한 항목은 그대로 두고, 나머지만 새 추천으로 바뀌어요.' },
  { tab: 'plan', sel: '[data-plan="genweek"]', title: '앞으로 7일 한 번에', text: '오늘부터 7일치 계획을 한 번에 채워요. 이미 계획이 있는 날은 건너뛰니까 걱정 안 해도 돼요.' },
  { tab: 'plan', sel: '[data-plan="meals"]', title: '식단 편집', text: '추천된 식단을 내 입맛에 맞게 바꿔요. 음식을 검색해서 추가하거나 지울 수 있어요.' },
  { tab: 'plan', sel: '[data-plan="exercises"]', title: '운동 편집', text: '운동 계획도 직접 바꿀 수 있어요. 시간, 세트, 횟수를 고치거나 다른 운동으로 바꿔요.' },
  { tab: 'plan', sel: '.exinfo', tap: true, title: '운동 설명', text: '운동 항목을 누르면 하는 방법과 영상이 나와요. 눌러볼까요?' },
  { sheet: true, title: '운동 방법·영상', text: '자극 부위와 따라 하는 순서, 자세 팁이 나와요. 영상 썸네일을 누르면 바로 재생돼요.' },
  { tab: 'plan', sel: TOUR_TAB('settings'), tap: true, title: '설정 탭', text: '목표 체중, 키, 운동 장소를 바꾸고 기록을 공유할 수 있어요. 눌러보세요!' },
  { tab: 'settings', sel: '#tourBtn', title: '다시 보기', text: '이 사용방법은 여기서 언제든 다시 볼 수 있어요. 이제 시작해볼까요? 🎉', last: true },
];

let tourEl = null;
function endTour(skipped) {
  closeSheet();
  if (tourEl) { tourEl.remove(); tourEl = null; }
  document.body.classList.remove('touring');
  saveProfilePatch({ tour: 'done' });
  tab = 'home'; render(); window.scrollTo(0, 0);
  if (skipped) {
    const n = document.createElement('div'); n.className = 'tour-note';
    n.innerHTML = '<div class="tour-card"><b>건너뛰었어요</b><p>설정 탭 → <b>「사용방법 보기」</b>에서 언제든 다시 볼 수 있어요.</p><button class="btn" id="tnOk">확인</button></div>';
    document.body.appendChild(n); n.querySelector('#tnOk').onclick = () => n.remove();
  }
}
function startTour() {
  if (READONLY || tourEl) return;
  closeSheet();
  tourEl = document.createElement('div'); tourEl.id = 'tour';
  tourEl.innerHTML = '<div class="tm tm-t"></div><div class="tm tm-b"></div><div class="tm tm-l"></div><div class="tm tm-r"></div><div class="tring"></div><div class="tcard"></div>';
  document.body.appendChild(tourEl); document.body.classList.add('touring');
  let i = 0, target = null, token = 0;
  const q = (c) => tourEl.querySelector(c);
  const place = () => {
    if (!tourEl) return;
    const W = window.innerWidth, H = window.innerHeight, card = q('.tcard'), st = TOUR[i];
    const set = (el, l, t, w, h) => Object.assign(el.style, { left: l + 'px', top: t + 'px', width: Math.max(0, w) + 'px', height: Math.max(0, h) + 'px' });
    tourEl.classList.toggle('notarget', !target);
    if (!target) { set(q('.tm-t'), 0, 0, W, H); set(q('.tm-b'), 0, 0, 0, 0); set(q('.tm-l'), 0, 0, 0, 0); set(q('.tm-r'), 0, 0, 0, 0); q('.tring').style.display = 'none';
      Object.assign(card.style, { left: '50%', top: '50%', transform: 'translate(-50%,-50%)', bottom: 'auto' }); return; }
    const r = target.getBoundingClientRect(), pad = st.sheet ? 0 : 6, x = r.left - pad, y = r.top - pad, w = r.width + pad * 2, h = r.height + pad * 2;
    set(q('.tm-t'), 0, 0, W, y); set(q('.tm-b'), 0, y + h, W, H - y - h); set(q('.tm-l'), 0, y, x, h); set(q('.tm-r'), x + w, y, W - x - w, h);
    const ring = q('.tring'); ring.style.display = 'block'; set(ring, x, y, w, h);
    ring.style.borderRadius = (parseFloat(getComputedStyle(target).borderTopLeftRadius) || 10) + pad + 'px';
    ring.style.pointerEvents = st.tap ? 'none' : 'auto'; // only 'tap' steps let clicks through the hole
    if (st.sheet) { Object.assign(card.style, { left: '50%', transform: 'translateX(-50%)', top: 'calc(env(safe-area-inset-top) + 14px)', bottom: 'auto' }); return; }
    const below = y + h + 16 + 190 < H; // room under the target?
    Object.assign(card.style, { left: '50%', transform: 'translateX(-50%)', top: below ? Math.min(y + h + 14, H - 210) + 'px' : 'auto', bottom: below ? 'auto' : (H - y + 14) + 'px' });
  };
  const draw = () => {
    const st = TOUR[i], total = TOUR.length;
    q('.tcard').innerHTML = `<div class="tstep">${i + 1} / ${total}</div><b>${st.title}</b><p>${esc(st.text).replace(/\n/g, '<br>')}</p>
      <div class="tbtns"><button class="tskip" id="tSkip">건너뛰기</button>${st.tap ? '<span class="thint">👆 빛나는 곳을 눌러보세요</span>' : ''}<button class="tnext" id="tNext">${st.last ? '시작하기' : st.tap ? '대신 넘기기' : '다음'}</button></div>`;
    q('#tSkip').onclick = () => endTour(true);
    q('#tNext').onclick = () => { if (st.last) endTour(false); else if (st.tap && target) target.click(); else go(i + 1); };
  };
  const go = async (n) => {
    const my = ++token;
    while (n < TOUR.length) {
      const st = TOUR[n];
      if (st.sheet) { if (sheet.hidden) { n++; continue; } target = sheet; await new Promise((r) => setTimeout(r, 250)); break; }
      closeSheet();
      if (st.tab && tab !== st.tab) { const b = document.querySelector(TOUR_TAB(st.tab)); if (b) b.click(); await new Promise((r) => setTimeout(r, 450)); }
      if (!st.sel) { target = null; break; }
      const el = document.querySelector(st.sel);
      if (el && el.offsetParent !== null) { target = el; el.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 120)); break; }
      n++; // target missing (e.g. no plan yet) → skip this step
    }
    if (my !== token) return;
    if (n >= TOUR.length) return endTour(false);
    i = n; const st = TOUR[i];
    draw(); place();
    if (st.tap && target) {
      const el = target, onTap = () => { el.removeEventListener('click', onTap, true); setTimeout(() => go(i + 1), 120); };
      el.addEventListener('click', onTap, true);
    }
  };
  window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
  go(0);
}

(async function boot() {
  try {
    $('#hello').textContent = dailyQuote();
    if (SHARE_PARAM && !READONLY) {
      let D = null;
      try {
        const r = await fetch(`${CFG.SUPABASE_URL}/rest/v1/rpc/get_shared`, { method: 'POST', headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: `Bearer ${CFG.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ t: SHARE_PARAM }) });
        D = r.ok ? await r.json() : null;
      } catch {}
      if (!D) { $('#view').innerHTML = '<div class="card"><div class="card-title">열 수 없는 링크예요</div><p class="desc">공유가 끝났거나 링크가 바뀌었어요. 공유한 사람에게 새 링크를 받아주세요.</p></div>'; document.querySelector('.tabs').hidden = true; return; }
      window.DIET_SHARE = D; READONLY = true;
      if (D.profile) applyProfile(D.profile);
    }
    if (READONLY) {
      store = shareStore(window.DIET_SHARE); accountLabel = '공유 보기 (읽기 전용)';
      if (window.DIET_SHARE.start) START = window.DIET_SHARE.start;
      if (window.DIET_SHARE.height) HEIGHT = Number(window.DIET_SHARE.height);
      document.body.classList.add('readonly');
    } else if (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) {
      store = await supabaseStore();
      const { data } = await store.sb.auth.getSession();
      if (!data.session) return showLogin(store.sb);
      accountLabel = data.session.user.email; MY_UID = data.session.user.id;
      const { data: urow } = await store.sb.from('users').select('start_date').eq('id', data.session.user.id).maybeSingle();
      if (urow?.start_date) START = urow.start_date;
      const { data: hrow } = await store.sb.from('users').select('height').eq('id', data.session.user.id).maybeSingle(); // null until 0004 migration
      if (hrow?.height) HEIGHT = Number(hrow.height);
      const { data: srow } = await store.sb.from('users').select('share_token').eq('id', data.session.user.id).maybeSingle();
      shareToken = srow?.share_token || null;
      const { data: prow } = await store.sb.from('users').select('program_start').eq('id', data.session.user.id).maybeSingle(); // set by earlier web-app versions
      if (prow?.program_start) PROGRAM_START = prow.program_start;
    } else {
      store = localStore(); accountLabel = '데모 계정';
      HEIGHT = num(lsGet('diet.height'));
      const saved = localStorage.getItem('diet.startDate');
      if (saved) START = saved;
    }
    $('#modeChip').textContent = store.label;
    favorites = await store.favorites.get();
    if (!READONLY) { try { customFoods = await store.foods.list(); } catch {} }
    if (store.mode === 'supabase') { try { const { data: a } = await store.sb.from('users').select('is_admin').eq('id', MY_UID).maybeSingle(); IS_ADMIN = !!a?.is_admin; if (IS_ADMIN) pendingFoodCount = (await store.foods.pending()).length; } catch {} }
    if (!READONLY) { await loadProfile(); if (!PROFILE && !(await store.range('2000-01-01', '2100-01-01')).length) return showOnboarding(); }
    await refresh();
    if (!READONLY && PROFILE?.tour === 'pending') setTimeout(startTour, 500);
  } catch (e) { $('#view').innerHTML = `<div class="card"><div class="err">${esc(authMsg(e))}</div></div>`; }
})();
