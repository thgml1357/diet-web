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
const APP_VERSION = '2026-11-25 · 음식 이름 자동완성·대체 메뉴 제거';
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
  const rec = { date, weight: r.weight ?? null, steps: r.steps ?? null, calories_consumed: Math.round(sum) || null, calories_burned: calcBurn({ ...r, exercises }) ?? r.calories_burned ?? null, meals, exercises };
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
    <div id="rows">${mealRowEdit({ type })}</div>
    <div class="food-actions"><button class="btn ghost" id="add">+ 음식 한 줄 더</button><button class="btn ghost" id="favToggle">☆ 자주 먹는 음식</button></div>
    ${foodSearchHtml()}
    <div class="favpanel" id="favPanel" hidden>${favChipsHtml()}</div>
    <div class="err" id="err"></div><button class="btn" id="save">저장</button>`);
  $('#add').onclick = wireMealRows($('#rows'));
  wireFavPanel($('#favToggle'), $('#favPanel'), $('#rows'));
  wireFoodSearch(sheet.querySelector('.fs'), (f) => addFoodRow($('#rows'), { type, name: f.name, grams: f.grams, kcal: f.kcal, ui: f.ui }));
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
  const sub = st === 'swap' && a.portion ? `<small class="swap-txt">양 다름 ${a.grams ? `${a.grams}g` : ''}${item.grams ? ` (계획 ${item.grams}g)` : ''}</small>`
    : st === 'swap' ? `<small class="swap-txt">대신 ${esc(a.name)}${a.grams ? ` ${a.grams}g` : ''}</small>`
    : st === 'skip' ? `<small>${kind === 'meals' ? '안 먹음' : '못 함'}</small>`
    : plain ? `<small>${plain}</small>` : '';
  return `<div class="check-row"><button class="check st-${st || 'none'}" data-check="${kind}:${i}"><span class="box"></span>
    <span class="check-body"><span class="check-name">${cat}${esc(item.name)}</span>${sub}</span>${right}</button>
    <button class="more" data-more="${kind}:${i}" aria-label="양·내용 수정">${kind === 'meals' ? '양·변경' : '변경'}</button></div>`;
}
function openStatusSheet(kind, i) {
  const item = dayPlan[kind][i], st = itemStatus(item), isMeal = kind === 'meals', a = item.actual || {};
  const planTxt = isMeal ? `${item.grams ? item.grams + 'g · ' : ''}${item.kcal ?? '–'}kcal` : exDetail(item) || '';
  openSheet(`<div class="sheet-head"><h2>${esc(item.name)}</h2></div>
    <p class="desc">계획: ${esc(planTxt)}<br>계획은 그대로 두고, 실제로 ${isMeal ? '먹은' : '한'} 것만 기록해요.</p>
    ${isMeal ? '' : `<button type="button" class="link-btn" style="padding:0 0 10px" data-exinfo="${esc(item.name)}">▶ 운동 방법·영상 보기 ›</button>`}
    <div class="opt-list">
      <button class="opt${st === 'done' || !st ? ' on' : ''}" data-st="done">${isMeal ? '계획대로 먹었어요' : '계획대로 했어요'}</button>
      ${isMeal ? `<button class="opt${st === 'swap' && a.portion ? ' on' : ''}" data-st="portion">양이 달랐어요 (그램 직접 입력)</button>` : ''}
      <button class="opt${st === 'swap' && !a.portion ? ' on' : ''}" data-st="swap">${isMeal ? '다른 걸 먹었어요' : '다른 운동을 했어요'}</button>
      <button class="opt${st === 'skip' ? ' on' : ''}" data-st="skip">${isMeal ? '안 먹었어요' : '못 했어요'}</button>
    </div>
    ${isMeal ? `<div id="portionForm"${st === 'swap' && a.portion ? '' : ' hidden'}>
      <label class="f">먹은 양 · 계획 ${item.grams ? item.grams + 'g' : ''} ${item.kcal ?? '–'}kcal</label>
      <div class="seg" id="pChips">${[0.5, 0.75, 1, 1.25, 1.5, 2].map((m) => `<button type="button" data-pm="${m}">×${m}</button>`).join('')}</div>
      <div class="two" style="margin-top:8px">
        <label class="unit-in"><input id="pG" type="number" inputmode="decimal" step="any" value="${(st === 'swap' && a.portion ? a.grams : item.grams) ?? ''}" placeholder="0"><span>g</span></label>
        <label class="unit-in"><input id="pK" type="number" inputmode="decimal" step="any" value="${(st === 'swap' && a.portion ? a.kcal : item.kcal) ?? ''}" placeholder="0"><span>kcal</span></label>
      </div>
      <p class="desc small">그램을 바꾸면 칼로리가 같은 비율로 계산돼요. 칼로리는 직접 고쳐도 돼요.</p></div>` : ''}
    <div id="swapForm"${st === 'swap' && !a.portion ? '' : ' hidden'}>
      <label class="f">${isMeal ? '실제로 먹은 음식' : '실제로 한 운동'}</label>
      <input class="in" id="aName" value="${esc(a.name ?? '')}" placeholder="${isMeal ? '음식 이름을 치면 목록이 나와요 (예: 김밥)' : '예: 실내 자전거'}" autocomplete="off">
      <div class="two" style="margin-top:8px">
        ${isMeal ? `<label class="unit-in"><input id="aG" type="number" inputmode="decimal" value="${a.grams ?? ''}" placeholder="0"><span>g</span></label>`
          : `<label class="unit-in"><input id="aMin" type="number" inputmode="numeric" value="${a.duration ?? ''}" placeholder="0"><span>분</span></label>`}
        <label class="unit-in"><input id="aK" type="number" inputmode="decimal" step="any" value="${a.kcal ?? ''}" placeholder="${isMeal ? '0' : '자동'}"><span>kcal</span></label>
      </div>
      ${isMeal ? `<label class="f">즐겨찾기에서 고르기</label><div class="favpanel" id="aFav">${favChipsHtml()}</div>
        ${foodSearchHtml()}` : ''}
    </div>
    ${isMeal ? '' : `<div id="liftBlock"${st === 'skip' ? ' hidden' : ''}><label class="f">사용 무게 (선택)</label>
      <label class="unit-in"><input id="lfW" type="number" step="0.5" inputmode="decimal" value="${(st === 'swap' ? a.weight : item.weight) ?? ''}" placeholder="맨몸이면 비워 두세요"><span>kg</span></label>
      <div style="margin-top:8px">${feelHtml((st === 'swap' ? a.feel : item.feel) || 'ok')}</div></div>`}
    <div class="err" id="err"></div>
    <button class="btn" id="stSave">저장</button>
    ${st ? '<button class="btn ghost" id="stClear">이 기록 지우기</button>' : ''}`);
  if (!isMeal) wireFeel();
  let pick = st === 'swap' && a.portion ? 'portion' : st || 'done';
  if (isMeal) {
    const kpg = item.grams > 0 && item.kcal != null ? item.kcal / item.grams : null, r1 = (n) => Math.round(n * 10) / 10;
    $('#pChips').onclick = (e) => { const c = e.target.closest('[data-pm]'); if (!c) return; const m = Number(c.dataset.pm); if (item.grams) $('#pG').value = r1(item.grams * m); if (item.kcal != null) $('#pK').value = r1(item.kcal * m); };
    $('#pG').oninput = () => { if (kpg != null) $('#pK').value = r1(Number($('#pG').value || 0) * kpg); };
  }
  sheet.querySelectorAll('[data-st]').forEach((b) => { b.onclick = () => {
    pick = b.dataset.st;
    sheet.querySelectorAll('[data-st]').forEach((x) => x.classList.toggle('on', x === b));
    $('#swapForm').hidden = pick !== 'swap';
    if ($('#portionForm')) $('#portionForm').hidden = pick !== 'portion';
    if ($('#liftBlock')) $('#liftBlock').hidden = pick === 'skip';
  }; });
  const fillFood = (f) => { $('#aName').value = f.name; $('#aG').value = f.grams ?? ''; $('#aK').value = f.kcal ?? ''; };
  if (isMeal) wireFoodSearch(sheet.querySelector('.fs'), fillFood);
  if ($('#aFav')) $('#aFav').onclick = (e) => {
    const c = e.target.closest('.favchip'); if (!c) return;
    const f = favorites[c.dataset.fav]; $('#aName').value = f.name; $('#aG').value = f.grams ?? ''; $('#aK').value = f.kcal ?? '';
  };
  $('#stSave').onclick = async () => {
    let actual = null;
    if (pick === 'portion') {
      const k = num($('#pK').value), g = num($('#pG').value);
      if (k == null) { $('#err').textContent = '칼로리를 입력해주세요.'; return; }
      actual = { name: item.name, grams: g, kcal: k, portion: true }; pick = 'swap';
    } else if (pick === 'swap') {
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
/* ---------------- 오늘 탭: mascot "불꼬마", water / check-in, streak ---------------- */
// Mascot: the user's flame sticker set, redrawn as crisp vector shapes (body / white eyes / ink). Same scale for every face keeps their drawn proportions.
const MASCOT_VEC = {"joy":{"w":237,"h":267,"b":"M164.5 259.3C158.6 258.5 154.5 254.7 152.7 248.3C151.8 245.0 151.5 244.4 150.5 244.0C149.2 243.5 107.4 243.8 106.4 244.3C106.0 244.5 104.6 245.7 103.2 246.9C92.6 256.7 83.4 260.1 75.7 257.2C71.3 255.6 67.6 249.7 63.2 237.4C62.9 236.3 62.1 234.3 61.5 233.0C60.9 231.7 59.9 229.3 59.2 227.6C58.6 226.0 57.1 222.6 56.0 220.1C54.9 217.7 53.7 215.1 53.4 214.4C53.2 213.7 51.4 210.0 49.6 206.1C47.8 202.3 46.0 198.4 45.6 197.5C44.3 194.6 33.3 172.8 30.8 168.4C30.1 167.0 28.0 163.1 26.2 159.6C24.4 156.2 22.0 151.6 20.8 149.4C10.3 129.9 7.3 122.2 7.3 115.9C7.2 108.3 11.3 106.1 22.6 107.5C23.9 107.7 25.6 108.0 26.4 108.3C27.2 108.5 29.1 109.1 30.6 109.5C32.1 109.9 34.2 110.5 35.1 111.0C36.1 111.4 37.3 112.0 37.9 112.2C38.4 112.4 39.9 113.1 41.2 113.8C45.9 116.3 45.4 116.1 46.3 115.6C48.3 114.4 48.4 113.0 47.0 106.8C46.8 105.6 46.2 102.9 45.8 100.8C45.4 98.6 44.8 95.9 44.5 94.8C44.2 93.6 43.9 92.0 43.8 91.2C43.1 87.1 42.5 83.7 42.2 83.1C41.7 81.8 40.8 74.3 40.6 70.3C40.3 62.5 41.3 58.8 44.4 57.2C45.6 56.5 49.2 56.5 51.0 57.1C54.0 58.1 58.3 59.9 62.8 62.0C68.2 64.5 72.1 66.1 73.5 66.1C77.2 66.2 77.8 61.7 76.1 43.8C75.9 41.7 75.6 39.5 75.5 39.0C75.4 38.5 75.2 37.3 75.1 36.4C75.0 34.5 74.3 30.7 73.4 26.9C73.0 25.5 72.7 23.8 72.5 23.0C72.3 22.2 71.9 20.6 71.5 19.3C70.0 14.5 70.0 10.0 71.5 8.6C73.4 6.9 78.9 7.2 83.6 9.3C88.5 11.5 97.2 16.8 101.6 20.3C102.5 21.0 104.2 22.3 105.6 23.3C113.1 28.9 124.0 39.5 129.9 47.0C134.8 53.1 139.2 58.8 141.7 62.0C145.6 67.2 147.3 68.0 149.6 65.7C150.7 64.5 150.8 64.3 152.5 57.1C154.5 48.9 156.1 46.9 160.4 47.7C164.6 48.5 173.9 57.4 177.7 64.4C178.1 65.1 178.9 66.4 179.6 67.4C186.0 77.2 193.3 94.8 195.3 105.4C196.5 111.5 196.8 112.1 197.9 112.4C199.1 112.7 199.8 112.0 202.8 107.6C208.0 99.8 209.6 98.2 212.7 98.0C216.7 97.8 219.9 100.9 223.0 108.0C224.2 110.9 226.8 118.6 226.8 119.6C226.8 119.9 226.9 120.8 227.1 121.6C227.4 122.5 227.7 124.1 227.9 125.4C228.1 126.6 228.4 128.4 228.5 129.2C228.8 130.4 228.9 134.5 228.9 144.4C228.9 158.6 228.9 158.3 227.6 165.3C227.4 166.4 227.1 168.4 226.9 169.8C226.0 174.9 223.0 186.7 221.2 192.1C220.8 193.4 220.3 194.9 220.1 195.6C219.7 197.3 217.7 202.5 216.9 204.4C216.5 205.2 216.0 206.5 215.7 207.2C214.0 212.4 206.5 226.5 202.6 232.1C198.4 238.1 197.2 239.6 192.6 244.6C182.8 255.2 172.9 260.3 164.5 259.3Z","e":"M75.5 193.7C71.0 192.3 69.0 191.1 65.9 187.8C61.6 183.4 60.4 180.3 60.4 173.6C60.4 168.2 60.9 166.4 63.1 163.1C67.6 156.4 72.6 153.5 80.0 153.3C86.8 153.1 90.2 154.5 95.2 159.4C104.5 168.3 102.8 183.5 91.6 191.0C87.2 194.0 80.3 195.1 75.5 193.7ZM184.3 190.7C182.0 190.4 178.9 189.3 177.7 188.4C177.1 188.0 175.9 187.1 175.1 186.6C168.9 182.4 165.5 172.5 167.7 165.5C168.8 162.0 169.0 161.5 170.2 159.7C176.4 150.4 187.0 147.3 196.6 152.0C209.6 158.3 212.4 175.6 202.0 185.1C196.4 190.1 191.6 191.7 184.3 190.7ZM83.0 183.9C91.7 180.8 94.6 169.7 88.4 163.1C84.4 158.8 78.3 157.8 72.6 160.7C69.4 162.3 68.7 163.0 67.1 166.9C62.9 177.0 72.7 187.5 83.0 183.9ZM193.1 181.4C200.3 179.5 204.2 173.3 202.8 166.0C201.5 159.3 194.8 154.8 188.5 156.1C183.6 157.1 179.5 160.6 178.2 164.8C177.3 167.6 177.6 171.9 178.9 174.4C181.4 179.6 187.8 182.7 193.1 181.4ZM46.3 117.1C45.5 116.5 45.6 115.9 46.8 114.9C47.9 113.9 48.2 113.9 48.7 114.8C49.6 116.6 47.9 118.2 46.3 117.1ZM196.9 113.6C196.4 113.1 196.1 112.0 196.5 111.8C196.8 111.6 199.1 112.2 199.4 112.6C199.5 112.7 199.4 113.0 199.2 113.4C198.7 114.1 197.5 114.2 196.9 113.6Z","k":"M131.8 211.9C131.4 211.8 130.3 211.6 129.4 211.5C116.3 209.5 105.4 195.9 104.2 180.1C103.7 173.6 104.1 168.7 105.7 162.9C106.5 159.7 109.7 154.7 112.8 151.9C116.5 148.5 119.4 147.5 124.5 147.9C128.4 148.3 130.4 149.5 135.6 154.5C139.4 158.1 141.8 158.9 149.3 159.1C153.9 159.2 155.1 159.5 157.5 161.2C160.0 163.0 160.5 163.5 161.2 165.0C161.6 165.7 162.2 166.8 162.4 167.4C163.7 169.7 164.3 175.4 163.7 178.0C163.4 178.8 163.2 180.2 163.1 181.0C163.0 181.7 162.8 182.7 162.6 183.1C162.3 183.5 161.7 185.3 161.1 187.1C160.3 189.4 159.6 191.0 158.4 193.0C157.5 194.5 156.5 196.3 156.2 196.9C155.9 197.6 155.1 198.7 154.4 199.5C153.7 200.3 152.6 201.5 152.0 202.2C151.0 203.4 147.1 206.9 145.2 208.3C142.1 210.5 135.1 212.4 131.8 211.9ZM133.0 189.5C133.2 189.4 133.8 189.2 134.2 189.2C137.3 188.6 140.8 183.8 140.9 180.2C140.9 177.7 140.5 177.2 138.4 177.1C136.1 176.9 135.8 177.0 135.0 178.9C133.6 182.0 131.5 184.0 129.6 184.0C127.4 184.0 124.0 181.0 124.0 179.0C124.0 177.3 126.5 174.6 129.7 172.9C131.4 171.9 131.8 171.6 132.1 170.7C134.1 165.8 124.7 166.0 121.5 171.0C116.6 178.7 119.7 187.9 127.9 189.6C129.6 190.0 132.2 189.9 133.0 189.5ZM75.9 185.1C72.8 184.3 68.3 180.8 67.0 178.2C64.4 173.2 64.4 170.0 66.9 165.2C67.5 164.1 71.0 160.5 72.1 159.9C75.3 158.3 75.7 158.2 78.9 158.2C82.0 158.2 82.5 158.3 85.6 159.9C88.0 161.2 91.0 165.0 92.1 168.2C95.3 177.1 85.3 187.5 75.9 185.1ZM187.9 182.2C183.7 181.5 179.2 177.6 177.5 173.3C174.4 165.4 181.0 155.9 190.0 155.1C195.2 154.6 201.6 159.3 203.4 164.6C206.5 174.4 198.0 184.1 187.9 182.2Z"},"sly":{"w":198,"h":267,"b":"M141.5 259.3C135.9 258.5 130.9 254.9 128.5 249.8C127.1 246.9 126.5 246.4 124.5 246.1C121.6 245.8 84.7 246.4 83.8 246.8C82.7 247.4 81.6 248.8 81.2 250.3C78.7 258.7 68.8 261.7 58.9 257.0C57.8 256.5 56.3 255.6 55.6 255.1C54.9 254.6 53.7 253.7 53.0 253.1C51.5 252.0 47.3 246.8 45.5 243.9C43.4 240.4 42.4 240.0 40.7 241.9C37.3 245.9 32.4 250.1 29.9 251.1C22.9 254.0 16.4 245.7 12.3 228.6C11.7 226.3 11.1 223.5 11.0 222.5C10.8 221.5 10.6 219.7 10.4 218.5C7.8 203.2 7.0 175.0 8.5 155.8C8.6 154.0 8.9 150.3 9.0 147.5C9.2 144.7 9.4 141.6 9.5 140.8C9.6 139.9 9.8 137.1 10.0 134.6C10.1 132.2 10.4 129.3 10.6 128.2C10.8 127.2 11.0 125.0 11.1 123.4C11.2 121.7 11.4 118.8 11.6 116.9C12.2 111.7 12.9 104.8 13.4 101.0C13.6 99.1 14.0 95.6 14.2 93.1C14.9 87.1 16.2 76.9 16.6 74.1C16.8 72.9 17.2 70.4 17.5 68.6C18.5 62.2 20.1 57.5 21.8 55.6C25.1 52.1 28.1 53.1 34.7 59.9C43.6 69.1 44.5 70.0 45.6 70.0C46.1 70.0 48.2 68.1 48.7 67.1C49.7 65.2 48.8 47.6 47.3 39.6C47.0 38.2 46.5 35.8 46.2 34.2C46.0 32.7 45.4 30.3 45.0 28.9C43.1 22.4 42.6 17.1 43.7 15.5C44.9 13.9 49.7 13.3 53.4 14.4C54.8 14.8 59.9 17.2 61.7 18.4C62.2 18.7 63.5 19.4 64.5 20.0C69.6 23.0 75.2 26.9 80.1 30.9C81.6 32.1 83.2 33.4 83.7 33.8C87.3 36.6 97.0 46.0 99.8 49.4C100.6 50.4 102.0 52.1 102.9 53.0C103.7 53.9 105.2 55.7 106.2 57.1C107.3 58.5 108.5 60.1 109.1 60.7C109.6 61.3 110.5 62.5 111.2 63.4C115.5 69.5 118.7 72.8 120.6 72.7C123.1 72.7 123.8 71.2 126.4 59.8C126.8 57.8 127.8 55.8 128.8 54.8C132.0 51.8 142.2 58.3 151.0 69.0C156.1 75.1 165.2 90.0 167.7 96.4C168.0 97.1 169.0 99.3 169.9 101.2C172.4 106.8 176.0 116.0 176.7 119.0C176.9 119.6 177.5 121.5 178.0 123.2C179.0 126.5 180.1 130.6 181.2 135.5C181.6 137.1 182.1 138.9 182.3 139.6C182.7 140.7 183.1 142.8 184.0 147.4C184.1 148.1 184.5 150.1 185.0 152.0C185.4 153.9 185.8 156.2 185.9 157.1C186.0 158.1 186.3 160.2 186.6 161.8C187.4 165.6 187.9 169.0 188.1 171.2C188.2 172.3 188.4 173.9 188.6 174.8C188.8 175.7 189.1 177.6 189.2 178.9C189.4 180.3 189.6 182.4 189.8 183.8C190.0 185.3 190.1 191.2 190.1 200.9C190.1 216.6 190.0 218.2 188.7 224.9C188.5 226.2 188.1 228.3 187.9 229.3C186.8 234.5 183.3 242.5 181.1 244.7C177.7 248.0 173.3 247.7 167.9 243.8C164.3 241.2 163.2 241.6 160.6 246.6C157.5 252.8 154.3 256.3 150.0 258.5C149.1 258.9 143.9 259.7 143.0 259.5C142.9 259.4 142.3 259.4 141.5 259.3Z","e":"M81.3 248.4C81.0 247.4 82.4 246.0 83.4 246.3C84.0 246.6 83.8 247.0 82.9 247.9C82.0 248.8 81.6 249.0 81.3 248.4ZM161.8 243.1C161.8 241.3 163.8 240.0 164.8 241.1C165.2 241.7 164.9 242.2 163.6 243.1C162.3 244.0 161.8 244.0 161.8 243.1ZM49.9 205.2C46.6 204.8 42.7 203.0 40.1 200.7C39.6 200.2 38.8 199.6 38.3 199.3C37.5 198.7 34.8 194.8 33.7 192.6C30.7 186.7 31.5 175.7 35.1 173.5C36.0 172.9 36.8 173.0 40.1 173.8C43.2 174.5 43.5 175.1 42.4 177.2C40.8 180.3 40.8 186.2 42.3 189.3C46.0 196.8 56.7 198.1 62.6 191.8C64.5 189.7 65.7 186.3 65.7 183.2C65.8 180.7 66.4 180.5 70.4 181.5C75.0 182.7 75.7 183.5 75.3 187.0C74.8 190.6 71.9 196.4 69.2 198.9C63.5 204.3 57.7 206.2 49.9 205.2ZM142.6 199.9C135.7 198.2 129.4 191.9 127.5 184.8C126.4 180.9 126.9 179.4 129.4 178.8C129.9 178.7 130.9 178.4 131.6 178.3C137.2 176.8 137.8 177.1 138.1 180.6C138.9 191.1 151.5 195.4 159.1 187.9C162.8 184.2 163.6 179.7 161.6 174.0C160.7 171.8 161.3 171.2 164.9 170.6C168.1 170.0 168.9 170.8 169.8 175.1C170.6 179.0 170.4 181.8 168.9 186.3C167.2 191.2 163.5 195.4 157.9 198.6C154.6 200.5 147.4 201.1 142.6 199.9ZM46.2 71.0C45.5 70.6 45.7 70.1 46.9 68.7C48.6 67.0 49.7 67.1 49.0 69.1C48.5 70.5 47.1 71.5 46.2 71.0Z","k":"M101.5 197.1C101.3 197.1 100.3 196.9 99.3 196.7C94.9 196.0 89.7 192.7 86.6 188.4C85.1 186.4 85.2 184.9 87.0 183.4C88.6 182.0 89.7 182.4 92.9 185.5C94.2 186.8 95.4 187.8 95.5 187.8C95.7 187.8 96.2 188.0 96.7 188.4C99.0 189.9 104.1 190.4 107.2 189.5C109.5 188.8 110.9 187.8 113.1 185.4C115.6 182.7 116.1 182.6 118.1 184.5C119.9 186.2 120.0 186.5 119.0 188.5C116.3 194.0 107.5 198.3 101.5 197.1ZM49.5 196.2C46.2 195.0 42.5 191.6 40.9 188.3C39.2 184.5 40.1 178.4 42.8 175.9C44.5 174.3 45.9 174.3 51.5 176.2C52.7 176.6 55.5 177.2 58.5 177.9C59.5 178.1 60.8 178.5 61.3 178.8C61.8 179.0 62.5 179.3 62.8 179.3C65.7 179.3 67.4 182.4 66.4 185.8C64.1 193.9 56.5 198.5 49.5 196.2ZM147.6 192.2C141.6 191.2 136.3 184.2 137.1 178.6C137.5 176.3 138.1 176.0 147.5 174.1C148.5 173.9 149.8 173.5 150.4 173.4C150.9 173.2 152.6 172.8 154.1 172.5C155.6 172.2 157.3 171.8 157.8 171.6C159.3 171.1 159.6 171.2 160.7 172.1C164.5 175.6 164.4 183.0 160.3 187.5C156.7 191.5 152.4 193.1 147.6 192.2Z"},"gusto":{"w":200,"h":267,"b":"M142.3 259.2C137.6 258.4 132.5 254.6 130.2 250.1C129.1 247.9 128.5 247.1 127.4 246.6C126.0 245.8 86.3 246.3 84.8 247.1C83.8 247.6 83.3 248.4 82.9 250.2C81.1 258.2 71.3 261.6 61.8 257.6C56.4 255.3 51.5 250.9 47.9 245.0C46.4 242.5 44.8 240.8 44.1 240.8C43.7 240.8 42.8 241.5 41.5 243.0C34.3 250.8 29.8 253.0 25.6 250.8C20.2 248.0 15.0 239.0 12.1 227.2C11.8 225.8 11.2 223.9 11.0 223.0C10.1 219.9 8.5 209.3 8.0 203.0C7.3 194.0 7.7 176.2 8.9 166.6C9.1 165.0 9.4 162.7 9.5 161.5C10.0 157.7 10.3 155.7 11.1 151.2C11.6 148.8 12.2 145.5 12.5 143.9C12.8 142.2 13.2 140.3 13.4 139.6C13.6 138.9 14.1 136.9 14.6 135.0C17.2 124.8 18.1 121.7 20.9 114.1C28.2 94.0 38.9 75.4 49.4 64.5C57.4 56.2 62.7 53.4 65.6 56.0C66.9 57.2 67.5 59.4 68.5 67.1C68.7 69.3 69.5 70.6 70.9 71.2C73.1 72.1 73.1 72.1 82.9 57.8C84.6 55.2 86.7 52.3 87.4 51.2C88.2 50.2 89.9 47.8 91.3 45.8C95.1 40.5 95.6 39.8 96.7 38.7C97.2 38.1 97.8 37.3 98.0 37.0C98.2 36.6 99.4 35.0 100.7 33.4C113.4 17.4 122.7 10.6 128.0 13.4C129.5 14.2 131.3 17.5 131.7 20.3C131.9 21.3 132.3 23.4 132.6 25.0C133.1 27.7 133.1 28.9 133.3 44.8C133.4 61.9 133.6 64.7 134.4 66.5C136.1 69.9 142.1 67.2 152.1 58.6C153.3 57.6 155.8 55.8 158.9 53.6C166.6 48.2 171.7 48.4 173.5 54.1C174.1 55.9 174.1 56.0 174.3 75.2C174.4 85.9 174.5 94.8 174.6 95.1C174.7 95.6 175.1 98.6 176.0 108.9C176.2 110.4 176.4 112.5 176.6 113.5C177.6 119.0 178.8 125.1 179.3 126.8C179.6 127.8 180.1 129.9 180.4 131.5C180.7 133.0 181.3 135.2 181.6 136.2C181.9 137.3 182.5 139.3 182.8 140.8C183.2 142.2 183.7 143.9 183.9 144.5C184.1 145.0 184.5 147.0 184.9 148.8C185.3 150.6 185.8 152.7 186.0 153.4C186.3 154.1 186.7 156.0 187.0 157.7C187.3 159.3 187.8 161.8 188.1 163.2C188.5 164.7 188.9 166.9 189.0 168.1C189.2 169.3 189.3 170.4 189.4 170.5C189.4 170.6 189.6 171.7 189.7 172.9C189.9 174.1 190.2 176.2 190.5 177.5C190.8 178.8 191.1 181.7 191.2 183.9C191.4 186.1 191.6 188.7 191.8 189.6C192.0 191.8 192.0 211.9 191.8 214.6C191.2 220.3 190.9 222.3 190.5 224.4C190.2 225.6 189.8 227.8 189.5 229.1C186.0 245.7 179.1 250.3 168.5 243.1C166.7 241.9 166.3 241.8 164.7 242.9C163.9 243.4 163.6 243.8 162.3 246.8C159.6 252.8 154.1 258.2 149.8 259.1C147.9 259.5 144.4 259.6 142.3 259.2Z","e":"M163.8 243.1C163.2 241.9 164.8 240.3 166.0 241.0C166.9 241.5 166.6 242.1 165.2 243.0C164.2 243.6 164.1 243.6 163.8 243.1ZM51.6 195.7C43.7 195.0 36.4 189.0 33.5 181.1C31.6 175.7 32.0 174.2 35.1 173.6C37.0 173.3 38.0 174.4 38.5 177.2C38.7 178.9 39.0 179.4 40.5 181.2C43.8 185.3 49.9 186.8 54.8 184.9C59.0 183.2 60.4 181.7 62.0 177.0C62.5 175.5 63.0 174.2 63.0 174.1C63.7 173.6 64.6 173.5 69.3 173.7C74.4 173.8 74.4 173.8 75.1 174.6C76.3 175.8 75.5 180.5 73.4 184.1C68.6 192.5 60.8 196.6 51.6 195.7ZM144.4 193.6C140.7 192.9 135.6 190.2 133.3 187.8C128.9 183.1 125.7 175.2 127.2 172.3C128.0 170.6 128.5 170.5 135.3 170.6C142.3 170.6 142.0 170.5 143.0 173.8C143.7 176.0 144.8 177.8 146.3 179.1C153.4 185.2 164.0 182.0 166.6 172.9C167.1 171.3 167.8 170.6 168.9 170.9C171.0 171.4 170.6 177.7 168.2 181.9C162.7 191.2 154.0 195.5 144.4 193.6ZM69.9 72.7C68.7 71.8 68.1 70.0 68.9 69.7C69.1 69.6 69.6 69.8 70.0 70.1C70.4 70.5 71.1 70.8 71.5 70.9C73.1 71.2 73.3 71.7 72.4 72.6C71.6 73.4 70.8 73.4 69.9 72.7Z","k":"M98.0 193.3C92.3 192.3 89.8 189.6 92.2 187.0C93.4 185.6 94.4 185.3 97.4 185.8C101.6 186.3 103.7 186.2 105.1 185.4C107.5 184.0 107.8 183.1 106.5 181.2C104.9 178.8 104.9 177.0 106.5 175.4C108.7 173.3 111.2 174.5 113.3 178.6C114.1 180.2 116.3 182.5 118.4 183.8C122.3 186.3 123.1 188.2 121.0 190.3C119.9 191.4 119.7 191.5 118.6 191.5C117.4 191.5 117.2 191.4 114.8 189.8C112.9 188.4 112.7 188.4 111.3 189.4C106.5 192.8 105.4 193.3 101.4 193.4C99.9 193.4 98.3 193.4 98.0 193.3ZM46.6 186.0C43.9 185.1 43.1 184.6 40.7 182.1C37.4 178.5 36.4 175.6 38.1 173.9C38.9 173.0 38.9 173.0 50.4 173.0C61.8 173.0 61.8 173.0 62.7 173.8C63.7 174.9 63.7 174.9 62.9 177.2C62.0 179.7 61.6 180.4 59.0 182.8C55.2 186.5 51.0 187.6 46.6 186.0ZM150.5 182.4C144.5 179.9 140.1 173.3 142.7 170.7C143.5 170.0 143.5 170.0 154.6 170.0C165.8 170.0 165.8 170.0 166.7 170.9C167.8 172.0 167.7 173.2 166.3 175.7C163.1 181.5 155.8 184.6 150.5 182.4Z"},"confusion":{"w":199,"h":261,"b":"M62.9 252.5C57.4 251.0 51.7 245.5 48.1 238.4C46.1 234.3 45.1 234.1 42.2 237.0C37.6 241.5 33.3 242.2 28.1 239.4C21.0 235.7 17.3 229.9 14.1 217.6C13.8 216.2 13.4 214.7 13.2 214.2C13.0 213.8 12.7 212.6 12.5 211.7C12.2 209.9 11.4 206.4 10.7 203.7C10.5 202.6 10.1 200.4 10.0 198.8C9.9 197.2 9.7 195.4 9.5 194.7C9.4 194.1 9.2 191.9 9.0 189.7C8.9 187.6 8.6 184.8 8.5 183.5C8.0 178.8 8.8 158.3 9.6 157.0C9.7 156.9 9.9 155.5 10.0 153.9C10.1 152.4 10.5 150.2 10.7 149.0C11.3 146.7 11.9 143.7 12.3 141.4C12.5 139.8 12.7 139.0 15.4 129.5C17.4 122.3 17.2 123.0 18.9 118.1C19.7 115.9 20.5 113.4 20.8 112.5C21.1 111.6 21.6 110.4 21.9 109.8C22.2 109.1 22.9 107.5 23.4 106.1C25.2 101.1 30.7 90.6 35.2 83.4C43.3 70.5 55.3 56.0 62.0 50.9C70.3 44.7 74.7 44.1 77.1 48.9C78.1 50.8 78.1 50.8 78.2 56.4C78.4 62.2 78.4 62.4 79.7 63.5C81.1 64.9 82.2 64.5 84.0 62.2C84.6 61.5 85.6 60.2 86.3 59.3C87.0 58.4 88.1 57.0 88.6 56.2C90.4 53.7 96.0 46.8 100.7 41.4C113.0 27.4 127.6 16.4 141.1 11.0C151.6 6.9 157.9 6.2 159.4 9.1C160.1 10.2 160.0 15.5 159.4 17.6C159.1 18.4 158.7 20.0 158.4 21.1C158.2 22.2 157.7 24.2 157.3 25.5C157.0 26.8 156.4 29.3 156.0 31.1C155.6 32.9 154.9 35.4 154.6 36.8C154.3 38.1 153.8 40.5 153.5 42.2C153.2 44.0 152.7 46.3 152.5 47.5C151.3 52.7 150.9 56.3 150.6 62.0C150.4 66.3 150.5 66.8 152.0 68.1C153.8 69.6 154.9 68.9 167.4 58.5C179.3 48.6 185.6 47.3 190.0 53.9C192.3 57.4 192.1 65.8 189.4 85.2C189.2 86.7 188.8 91.5 188.5 95.9C188.2 100.3 187.9 105.2 187.8 106.9C187.1 115.1 187.3 133.9 188.1 147.2C188.8 157.6 189.3 164.3 189.5 166.1C189.8 168.1 190.4 174.3 190.8 177.6C190.9 178.9 191.1 183.6 191.2 188.2C191.4 192.9 191.5 197.6 191.6 198.8C191.7 201.8 191.3 214.8 191.0 218.8C190.3 227.4 188.3 234.9 185.6 238.8C181.1 245.5 172.0 244.1 162.6 235.4C159.9 233.0 158.6 233.7 156.9 238.9C155.6 243.0 155.0 244.1 153.3 246.4C149.9 251.0 146.6 252.6 140.9 252.9C133.1 253.3 126.6 249.5 121.0 241.4C118.8 238.1 120.7 238.4 102.8 238.1C84.3 237.8 85.9 237.6 84.5 240.6C82.6 244.8 80.0 248.1 77.1 250.0C73.2 252.6 66.9 253.7 62.9 252.5Z","e":"M44.5 235.2C43.9 234.6 43.9 234.1 44.5 233.5C45.2 232.8 45.6 232.9 46.2 233.7C47.5 235.2 46.0 236.6 44.5 235.2ZM157.8 235.6C157.2 235.3 157.6 233.2 158.3 232.7C159.1 232.2 160.5 232.8 160.5 233.5C160.5 234.1 158.3 235.8 157.8 235.6ZM144.3 200.9C138.4 199.4 135.8 197.8 132.2 193.8C125.9 186.7 124.8 176.5 129.5 168.6C137.7 154.9 156.4 153.9 165.9 166.6C170.9 173.2 171.6 182.4 167.6 189.6C166.0 192.4 162.6 196.5 161.1 197.3C160.7 197.5 159.8 198.0 159.1 198.5C155.3 200.9 148.7 202.0 144.3 200.9ZM152.7 191.1C159.0 188.4 162.1 181.7 159.9 175.3C156.5 165.3 142.1 164.1 137.3 173.4C133.4 180.9 136.9 189.0 145.1 191.7C146.9 192.2 150.6 192.0 152.7 191.1ZM54.9 174.2C42.1 172.4 33.4 160.2 36.1 148.0C37.8 140.3 43.4 134.3 51.3 131.6C63.1 127.6 76.7 136.1 78.9 148.9C81.0 161.0 72.6 172.3 60.2 174.1C57.3 174.5 57.1 174.5 54.9 174.2ZM61.9 163.7C71.9 160.6 73.4 145.6 64.1 141.2C59.4 139.0 56.2 139.0 51.6 141.3C47.3 143.5 44.5 149.8 45.8 154.6C47.9 162.2 54.6 166.0 61.9 163.7ZM79.3 65.1C78.4 64.7 77.9 62.5 78.7 62.5C79.3 62.5 81.1 64.4 80.9 64.8C80.8 65.1 79.8 65.3 79.3 65.1Z","k":"M147.0 192.8C137.5 191.4 131.9 181.2 136.4 173.5C138.6 169.8 141.6 167.3 144.5 166.8C145.3 166.7 146.2 166.4 146.6 166.3C147.6 165.9 148.5 165.9 151.1 166.6C158.0 168.4 162.2 174.5 161.2 181.5C160.9 183.8 160.9 183.9 159.4 186.1C156.4 190.6 151.1 193.5 147.0 192.8ZM118.0 178.4C117.9 178.3 117.0 178.1 116.0 178.0C115.0 177.9 113.1 177.4 111.8 177.0C110.4 176.6 108.2 175.9 106.8 175.6C103.2 174.9 96.4 173.0 95.4 172.6C94.1 172.1 91.3 171.2 90.1 171.0C88.4 170.7 85.3 169.3 84.4 168.5C82.8 167.0 82.6 165.7 83.9 164.3C85.7 162.3 86.6 162.3 94.5 164.9C95.8 165.4 98.3 166.1 100.4 166.6C101.2 166.9 102.7 167.2 103.6 167.5C104.6 167.8 106.4 168.2 107.8 168.5C109.1 168.8 110.9 169.3 111.8 169.5C113.6 170.1 116.0 170.7 118.0 171.1C120.6 171.7 122.8 173.5 122.8 175.1C122.8 176.4 118.7 179.2 118.0 178.4ZM54.3 164.7C51.0 163.5 47.9 161.0 46.0 157.5C44.4 154.7 44.3 149.7 45.9 146.6C48.6 141.2 54.6 137.8 59.9 138.7C65.4 139.7 70.3 144.7 71.1 150.1C72.4 159.4 63.0 167.5 54.3 164.7Z"},"watching":{"w":200,"h":261,"b":"M64.7 252.4C57.5 251.2 51.3 246.5 46.2 238.5C45.2 236.8 44.1 235.1 43.9 234.8C43.0 233.6 42.0 234.1 37.4 238.7C32.5 243.7 30.3 245.0 27.0 245.0C24.3 245.0 23.3 244.5 21.2 242.3C17.1 237.9 14.0 231.2 11.8 221.9C10.3 215.7 9.4 210.6 8.3 200.2C7.3 191.8 7.3 173.6 8.3 165.9C8.5 164.4 8.8 162.2 8.9 161.0C9.0 159.8 9.2 158.0 9.4 156.9C9.6 155.8 9.8 154.0 9.9 152.9C10.0 151.8 10.3 149.9 10.5 148.6C10.8 147.4 11.0 146.0 11.0 145.5C11.0 145.0 11.2 144.0 11.4 143.2C11.6 142.5 11.9 140.9 12.0 139.8C12.2 138.6 12.4 137.0 12.6 136.1C13.4 132.8 14.2 128.7 14.8 126.0C15.2 123.6 16.5 118.0 19.3 106.8C19.8 104.6 20.9 100.8 23.1 93.2C29.9 69.7 40.1 49.8 46.6 47.4C48.9 46.5 50.2 47.3 52.5 50.8C57.4 58.3 61.0 62.3 62.9 62.3C65.4 62.2 65.7 61.2 71.4 39.8C71.8 37.9 72.4 36.0 72.6 35.5C72.8 35.0 73.3 33.6 73.6 32.2C74.9 27.7 77.9 21.1 79.8 18.6C83.9 13.1 89.2 16.0 97.4 28.4C99.7 31.8 100.5 33.1 103.6 38.4C104.1 39.3 105.0 40.8 105.5 41.6C106.0 42.5 107.1 44.3 107.9 45.8C110.4 50.4 114.5 56.8 116.5 59.4C118.2 61.4 120.7 62.8 121.9 62.3C123.3 61.7 124.7 58.4 128.9 45.9C130.8 40.2 133.7 35.9 136.1 35.3C140.0 34.2 147.3 42.5 155.7 57.7C157.7 61.2 162.4 70.8 163.5 73.4C163.9 74.5 164.8 76.3 165.4 77.5C166.0 78.7 166.6 80.2 166.9 81.0C167.1 81.8 167.6 83.0 168.0 83.8C168.4 84.5 168.8 85.6 169.0 86.1C169.2 86.7 169.6 87.9 170.0 88.8C170.6 90.1 172.6 95.1 174.6 100.4C175.3 102.0 177.4 107.9 178.2 110.4C178.5 111.2 179.8 115.2 181.3 119.4C182.7 123.5 184.1 127.8 184.4 129.0C184.7 130.2 185.3 132.5 185.8 134.1C186.3 135.8 186.8 137.8 186.9 138.5C187.0 139.3 187.4 141.4 187.9 143.2C188.4 145.1 188.9 147.5 189.0 148.6C189.2 149.7 189.5 151.6 189.7 152.8C190.5 156.4 191.0 159.5 191.3 163.4C191.4 165.4 191.7 168.4 191.9 169.9C192.9 177.5 192.9 191.9 192.0 198.8C191.7 200.7 191.4 203.8 191.3 205.6C191.0 208.8 190.2 213.9 189.7 215.2C189.6 215.5 189.3 216.7 189.1 217.9C187.9 225.2 183.9 235.1 181.1 237.9C179.1 240.0 178.1 240.4 175.5 240.4C172.7 240.3 170.0 239.2 167.1 236.9C163.8 234.2 163.0 234.6 160.6 239.6C156.0 249.2 151.5 252.8 144.2 252.8C136.7 252.8 131.5 249.6 128.4 243.3C127.5 241.4 126.7 240.1 126.3 239.8C125.7 239.4 118.6 239.4 93.1 240.0C82.1 240.2 82.1 240.2 80.6 244.5C78.5 250.8 72.6 253.7 64.7 252.4Z","e":"M48.7 197.3C41.4 196.3 33.2 188.5 31.5 180.7C30.7 177.5 30.6 174.7 31.1 172.6C31.3 171.6 31.5 170.4 31.6 169.9C32.3 165.3 37.6 159.0 43.2 156.1C49.0 153.1 57.9 153.3 63.3 156.7C75.0 163.9 78.0 178.1 70.1 188.6C65.1 195.3 57.5 198.4 48.7 197.3ZM143.5 196.5C138.0 195.1 133.4 192.2 130.4 188.2C128.8 186.0 126.8 182.3 126.5 180.8C125.6 175.9 125.6 173.4 126.5 169.2C127.0 167.0 129.5 162.5 131.1 160.8C131.9 160.0 133.0 158.9 133.5 158.3C135.4 156.3 140.5 154.0 144.8 153.4C154.1 151.9 163.9 157.7 167.7 166.8C170.4 173.3 170.2 178.3 166.7 185.0C162.5 193.4 151.9 198.6 143.5 196.5ZM54.6 187.5C62.7 186.2 67.2 177.0 63.4 169.5C59.4 161.6 47.3 160.6 42.5 167.8C40.6 170.6 40.2 171.8 40.2 175.6C40.2 179.4 40.8 180.9 43.1 183.8C45.4 186.7 50.2 188.2 54.6 187.5ZM152.5 186.0C155.6 184.8 157.4 183.1 159.2 179.5C160.6 176.7 160.6 172.4 159.2 169.5C157.7 166.3 156.3 164.7 154.2 163.6C147.2 160.2 140.1 162.5 136.8 169.2C134.6 173.7 135.2 178.3 138.4 182.6C141.2 186.2 147.9 187.9 152.5 186.0ZM62.4 63.2C61.2 62.5 61.2 61.6 62.3 61.8C62.8 61.9 63.4 61.8 63.9 61.6C65.0 61.1 65.5 61.4 64.9 62.3C64.2 63.3 63.2 63.7 62.4 63.2Z","k":"M99.5 191.8C97.0 191.4 95.2 189.7 95.2 187.7C95.2 186.3 97.2 183.8 98.9 183.1C100.1 182.6 103.6 182.6 104.6 183.2C108.4 185.1 109.4 188.0 107.2 190.4C105.7 191.9 103.4 192.3 99.5 191.8ZM49.0 188.3C45.9 187.3 43.5 185.4 40.9 182.0C39.2 179.7 38.5 174.9 39.5 172.1C39.8 171.3 40.0 170.5 40.0 170.2C40.0 168.8 44.3 164.6 47.1 163.2C57.3 158.4 69.3 169.9 64.6 180.0C64.2 180.8 63.8 181.7 63.7 182.0C63.2 183.1 60.6 185.7 58.9 186.7C56.0 188.6 52.0 189.3 49.0 188.3ZM146.2 187.8C142.1 187.0 138.5 184.3 136.1 180.2C134.9 178.1 134.9 178.1 134.9 174.6C134.9 170.3 135.5 168.8 138.4 165.8C144.2 159.6 151.3 159.5 157.1 165.3C160.3 168.5 161.1 170.3 161.1 174.6C161.1 177.7 161.0 177.9 160.4 179.2C157.3 185.1 151.2 188.8 146.2 187.8Z"},"upset":{"w":188,"h":261,"b":"M131.6 252.6C126.9 251.6 122.8 248.4 120.7 244.1C119.8 242.1 119.3 241.4 118.7 241.1C117.8 240.6 80.6 240.8 79.1 241.3C78.0 241.6 77.3 242.5 77.1 243.8C76.9 245.0 76.0 247.0 74.8 248.7C71.7 253.3 62.8 254.2 55.8 250.6C51.6 248.5 48.2 245.3 44.5 239.6C41.4 234.9 41.3 234.9 38.5 237.7C27.2 249.2 15.2 250.0 9.6 239.8C7.5 236.0 6.9 225.8 8.3 216.8C8.4 215.9 8.6 213.6 8.7 211.8C8.9 209.9 9.2 207.1 9.5 205.5C9.7 203.9 10.0 201.8 10.1 200.8C10.2 199.7 10.4 198.3 10.5 197.5C10.6 196.7 10.9 193.5 11.1 190.4C11.5 184.6 11.9 179.8 12.6 173.4C12.8 171.4 13.1 168.7 13.2 167.2C13.4 165.8 13.7 163.4 14.0 162.1C14.2 160.7 14.7 158.1 15.0 156.2C15.3 154.4 15.8 152.1 16.0 151.2C16.3 150.4 16.7 148.5 17.0 147.1C18.4 140.6 22.6 128.6 25.2 123.5C25.8 122.5 26.9 120.3 27.7 118.8C34.7 105.2 48.6 92.6 61.1 88.5C62.1 88.2 63.5 87.7 64.2 87.4C65.7 86.8 68.4 86.1 71.9 85.4C73.0 85.2 74.6 84.8 75.5 84.6C79.1 83.9 91.5 83.2 96.6 83.5C104.4 84.0 112.4 85.7 118.6 88.0C125.1 90.5 125.5 90.6 129.1 92.6C145.1 101.4 157.8 116.0 165.9 135.2C167.4 138.9 167.7 139.6 168.6 141.9C169.1 143.1 169.7 145.0 170.0 146.1C170.3 147.2 170.8 148.9 171.1 149.8C171.9 151.9 174.1 161.0 174.6 164.1C174.8 165.5 175.2 167.3 175.4 168.1C175.8 169.8 176.3 173.1 176.9 179.0C177.1 181.1 177.5 184.1 177.7 185.5C178.4 188.9 178.7 192.4 179.0 198.6C179.2 201.4 179.5 206.1 179.8 209.1C180.8 219.3 180.6 224.3 178.9 233.9C178.0 238.6 176.8 240.2 173.2 241.5C171.2 242.2 169.3 242.1 165.7 241.2C162.5 240.4 161.8 240.1 157.5 237.7C153.6 235.6 153.4 235.7 150.9 240.8C145.9 250.8 140.1 254.4 131.6 252.6Z","e":"M44.8 196.1C36.4 194.5 30.6 189.6 27.4 181.6C25.0 175.7 26.0 167.3 29.6 163.0C30.4 161.9 32.5 161.2 36.2 160.7C37.2 160.6 38.6 160.3 39.1 160.1C39.7 159.9 41.5 159.5 43.2 159.1C45.0 158.8 47.3 158.3 48.4 158.0C59.6 155.4 59.2 155.3 63.3 159.2C74.9 170.3 69.5 190.9 53.8 195.4C51.7 196.0 46.4 196.4 44.8 196.1ZM140.4 191.2C132.1 190.1 124.9 184.7 122.4 177.6C122.1 176.9 121.7 175.8 121.4 175.0C120.6 172.9 120.7 166.8 121.5 164.2C122.8 159.9 123.9 158.0 127.1 154.5C129.9 151.3 131.2 151.1 137.4 152.9C139.2 153.4 141.7 154.0 143.0 154.3C147.9 155.2 159.5 158.1 160.8 158.8C164.6 160.7 165.6 171.8 162.6 178.1C158.3 187.2 149.3 192.4 140.4 191.2ZM49.4 186.0C55.6 184.4 59.3 178.4 58.0 172.0C56.8 166.2 54.2 163.3 48.6 161.9C41.1 159.9 33.2 166.5 33.6 174.4C34.0 182.6 41.3 188.1 49.4 186.0ZM146.9 181.7C153.2 179.6 156.2 173.9 154.9 166.9C153.9 162.1 151.0 159.3 145.1 157.7C139.6 156.2 133.2 160.0 131.1 165.9C127.8 175.5 137.3 185.0 146.9 181.7Z","k":"M43.5 187.1C37.8 185.9 32.8 179.9 32.8 174.3C32.8 169.2 36.3 163.9 41.1 161.8C44.3 160.4 48.3 160.4 51.1 161.9C59.7 166.1 61.9 176.4 55.7 182.8C51.9 186.7 48.1 188.0 43.5 187.1ZM139.4 182.5C132.6 180.2 128.3 173.3 129.8 167.4C132.1 159.1 141.5 154.2 148.2 157.8C154.2 161.0 156.8 165.7 156.0 172.0C155.1 179.5 146.4 185.0 139.4 182.5ZM104.4 168.9C101.5 165.9 100.1 165.0 96.5 163.9C92.0 162.5 86.3 163.9 84.3 166.8C82.3 169.7 80.4 170.6 78.6 169.5C76.1 168.0 76.2 165.7 78.9 162.4C83.0 157.4 90.9 155.1 97.8 156.8C100.0 157.4 101.3 158.0 104.3 159.7C105.7 160.5 110.1 164.7 110.6 165.8C111.8 168.0 110.1 170.7 107.5 170.8C106.1 170.8 106.1 170.8 104.4 168.9Z"},"walk":{"w":207,"h":272,"b":"M79.6 264.6C70.3 263.3 59.1 256.2 52.2 247.2C49.6 243.8 46.0 237.4 44.6 233.9C42.2 227.7 41.6 227.2 39.3 229.3C36.2 232.2 29.4 236.0 25.9 236.8C23.1 237.4 18.6 237.0 16.5 235.9C8.9 232.0 6.8 226.3 7.5 211.5C7.6 208.5 7.9 204.8 8.1 203.1C8.3 201.5 8.7 198.5 8.9 196.4C9.1 194.4 9.3 192.6 9.4 192.5C9.5 192.4 9.6 190.6 9.7 188.4C9.9 186.3 10.1 183.8 10.3 182.9C10.5 181.9 10.8 180.2 10.9 179.1C11.0 178.0 11.2 176.2 11.4 175.1C11.6 174.0 11.9 171.4 12.0 169.3C12.1 167.2 12.3 165.1 12.5 164.5C12.6 163.9 12.8 162.2 13.0 160.9C13.1 159.5 13.4 157.6 13.5 156.8C13.6 155.9 13.9 152.9 14.0 150.1C14.2 147.4 14.4 144.2 14.6 143.0C14.8 141.8 15.1 139.0 15.3 136.8C15.4 134.7 15.6 131.9 15.8 130.8C15.9 129.6 16.1 125.5 16.2 121.8C16.6 112.6 17.0 104.7 17.2 104.2C17.3 104.0 17.4 93.2 17.5 80.2C17.6 66.8 17.8 56.0 18.0 55.2C19.1 48.5 22.4 45.0 27.1 45.3C30.1 45.5 36.2 48.4 40.9 51.9C41.7 52.5 43.0 53.4 43.7 53.9C44.5 54.4 46.0 55.5 47.0 56.2C52.4 60.3 53.5 61.1 55.3 62.0C58.0 63.4 59.5 63.2 60.6 61.0C61.2 59.9 61.1 52.1 60.5 47.5C60.3 45.5 60.0 43.1 59.9 42.1C59.8 41.2 59.6 40.0 59.5 39.5C59.3 39.0 59.1 37.4 58.9 36.0C58.5 33.2 58.0 30.6 56.7 24.0C53.7 9.7 55.5 6.1 64.1 9.2C70.1 11.4 80.0 17.0 83.5 20.1C84.0 20.6 85.2 21.5 86.2 22.3C89.8 25.0 98.4 33.9 101.6 38.1C102.2 38.8 103.6 40.8 104.8 42.4C107.2 45.5 113.6 55.1 116.2 59.5C120.5 66.7 122.1 66.6 125.4 58.8C130.0 48.1 132.6 46.6 138.5 51.3C144.1 55.9 148.6 60.8 156.4 70.9C158.7 73.8 166.0 84.8 168.1 88.4C168.9 89.8 170.1 91.7 170.7 92.8C174.0 98.2 179.6 109.6 182.1 115.9C185.1 123.4 186.9 128.3 188.4 133.7C188.9 135.5 189.4 137.4 189.6 138.1C189.8 138.8 190.0 139.8 190.1 140.4C190.2 140.9 190.5 142.3 190.8 143.4C193.1 153.1 194.0 165.3 193.1 175.5C192.7 180.5 192.2 184.5 191.8 185.6C191.7 185.9 191.3 187.4 190.9 188.9C190.0 192.8 188.7 196.6 187.1 200.1C185.4 203.9 185.4 204.2 186.8 205.7C187.9 206.8 187.9 206.8 189.8 206.8C191.7 206.8 195.1 207.6 197.0 208.6C200.1 210.2 201.0 214.9 199.4 220.8C198.5 224.1 194.3 230.2 190.7 233.3C182.4 240.4 175.6 242.9 168.8 241.2C166.2 240.6 160.9 237.7 159.6 236.3C158.1 234.6 157.0 234.6 153.7 236.6C152.2 237.5 149.9 238.7 148.6 239.3C147.2 239.8 146.0 240.4 145.9 240.5C144.6 241.4 132.2 244.8 129.9 244.8C129.4 244.8 128.6 244.9 128.0 245.1C124.9 246.3 109.4 246.2 101.7 245.1C97.6 244.5 97.0 244.5 96.3 244.7C95.2 245.2 94.7 246.3 95.0 247.8C95.9 252.4 94.6 258.1 92.0 261.1C89.5 263.8 84.6 265.2 79.6 264.6Z","e":"M184.3 207.5C183.4 206.7 184.2 204.2 185.3 204.2C186.0 204.2 188.1 206.3 187.9 206.8C187.6 207.8 185.0 208.3 184.3 207.5ZM73.6 203.8C71.5 203.6 67.0 201.8 64.8 200.4C61.3 198.2 59.7 196.5 57.5 192.7C53.8 186.4 53.8 176.6 57.6 171.0C63.0 162.9 70.2 159.5 79.7 160.5C91.9 161.8 101.1 176.0 97.5 187.9C94.4 198.0 83.8 205.1 73.6 203.8ZM82.1 193.7C94.1 189.8 93.9 173.2 81.8 169.6C78.9 168.8 74.7 169.5 71.8 171.4C65.2 175.6 64.3 184.9 69.9 190.4C73.5 193.9 77.7 195.1 82.1 193.7ZM159.3 185.2C150.5 183.5 143.1 176.3 141.6 168.1C139.5 155.7 147.3 144.2 159.1 142.2C172.5 140.0 184.7 150.3 184.7 163.8C184.7 177.0 172.0 187.7 159.3 185.2ZM168.8 174.6C178.8 172.5 182.2 159.8 174.5 152.9C171.6 150.3 165.9 149.4 161.9 151.0C157.9 152.5 156.0 154.5 154.6 158.6C153.6 161.8 153.5 162.7 154.5 165.8C155.3 168.7 155.8 169.5 157.7 171.3C160.8 174.3 164.8 175.5 168.8 174.6Z","k":"M75.0 194.4C71.2 193.2 67.9 190.2 66.3 186.4C64.9 183.1 65.5 177.5 67.5 174.7C70.6 170.5 74.3 168.4 78.8 168.4C85.5 168.4 92.0 174.8 92.0 181.6C92.0 190.3 83.2 196.9 75.0 194.4ZM119.7 192.3C116.0 191.8 111.7 189.3 108.8 186.1C106.3 183.2 106.2 181.3 108.3 179.4C109.3 178.5 109.3 178.5 110.2 178.9C110.7 179.1 111.1 179.2 111.2 179.2C111.2 179.2 112.2 180.1 113.4 181.2C116.6 184.2 119.1 185.2 123.0 185.2C127.3 185.2 130.1 183.9 131.8 181.2C133.8 178.1 136.1 177.7 138.0 180.3C139.4 182.2 138.8 184.1 135.7 187.3C131.9 191.4 126.4 193.1 119.7 192.3ZM164.0 175.5C160.7 174.9 156.2 171.6 154.6 168.5C151.9 163.2 152.8 157.9 157.1 153.3C161.4 148.8 167.8 147.8 172.9 151.0C175.5 152.6 179.0 156.9 179.0 158.6C179.0 158.9 179.2 159.6 179.5 160.1C180.8 162.8 179.1 168.1 175.7 171.5C172.4 174.9 168.4 176.3 164.0 175.5Z"},"angry":{"w":238,"h":272,"b":"M65.1 264.2C55.4 261.7 43.8 251.5 33.9 236.5C24.9 222.9 18.4 207.8 13.0 187.6C11.2 181.0 9.3 170.5 8.7 163.9C8.6 162.6 8.4 160.6 8.2 159.2C7.7 155.4 7.8 142.9 8.3 138.5C9.5 128.7 9.9 126.3 10.5 124.0C13.1 113.8 16.7 106.8 20.6 104.2C24.7 101.5 28.0 103.4 33.7 112.0C35.4 114.5 36.9 116.5 37.2 116.7C38.7 117.4 40.5 115.6 41.1 113.0C42.4 107.0 45.1 98.3 47.0 93.8C47.4 92.7 48.1 91.0 48.5 90.0C51.4 83.1 58.1 70.8 61.1 67.1C61.6 66.6 62.6 65.2 63.4 64.1C67.3 59.1 72.3 54.7 75.5 53.6C80.4 51.9 82.5 53.8 84.4 61.9C86.5 71.2 87.1 72.5 89.2 72.5C91.1 72.5 93.3 70.3 97.6 64.4C98.7 62.9 100.0 61.2 100.5 60.6C101.0 60.1 102.3 58.5 103.3 57.1C104.3 55.8 106.1 53.5 107.4 52.1C108.6 50.6 110.2 48.8 110.9 47.9C112.9 45.5 123.4 35.3 126.2 33.0C127.7 31.8 129.6 30.3 130.5 29.5C132.9 27.4 138.8 23.1 142.1 21.1C147.3 17.8 148.3 17.3 150.6 16.0C156.4 12.9 163.2 11.8 165.3 13.7C167.2 15.4 167.1 19.3 164.9 27.1C162.9 34.6 161.7 41.6 160.3 54.1C159.8 58.9 159.8 66.6 160.4 68.6C161.5 72.9 163.4 72.8 174.2 67.5C187.5 61.0 192.4 60.4 195.2 65.2C197.1 68.5 197.2 77.8 195.4 85.2C195.2 86.0 195.0 87.2 194.9 88.0C194.7 89.8 194.1 92.8 193.4 96.0C193.0 97.4 192.5 99.9 192.2 101.4C192.0 102.9 191.5 105.2 191.1 106.6C190.8 108.0 190.3 110.1 190.1 111.4C189.5 115.1 189.0 117.8 188.7 118.7C188.4 120.1 188.4 120.6 189.1 121.4C190.0 122.3 190.4 122.2 194.2 120.0C196.0 119.0 197.5 118.2 197.6 118.2C197.8 118.2 198.7 117.8 199.8 117.3C204.1 115.2 209.7 113.6 214.4 113.0C215.6 112.9 217.0 112.6 217.5 112.5C219.5 111.9 224.7 112.8 226.7 114.0C230.2 116.2 231.0 121.6 228.7 128.3C226.4 135.1 223.0 142.2 211.6 163.6C206.6 172.9 200.2 185.4 197.3 191.1C193.7 198.3 188.0 209.9 188.0 210.1C188.0 210.3 187.1 212.1 184.6 217.5C183.7 219.4 182.5 222.1 181.9 223.5C181.3 224.9 180.4 227.0 179.9 228.0C179.5 229.0 179.0 230.2 178.9 230.5C178.8 230.8 178.4 231.7 178.1 232.3C177.8 233.0 177.1 234.5 176.6 235.8C176.2 237.1 175.2 239.5 174.5 241.1C173.8 242.8 172.9 245.0 172.5 246.0C172.1 247.1 171.5 248.5 171.2 249.2C170.8 249.8 170.4 250.8 170.3 251.4C168.5 257.0 164.4 261.7 159.9 263.3C158.5 263.7 153.0 263.7 151.5 263.2C144.7 260.9 139.7 257.8 134.3 252.7C130.4 248.9 132.8 249.2 107.7 249.2C86.2 249.1 86.2 249.1 85.6 249.8C85.3 250.2 85.0 250.8 84.9 251.1C84.1 255.1 83.4 257.0 81.5 259.5C78.2 264.0 71.8 265.8 65.1 264.2Z","e":"M58.2 197.3C50.8 196.8 43.6 191.5 40.3 184.2C38.0 179.2 37.8 171.4 39.9 169.4C40.8 168.4 41.6 168.4 44.6 169.0C48.3 169.8 48.5 170.0 47.9 172.1C46.4 177.8 49.6 184.5 54.9 186.6C57.3 187.6 61.4 187.8 63.9 187.0C68.4 185.7 72.0 181.0 72.0 176.6C72.0 173.2 72.6 172.6 75.8 172.9C81.5 173.4 82.3 174.2 81.7 178.8C81.6 180.2 81.2 181.8 81.0 182.4C80.8 182.9 80.4 183.8 80.3 184.3C79.0 188.1 73.0 193.9 68.0 196.0C65.8 197.0 61.4 197.6 58.2 197.3ZM149.6 191.8C141.4 189.3 135.5 183.3 134.0 176.0C133.1 171.8 133.6 170.9 136.9 170.5C137.9 170.4 138.9 170.2 139.2 170.0C139.4 169.9 140.4 169.7 141.2 169.5C143.7 169.1 144.5 169.8 144.5 172.2C144.5 176.7 148.6 181.6 153.5 183.0C163.3 185.9 172.3 175.7 168.2 166.3C167.4 164.5 167.8 163.0 168.9 163.0C169.1 163.0 170.3 162.8 171.5 162.5C175.2 161.6 176.1 162.9 176.9 169.9C177.7 177.5 172.3 186.4 164.3 190.4C159.9 192.6 154.0 193.1 149.6 191.8ZM188.2 122.8C187.2 121.7 188.0 120.3 189.1 121.1C189.9 121.6 190.2 122.5 189.6 122.9C189.0 123.4 188.8 123.3 188.2 122.8ZM38.2 119.4C36.7 117.8 36.7 117.0 38.3 116.3C38.9 116.0 39.5 115.7 39.6 115.5C39.8 115.2 40.7 115.2 40.9 115.5C41.1 115.8 40.5 118.8 40.1 119.4C39.6 120.2 38.9 120.2 38.2 119.4Z","k":"M94.6 209.5C92.0 208.2 89.8 205.4 88.9 202.5C87.8 198.7 87.8 198.3 88.8 194.2C89.9 189.5 91.2 186.7 94.4 182.3C97.8 177.7 99.3 176.4 105.2 173.4C110.6 170.6 118.5 171.6 123.3 175.6C124.1 176.4 125.4 177.4 126.1 177.9C127.1 178.7 129.0 181.1 129.0 181.6C129.0 181.7 129.4 182.4 129.8 183.1C132.3 186.9 133.0 192.6 131.2 196.0C130.8 196.9 127.8 200.0 126.8 200.5C125.1 201.4 122.4 201.8 117.9 201.9C115.4 201.9 113.0 202.1 112.6 202.2C110.9 202.7 106.4 205.3 104.2 207.0C100.1 210.0 97.2 210.8 94.6 209.5ZM58.9 188.6C53.4 187.4 49.3 184.3 47.5 179.7C46.4 176.6 46.4 172.7 47.7 171.0C49.1 169.0 49.4 168.9 51.7 169.3C52.7 169.6 55.3 169.8 57.2 170.0C59.2 170.1 61.5 170.4 62.2 170.6C63.0 170.8 64.5 171.0 65.6 171.1C72.3 171.7 73.0 172.1 73.0 175.9C73.0 177.5 72.9 178.5 72.7 179.0C72.5 179.3 71.9 180.4 71.5 181.3C69.9 184.5 66.4 187.2 62.4 188.2C60.4 188.7 59.9 188.8 58.9 188.6ZM152.9 183.7C147.5 181.5 143.8 176.7 143.8 172.0C143.8 169.1 144.6 167.8 146.5 167.7C147.0 167.7 147.9 167.5 148.5 167.2C149.1 167.0 149.9 166.8 150.3 166.8C150.8 166.8 151.8 166.5 152.5 166.3C153.3 166.0 154.5 165.7 155.3 165.6C156.0 165.5 158.4 165.0 160.5 164.4C166.1 162.8 166.5 162.8 167.6 163.7C169.7 165.6 170.8 172.0 169.5 174.9C169.2 175.5 169.0 176.2 169.0 176.3C169.0 177.8 164.2 182.3 161.5 183.4C158.9 184.4 155.1 184.5 152.9 183.7Z"},"friendly":{"w":222,"h":272,"b":"M149.2 263.9C143.8 262.0 138.5 258.7 132.2 253.2C128.9 250.3 131.7 250.6 107.1 250.5C82.0 250.3 84.5 250.0 81.9 253.3C76.3 260.8 70.1 264.5 64.4 263.9C58.9 263.2 53.1 257.6 48.5 248.5C46.2 243.8 45.8 243.7 42.2 246.6C35.2 252.0 30.5 252.4 26.1 248.1C19.8 242.0 15.3 231.8 12.0 216.9C11.7 215.5 11.3 213.7 11.1 212.8C10.6 210.7 9.5 203.2 9.2 200.0C9.1 198.6 8.8 196.4 8.6 195.1C7.8 191.2 7.9 152.9 8.7 146.2C9.2 141.6 10.1 133.0 10.4 129.4C10.5 128.4 10.7 126.8 11.0 125.8C11.3 124.7 11.8 122.1 12.1 120.0C12.5 117.9 13.0 115.5 13.3 114.6C13.5 113.8 14.0 112.1 14.2 110.8C16.5 100.3 23.9 83.0 29.8 74.8C33.8 69.1 40.7 63.2 43.4 63.2C46.5 63.2 50.8 69.6 56.8 83.0C58.0 85.6 60.8 88.0 62.3 87.6C63.4 87.4 64.3 86.1 67.6 79.6C69.3 76.3 71.1 72.9 71.6 72.1C72.1 71.3 72.5 70.5 72.5 70.4C72.5 69.1 83.7 50.9 87.7 45.9C96.2 35.0 104.7 27.5 113.5 22.9C123.3 17.9 127.0 18.6 128.5 25.8C129.1 28.3 129.6 34.8 129.3 36.0C128.9 38.0 129.9 51.2 131.0 58.8C132.0 65.1 133.7 71.1 134.9 71.9C137.2 73.4 140.7 72.2 145.4 68.0C146.0 67.5 147.0 66.6 147.8 66.1C148.5 65.5 150.0 64.2 151.2 63.3C161.6 54.7 166.3 53.0 170.1 56.5C172.4 58.6 173.3 60.6 174.6 66.5C175.4 70.0 175.5 72.9 175.5 89.7C175.5 112.0 176.0 118.5 177.7 120.2C179.1 121.6 180.8 121.3 188.0 118.0C206.5 109.6 212.9 109.7 214.3 118.5C215.4 125.8 212.9 134.5 205.6 149.5C199.5 161.9 198.4 164.2 194.9 172.0C193.5 175.1 192.1 178.5 191.3 180.7C190.9 181.8 190.3 183.1 190.1 183.5C189.9 183.9 189.4 185.3 188.9 186.5C188.4 187.8 187.5 190.4 186.8 192.2C186.1 194.1 185.1 196.8 184.6 198.1C184.2 199.5 183.2 202.4 182.4 204.5C181.6 206.6 180.8 209.2 180.5 210.2C180.2 211.3 179.6 212.9 179.2 213.8C178.8 214.7 178.2 216.5 177.8 217.8C177.4 219.1 176.4 221.9 175.7 224.1C174.9 226.3 173.6 230.5 172.7 233.4C171.7 236.3 170.8 239.1 170.6 239.6C163.3 262.3 159.0 267.3 149.2 263.9Z","e":"M55.0 192.8C45.9 191.5 39.4 186.1 36.3 177.6C35.4 175.0 35.2 168.3 36.0 165.4C39.7 152.1 54.9 145.4 67.0 151.7C69.3 152.8 73.6 156.5 74.4 158.0C74.8 158.6 75.5 159.8 76.0 160.6C80.1 166.9 79.8 175.9 75.3 182.9C71.1 189.4 62.0 193.9 55.0 192.8ZM148.5 191.8C130.3 189.0 123.7 165.2 138.0 153.7C145.0 148.1 151.8 147.1 160.4 150.3C165.8 152.4 170.9 157.8 172.9 164.0C173.9 167.2 174.0 173.3 172.9 176.5C169.4 187.2 159.3 193.5 148.5 191.8ZM61.0 182.3C70.6 178.8 72.1 166.1 63.7 160.5C56.9 155.9 47.2 159.1 45.1 166.6C43.9 171.1 43.9 170.8 44.8 173.7C47.0 181.4 53.8 184.9 61.0 182.3ZM156.8 182.7C159.7 182.0 160.3 181.6 162.5 179.3C165.9 175.8 167.0 171.5 165.6 167.4C163.9 162.4 161.8 160.3 156.7 158.8C151.0 157.0 143.4 161.1 142.0 166.6C141.9 167.2 141.6 168.3 141.4 169.0C141.2 169.8 141.1 170.7 141.1 170.9C141.7 174.0 142.4 176.0 143.1 177.1C146.4 182.1 151.3 184.1 156.8 182.7ZM60.9 89.0C60.3 88.8 59.5 88.0 58.9 86.9C58.3 86.0 59.0 85.7 60.0 86.5C60.4 86.8 61.2 87.1 61.6 87.2C63.1 87.4 63.4 88.4 62.1 89.0C61.8 89.1 61.5 89.2 61.4 89.2C61.4 89.2 61.1 89.1 60.9 89.0Z","k":"M152.0 184.0C148.2 183.0 145.7 181.5 143.7 179.1C139.4 173.8 139.4 167.7 143.6 162.5C148.7 156.1 157.5 155.8 163.1 161.6C166.4 165.1 168.1 170.5 166.7 173.6C166.5 174.2 166.2 175.1 166.0 175.7C165.6 177.4 162.2 181.2 160.2 182.3C157.5 183.7 153.8 184.5 152.0 184.0ZM53.1 183.4C39.5 179.0 40.7 160.2 54.7 157.6C61.0 156.4 67.1 160.5 69.5 167.4C70.4 170.2 70.4 171.2 69.5 173.8C66.9 181.6 59.9 185.6 53.1 183.4ZM103.8 178.0C100.5 177.6 97.6 176.6 95.2 174.9C94.6 174.4 93.6 173.8 93.0 173.5C92.5 173.2 91.7 172.6 91.3 172.1C90.9 171.5 90.1 170.7 89.7 170.1C87.6 167.6 88.0 164.9 90.6 163.6C91.7 163.0 92.4 163.3 95.2 166.1C98.1 168.8 99.2 169.5 102.8 170.5C107.6 171.8 112.6 170.4 115.2 167.0C117.7 163.6 120.3 163.4 121.9 166.5C123.5 169.7 115.8 177.2 110.2 177.9C108.2 178.1 105.7 178.1 103.8 178.0Z"}};
const MASCOT_IMG = { noplan: 'confusion', watch: 'watching', friendly: 'friendly', joy: 'walk', party: 'joy', rest: 'gusto', upset: 'upset', worry: 'confusion', stern: 'angry', sly: 'sly' };
function flameImg(mood) {
  const v = MASCOT_VEC[MASCOT_IMG[mood] || 'watching'], k = 0.52;
  return `<svg class="mimg" viewBox="0 0 ${v.w} ${v.h}" width="${Math.round(v.w * k)}" height="${Math.round(v.h * k)}" aria-hidden="true"><path d="${v.b}" fill="#eb4b33" fill-rule="evenodd"/><path d="${v.e}" fill="#fff" fill-rule="evenodd"/><path d="${v.k}" fill="#141414" fill-rule="evenodd"/></svg>`;
}
function streakDays() {
  const has = (d) => { const r = cache[d]; return !!(r && ((r.meals || []).length || (r.exercises || []).length || r.weight != null)); };
  let d = today; if (!has(d)) d = addDays(d, -1);
  let n = 0; while (has(d)) { n++; d = addDays(d, -1); }
  return n;
}
// 큰 덩어리 할 일: 끼니별(아침·점심·저녁·간식) · 운동 · 체중 — 상태: pending / part / good / ok / bad
function homeTasks() {
  const t = cache[today], SC = { done: 1, swap: 0.8, skip: 0 };
  const grade = (arr, extra) => {
    const sts = arr.map(itemStatus), left = sts.filter((x) => !x).length;
    if (left === arr.length) return 'pending';
    if (left) return 'part';
    const sc = sts.reduce((a, x) => a + SC[x], 0) / sts.length;
    return extra && sc < 0.4 ? 'ok' : sc >= 0.85 ? 'good' : sc >= 0.4 ? 'ok' : 'bad';
  };
  const tasks = [];
  const extras = (t?.meals || []).filter((x) => !x.plan);
  MEAL_TYPES.forEach((type) => { const ms = todayPlan.meals.filter((m) => m.type === type); if (ms.length) tasks.push({ label: type, kind: 'meal', st: grade(ms, extras.some((x) => x.type === type)) }); });
  if (todayPlan.exercises.length) tasks.push({ label: '운동', kind: 'ex', st: grade(todayPlan.exercises, false) });
  tasks.push({ label: '체중', kind: 'wt', st: t?.weight != null ? 'good' : 'pending' });
  return tasks;
}
const TK_ICON = { good: '✓', ok: '△', bad: '✕', part: '◐', pending: '○' };
function homeHero(items, doneN, ateKcal, target) {
  const tasks = homeTasks(), total = tasks.length;
  const handled = tasks.filter((x) => !['pending', 'part'].includes(x.st)), allHandled = handled.length === total;
  const mealTasks = tasks.filter((x) => x.kind === 'meal'), exTask = tasks.find((x) => x.kind === 'ex');
  const mealsDone = mealTasks.length > 0 && mealTasks.every((x) => !['pending', 'part'].includes(x.st));
  const bads = tasks.filter((x) => x.st === 'bad'), oks = tasks.filter((x) => x.st === 'ok');
  const score = tasks.reduce((a, x) => a + ({ good: 1, ok: 0.6, bad: 0 }[x.st] ?? 0), 0) / total;
  const over = ateKcal > target + 150, under = mealsDone && ateKcal < Math.max(900, target - 500);
  const pct = handled.length / total, streak = streakDays(), names = (l) => l.map((x) => x.label).join('·');
  const diff = Math.abs(Math.round(ateKcal - target)).toLocaleString();
  let mood, t1, t2, coach;
  if (!items.length) { mood = 'noplan'; t1 = '오늘 플랜이 아직 없어요'; t2 = '아래에서 추천 플랜을 받아 보세요'; coach = '플랜이 있어야 불꼬마도 같이 달릴 수 있어요!'; }
  else if (over) {
    mood = 'upset'; t1 = `목표보다 ${diff}kcal 많이 먹었어요`; t2 = exTask && ['pending', 'part'].includes(exTask.st) ? '남은 운동으로 균형을 맞춰 봐요' : '괜찮아요, 내일 가볍게 맞춰 드릴게요';
    coach = bads.length ? `${names(bads)}도 놓쳤네요. 내일은 둘 다 챙겨요, 약속!` : '하루 이틀은 괜찮아요. 오늘은 걷기 한 번 더 어때요?';
  } else if (allHandled && (bads.length * 2 >= total || score < 0.5)) {
    mood = 'stern'; t1 = `오늘은 ${names(bads) || names(oks)} 못 했어요`; t2 = `${under ? `섭취도 ${diff}kcal 부족해요 · ` : ''}기록은 다 했지만 칭찬은 아껴 둘게요`;
    coach = '쉬는 날도 필요하지만 이틀 연속은 안 돼요. 내일은 하나라도 꼭 해내면 크게 칭찬할게요!'+(under ? ' 굶는 건 답이 아니니 1,300kcal 밑으로는 가지 마요.' : '');
  } else if (allHandled && under) {
    mood = 'worry'; t1 = '너무 적게 먹었어요'; t2 = `목표보다 ${diff}kcal 부족해요`;
    coach = '굶으면 근육이 빠지고 폭식이 와요. 1,300kcal 밑으로는 안 돼요, 내일은 꼭 챙겨 먹어요!';
  } else if (allHandled) {
    if (score >= 0.9) { mood = 'party'; t1 = '오늘 할 일을 모두 해냈어요!'; t2 = '식단도 운동도 균형 잡힌 하루예요'; coach = '소희 회원님, 오늘 정말 멋졌어요. 내일도 이 기세로 가요!'; }
    else if (score >= 0.7) { mood = 'rest'; t1 = '오늘도 수고했어요'; t2 = bads.length ? `못 한 것: ${names(bads)} · 괜찮아요` : '계획과 조금 달랐지만 잘 해냈어요'; coach = '꾸준함이 제일 강력한 무기예요. 못 한 건 내일 가볍게 이어가요.'; }
    else { mood = 'sly'; t1 = '절반은 해냈어요'; t2 = `아쉬운 것: ${names(bads.length ? bads : oks)}`; coach = '나쁘지 않아요! 내일은 아쉬웠던 것부터 먼저 해볼까요?'; }
  } else if (handled.length === 0) { mood = 'watch'; t1 = '오늘도 천천히 시작해 볼까요?'; t2 = `할 일 0/${total} · 기록 탭에서 첫 동그라미부터!`; coach = '첫 동그라미가 제일 어려워요. 가볍게 하나만!'; }
  else if (bads.length) { mood = 'sly'; t1 = `${names(bads)}은 놓쳤지만 아직 안 끝났어요`; t2 = `남은 할 일 ${total - handled.length}개로 만회해요`; coach = '지금부터 하나씩 채우면 충분히 만회돼요!'; }
  else if (pct < 0.5) { mood = 'friendly'; t1 = '좋아요, 시작이 반이에요!'; t2 = `할 일 ${handled.length}/${total}`; coach = '이 페이스 그대로 가요.'; }
  else { mood = 'joy'; t1 = '조금만 더 힘내요!'; t2 = `남은 할 일 ${total - handled.length}개`; coach = '절반 넘게 해냈어요. 마무리만 해요!'; }
  const left = target - ateKcal;
  if (mood === 'party' && !lsGet('diet.fx.' + today)) { try { localStorage.setItem('diet.fx.' + today, '1'); } catch {} setTimeout(burstConfetti, 400); }
  return `<div class="card hero2 scene" data-m="${mood}">
    <div class="confetti" id="confetti" aria-hidden="true"></div>
    <div class="stage"><div class="glow"></div>
      <svg class="ring" viewBox="0 0 200 200" aria-hidden="true"><circle class="bg" cx="100" cy="100" r="90"/><circle class="fg" cx="100" cy="100" r="90" style="stroke-dashoffset:${565 * (1 - pct)}"/></svg>
      <i class="sp a"></i><i class="sp b"></i><i class="sp c"></i><div class="shadow"></div>
      <button type="button" class="mascot" id="mascot" aria-label="불꼬마">${flameImg(mood)}</button></div>
    <p class="msg"><b>${t1}</b><span>${t2}</span></p>
    <div class="tasks">${tasks.map((x) => `<span class="tk tk-${x.st}"><i>${TK_ICON[x.st]}</i>${x.label}</span>`).join('')}</div>
    <div class="chips"><span class="chip">${left >= 0 ? '남은' : '초과'} <b>${Math.abs(Math.round(left)).toLocaleString()} kcal</b></span>${streak > 0 ? `<span class="chip">연속 <b>${streak}일</b></span>` : ''}<span class="chip">할 일 <b>${handled.length}/${total}</b></span></div>
    <div class="pt">${coach}</div></div>`;
}
const confettiColors = ['#f0432c', '#ff8a3d', '#ffc86b', '#3182f6', '#12b886', '#ff6b81'];
function burstConfetti() {
  const box = document.getElementById('confetti'); if (!box || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  box.innerHTML = '';
  for (let i = 0; i < 46; i++) {
    const c = document.createElement('i'); c.style.left = Math.random() * 100 + '%'; c.style.background = confettiColors[i % confettiColors.length];
    c.style.setProperty('--dx', Math.random() * 80 - 40 + 'px'); c.style.setProperty('--rot', Math.random() * 720 - 360 + 'deg');
    c.style.animationDuration = 1.6 + Math.random() * 1.4 + 's'; c.style.animationDelay = Math.random() * 0.5 + 's'; box.appendChild(c);
  }
}
// water cups + mood + back condition, saved on the day's record
const cupMl = () => { try { return Math.min(1000, Math.max(50, Number(localStorage.getItem('diet.cup')) || 250)); } catch { return 250; } };
const waterMl = (r) => { const c = r?.checkin || {}; return c.water_ml != null ? Number(c.water_ml) || 0 : (Number(c.water) || 0) * 250; };
// 하루 물 목표: 체중(×32ml)·키(체표면적) 기반 + 운동 + 커피/술/짠 음식에 따라 추가
function waterPlan() {
  const w = Number(latestWeight()) || 60, r = cache[today] || {};
  let base = w * 32, why = `체중 ${w}kg`;
  if (HEIGHT) { const bsa = Math.sqrt((HEIGHT * w) / 3600); base = (w * 32 + bsa * 1200) / 2; why = `체중 ${w}kg · 키 ${HEIGHT}cm`; }
  let ml = base; const adds = [];
  const exMin = (r.exercises || []).reduce((a, e) => a + (Number(e.duration) || 0), 0);
  if (exMin) { const v = Math.round(exMin * 10); ml += v; adds.push(`운동 ${exMin}분 +${v}`); }
  const names = (r.meals || []).map((m) => m.name || '').join(' ');
  const cnt = (re) => (names.match(re) || []).length;
  const coffee = cnt(/커피|아메리카노|라떼|에스프레소|카푸치노|콜드브루|모카|에너지드링크|콜라/g);
  if (coffee) { const v = Math.min(coffee, 4) * 150; ml += v; adds.push(`커피·카페인 +${v}`); }
  const alc = cnt(/소주|맥주|와인|막걸리|하이볼|칵테일|술/g);
  if (alc) { const v = Math.min(alc, 3) * 250; ml += v; adds.push(`술 +${v}`); }
  if (/라면|짬뽕|국밥|찌개|떡볶이|치킨|피자|햄버거|족발|젓갈|탕|국수/.test(names)) { ml += 200; adds.push('짠 음식 +200'); }
  const goal = Math.min(4000, Math.max(1500, Math.round(ml / 50) * 50));
  return { goal, why: `${why} 기준 ${Math.round(base / 50) * 50}ml${adds.length ? ' · ' + adds.join(' · ') : ''}` };
}
function checkinCard() {
  const ml = waterMl(cache[today]), { goal, why } = waterPlan(), cup = cupMl(), pct = Math.min(100, Math.round((ml / goal) * 100));
  const left = goal - ml;
  return `<div class="card"><div class="card-title">물<span class="sub">${ml.toLocaleString()} / ${goal.toLocaleString()}ml</span></div>
    <div class="wbar${ml >= goal ? ' full' : ''}"><i style="width:${pct}%"></i></div>
    <div class="wwhy">${why}<br>${left > 0 ? `${left.toLocaleString()}ml 더 마시면 목표 달성!` : '오늘 물 목표 달성 💧'}</div>
    ${READONLY ? '' : `<div class="wbtns"><button type="button" class="btn ghost" data-wsub="${cup}">− ${cup}</button><button type="button" class="btn" data-wadd="${cup}">+ ${cup}ml</button><button type="button" class="btn ghost" id="wOpen">직접 입력</button></div>`}</div>`;
}
function openWaterSheet() {
  const r = cache[today], ml = waterMl(r), cup = cupMl();
  openSheet(`<div class="sheet-head"><h2>물 기록</h2></div>
    <p class="desc">컵 크기는 사람마다 달라요. 마신 만큼 적어 주세요.</p>
    <div class="food-actions" style="grid-template-columns:repeat(4,1fr)">${[100, 200, 330, 500].map((n) => `<button type="button" class="btn ghost" data-wadd="${n}">+${n}</button>`).join('')}</div>
    <label class="lbl">오늘 마신 총량</label><label class="unit-in"><input id="wTot" type="number" inputmode="decimal" step="any" value="${ml}"><span>ml</span></label>
    <label class="lbl">한 잔 크기 (＋ 버튼 기본값)</label><label class="unit-in"><input id="wCup" type="number" inputmode="decimal" step="any" value="${cup}"><span>ml</span></label>
    <div class="err" id="err"></div><button class="btn" id="wSave">저장</button>`);
  $('#wSave').onclick = () => {
    const c = Number($('#wCup').value), tot = Number($('#wTot').value);
    if (!(tot >= 0)) { $('#err').textContent = '총량을 확인해 주세요.'; return; }
    try { if (c >= 50) localStorage.setItem('diet.cup', String(Math.round(c))); } catch {}
    closeSheet(); saveCheckin({ water_ml: Math.round(tot) });
  };
}
async function saveCheckin(patch) {
  const r = cache[today] || {}, checkin = { ...(r.checkin || {}), ...patch };
  const rec = { date: today, weight: r.weight ?? null, steps: r.steps ?? null, calories_consumed: r.calories_consumed ?? null, calories_burned: r.calories_burned ?? null, meals: r.meals || [], exercises: r.exercises || [], checkin };
  try { await store.save(rec); cache[today] = { ...r, ...rec }; render(); } catch (e) { alert(authMsg(e)); }
}
function recentFoods() {
  const m = {};
  recs().forEach((r) => (r.meals || []).forEach((f) => { const n = f.planned || f.name; if (!n || !f.kcal) return; const o = m[n] = m[n] || { n, c: 0, d: '', f }; o.c++; if (r.date >= o.d) { o.d = r.date; o.f = f; } }));
  return Object.values(m).sort((a, b) => b.d.localeCompare(a.d) || b.c - a.c).slice(0, 8).map((o) => ({ name: o.n, grams: o.f.grams || 0, kcal: o.f.kcal, cat: '식사' }));
}
function weekReport() {
  const days = (from, n) => Array.from({ length: n }, (_, i) => cache[addDays(from, i)]).filter(Boolean);
  const cur = days(addDays(today, -6), 7), prev = days(addDays(today, -13), 7);
  const avg = (rs, f) => { const v = rs.map(f).filter((x) => x != null && x !== '' && !Number.isNaN(Number(x))).map(Number); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const wC = avg(cur, (r) => r.weight), wP = avg(prev, (r) => r.weight);
  const kc = avg(cur, (r) => r.calories_consumed), st = avg(cur, (r) => r.steps), wt = avg(cur, (r) => (r.checkin && (r.checkin.water_ml != null || r.checkin.water != null) ? waterMl(r) : null));
  const exDays = cur.filter((r) => (r.exercises || []).length).length, exMin = cur.reduce((a, r) => a + (r.exercises || []).reduce((b, e) => b + (Number(e.duration) || 0), 0), 0);
  if (!cur.length) return '';
  const row = (k, v) => `<div class="sum-row"><span class="sum-k" style="width:auto;flex:1">${k}</span><b>${v}</b></div>`;
  return `<div class="card"><div class="card-title">최근 7일 리포트<span class="sub">${dateLabel(addDays(today, -6))} ~ 오늘</span></div>
    ${row('평균 체중', wC != null ? `${wC.toFixed(2)}kg ${wP != null ? `<small style="color:var(--${wC - wP <= 0 ? 'blue' : 'up'})">${wC - wP > 0 ? '+' : ''}${(wC - wP).toFixed(2)}</small>` : ''}` : '–')}
    ${row('평균 섭취', kc != null ? `${Math.round(kc).toLocaleString()} kcal` : '–')}
    ${row('평균 걸음', st != null ? `${Math.round(st).toLocaleString()} 걸음` : '–')}
    ${row('운동한 날', `${exDays}일${exMin ? ` · ${exMin}분` : ''}`)}
    ${row('평균 물', wt != null ? `${Math.round(wt).toLocaleString()}ml` : '–')}</div>`;
}
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
  const ateKcal = Math.round((t?.meals || []).reduce((a, x) => a + (x.kcal || 0), 0));
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
    <button class="link-btn" data-gotab="meals">기록 탭에서 체크하기 ›</button></div>
  ${checkinCard()}
  <div class="card"><div class="card-title">오늘의 운동<span class="sub">${exDone}/${todayPlan.exercises.length} 완료</span></div>
    ${exRows || '<div class="empty">오늘은 쉬는 날이에요</div>'}${exExtraSum}</div>`
    : `<div class="card"><div class="card-title">오늘 플랜이 아직 없어요</div><p class="desc">체중에 맞춰 하루 ${target.toLocaleString()}kcal 식단과 운동 루틴을 만들어 드려요.</p><button class="btn" id="genToday">추천 플랜 받기</button></div>
    ${mealRows || exExtraSum ? `<div class="card"><div class="card-title">오늘 기록<span class="sub">${ateKcal.toLocaleString()} kcal 섭취</span></div>${mealRows}${exExtraSum}</div>` : ''}
    ${checkinCard()}`;
  return `
  <div class="hero">
    <div class="eyebrow">${dailyQuote()}</div>
    <div class="big">${last ? Number(last.weight).toFixed(2) + ' kg' : '체중을 기록해주세요'}</div>
    ${first && last && first !== last ? `<div class="delta ${diff <= 0 ? 'down' : 'up'}">시작 대비 ${diff > 0 ? '+' : ''}${diff.toFixed(2)} kg</div>` : ''}
    ${last ? `<div class="delta">목표 ${GOAL}kg까지 ${Math.max(0, Number(last.weight) - GOAL).toFixed(2)} kg</div>` : ''}
    <button class="pill-btn" id="quickWeight">${t?.weight != null ? '오늘 체중 수정' : '오늘 체중 입력'}</button>
  </div>
  ${homeHero(items, doneN, ateKcal, target)}
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
  let ibCard = `<div class="card"><div class="card-title">인바디</div><div class="empty">아직 인바디 기록이 없어요. 히스토리 탭에서 날짜를 고르고 '+ 인바디'를 눌러 추가하세요.</div></div>`;
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
  return `${weekReport()}<div class="card"><div class="eyebrow">시작일(${dateLabel(START)}) 이후 · ${meta[metric][1]}</div><div class="seg" style="margin-top:12px">${seg}</div>${body}</div>${liftCard}${ibCard}`;
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
    <p class="desc small">동그라미: 계획대로 먹음 · 양·변경: 양이 달랐거나 다른 걸 먹었거나 안 먹었을 때</p>${groups}
    ${xMealsBottom}
    <button class="link-btn" data-fooddate="${mealDate}">+ 계획에 없던 음식 기록하기</button></div>
  <div class="card"><div class="card-title">운동<span class="sub">${['일', '월', '화', '수', '목', '금', '토'][new Date(mealDate + 'T00:00:00').getDay()]}요일 루틴</span></div>
    <p class="desc small">동그라미: 계획대로 함 · 변경: 다른 운동을 했거나 못 했을 때</p>
    ${activityRow(mealDate)}
    ${dayPlan.exercises.map((e, i) => checkRow('exercises', i, e)).join('') || '<div class="empty">쉬는 날이에요</div>'}
    ${exExtraHtml}
    <button class="link-btn" data-exdate="${mealDate}">+ 계획에 없던 운동 기록하기</button></div>`;
}

// searchable exercise list for the 'add exercise' sheet: name|category|sets|reps|minutes
const EX_DB = `
걷기|유산소|||30
빠르게 걷기|유산소|||30
경사 걷기(트레드밀)|유산소|||30
러닝|유산소|||20
조깅|유산소|||30
트레드밀 러닝|유산소|||20
실내 사이클|유산소|||30
자전거(야외)|유산소|||40
스피닝|유산소|||45
수영|유산소|||40
아쿠아로빅|유산소|||40
등산|유산소|||120
하이킹|유산소|||90
계단 오르기|유산소|||15
스텝박스|유산소|||20
줄넘기|유산소|||15
에어로빅|유산소|||40
줌바·댄스|유산소|||40
로잉머신|유산소|||20
일립티컬|유산소|||30
HIIT|유산소|||20
배드민턴|유산소|||60
테니스|유산소|||60
탁구|유산소|||40
축구·풋살|유산소|||60
농구|유산소|||40
골프(라운딩)|유산소|||180
볼링|유산소|||60
푸시업|근력|3|10회|
무릎 푸시업|근력|3|10회|
와이드 푸시업|근력|3|8회|
스쿼트|근력|3|12회|
와이드 스쿼트|근력|3|12회|
점프 스쿼트|근력|3|10회|
월 싯|근력|3|30초|
런지|근력|3|10회|
리버스 런지|근력|3|10회|
불가리안 스플릿 스쿼트|근력|3|8회|
플랭크|근력|3|30초|
사이드 플랭크|근력|3|20초|
버드독|근력|3|10회|
데드버그|근력|3|10회|
글루트 브릿지|근력|3|15회|
힙 쓰러스트|근력|3|12회|
힙 힌지(맨몸)|근력|3|12회|
마운틴 클라이머|근력|3|20회|
버피|근력|3|10회|
크런치|근력|3|15회|
레그 레이즈|근력|3|12회|
바이시클 크런치|근력|3|20회|
슈퍼맨|근력|3|12회|
카프 레이즈|근력|3|15회|
딥스(의자 말고 평행봉)|근력|3|8회|
풀업·턱걸이|근력|3|5회|
레그 프레스 머신|근력|3|12회|
레그 익스텐션|근력|3|12회|
레그 컬|근력|3|12회|
힙 어브덕션 머신|근력|3|15회|
힙 어덕션 머신|근력|3|15회|
체스트 프레스 머신|근력|3|12회|
펙덱 플라이|근력|3|12회|
랫 풀다운|근력|3|12회|
시티드 로우|근력|3|12회|
숄더 프레스 머신|근력|3|12회|
케이블 로우|근력|3|12회|
트라이셉스 푸시다운|근력|3|12회|
바벨 스쿼트|근력|3|8회|
데드리프트|근력|3|6회|
루마니안 데드리프트|근력|3|10회|
벤치프레스|근력|3|8회|
오버헤드 프레스|근력|3|8회|
덤벨 컬|근력|3|12회|
덤벨 숄더 프레스|근력|3|10회|
사이드 레터럴 레이즈|근력|3|15회|
덤벨 로우|근력|3|10회|
덤벨 런지|근력|3|10회|
고블릿 스쿼트|근력|3|12회|
케틀벨 스윙|근력|3|15회|
밴드 로우|근력|3|15회|
엎드려 Y-T 레이즈|근력|3|10회|
요가|스트레칭|||40
필라테스|스트레칭|||50
전신 스트레칭|스트레칭|||10
햄스트링 스트레칭|스트레칭|||5
고관절 스트레칭|스트레칭|||10
목·어깨 스트레칭|스트레칭|||5
허리 스트레칭|스트레칭|||5
폼롤러 마사지|스트레칭|||10
고양이-소 자세|스트레칭|||5
`.trim().split('\n').map((l) => { const [name, category, sets, reps, min] = l.split('|'); return { name, category, sets: sets ? +sets : null, reps: reps || null, duration: min ? +min : null }; });
// recent / frequent exercises of this user (for the default chips)
function recentExercises() {
  const m = {};
  recs().forEach((r) => (r.exercises || []).forEach((e) => { const n = e.planned || e.name; if (!n) return; const o = m[n] = m[n] || { n, c: 0, d: '', e }; o.c++; if (r.date >= o.d) { o.d = r.date; o.e = e; } }));
  return Object.values(m).sort((a, b) => b.d.localeCompare(a.d) || b.c - a.c).slice(0, 8)
    .map((o) => ({ name: o.n, category: o.e.category || '유산소', sets: o.e.sets ?? null, reps: o.e.reps ?? null, duration: o.e.duration ?? null, weight: o.e.weight }));
}
function exSearch(q) {
  const k = foodNorm(q), db = EX_DB.filter((x) => foodNorm(x.name).includes(k)).slice(0, 10);
  const seen = new Set(db.map((x) => x.name)), mine = recentExercises().filter((x) => foodNorm(x.name).includes(k) && !seen.has(x.name));
  return [...mine, ...db].slice(0, 10);
}
// exercise-only entry: adds to the day's record without touching weight, food or the plan
function openExerciseSheet(date) {
  openSheet(`<div class="sheet-head"><h2>${dateLabel(date)} 운동 추가</h2></div>
    <p class="desc small">계획에 없던 운동만 적어요. 칼로리를 비워두면 시간으로 자동 계산해요.</p>
    <input class="in" id="exQ" placeholder="🔍 운동 검색 (예: 푸시업, 러닝, 레그 프레스)">
    <div class="favpanel" id="quick"></div>
    <div id="rows">${exRowEdit({ category: '유산소' })}</div>
    <button class="add" id="add">+ 운동 더 추가</button>
    <div class="err" id="err"></div><button class="btn" id="save">저장</button>`);
  $('#add').onclick = () => $('#rows').insertAdjacentHTML('beforeend', exRowEdit({ category: '유산소' }));
  let shown = [];
  const chipHtml = (x, i) => `<button type="button" class="favchip" data-q="${i}">${esc(x.name)}${x.weight ? ` · ${x.weight}kg` : ''}</button>`;
  const drawQuick = () => {
    const q = $('#exQ').value.trim();
    if (!q) { const rec = recentExercises(); shown = rec.length ? rec : EX_DB.filter((x) => ['걷기', '러닝', '푸시업', '스쿼트', '플랭크', '수영', '요가', '전신 스트레칭'].includes(x.name)); $('#quick').innerHTML = `<div class="desc small" style="margin:0 0 6px">${rec.length ? '최근 한 운동' : '자주 하는 운동'}</div>` + shown.map(chipHtml).join(''); return; }
    shown = exSearch(q); const own = { name: q, category: '유산소', sets: null, reps: null, duration: null };
    $('#quick').innerHTML = shown.map(chipHtml).join('') + `<button type="button" class="favchip" data-q="own">'${esc(q)}' 직접 추가</button>`;
    window.__exOwn = own;
  };
  $('#exQ').oninput = drawQuick; drawQuick();
  $('#quick').onclick = (e) => {
    const b = e.target.closest('[data-q]'); if (!b) return;
    const x = b.dataset.q === 'own' ? window.__exOwn : shown[b.dataset.q];
    const first = $('#rows .exrow'); if (first && !first.querySelector('.f-name').value.trim()) first.remove();
    $('#rows').insertAdjacentHTML('beforeend', exRowEdit({ category: x.category, name: x.name, sets: x.sets, reps: x.reps, duration: x.duration, weight: x.weight }));
    $('#exQ').value = ''; drawQuick();
  };
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
  let cur = guessMealType(date);
  const fmtK = (n) => (Number.isInteger(n) ? n : +n.toFixed(1)).toLocaleString();
  openSheet(`<div class="sheet-head"><h2>${dateLabel(date)} 음식 추가</h2></div>
    <div class="seg scroll" id="mtype">${MEAL_TYPES.map((t) => `<button type="button" data-t="${t}"${t === cur ? ' class="on"' : ''}>${t}</button>`).join('')}</div>
    <div class="food-list-head"><b>먹은 음식 <span id="fcnt">0</span></b></div>
    <div class="empty" id="rowsHint">음식 이름을 치면 목록이 바로 나와요</div>
    <div id="rows" class="rows-compact">${mealRowEdit({ type: cur })}</div>
    <div class="food-actions"><button type="button" class="btn ghost" id="add">＋ 음식 한 줄 더</button><button type="button" class="btn ghost" id="favToggle">☆ 자주 먹는 음식</button></div>
    ${foodSearchHtml()}
    <div class="favpanel" id="favPanel" hidden>${favChipsHtml()}</div>
    <div class="err" id="err"></div>
    <div class="food-foot"><span class="food-tot">합계 <b id="ftot">0</b> kcal</span><button class="btn" id="save">저장</button></div>`);
  const box = $('#rows'), curType = () => cur;
  const upd = () => {
    const rows = [...box.querySelectorAll('.mealrow')];
    $('#fcnt').textContent = rows.filter((r) => r.querySelector('.f-name').value.trim()).length; $('#rowsHint').hidden = true;
    $('#ftot').textContent = fmtK(rows.reduce((a, r) => a + (Number(r.querySelector('.f-kcal').value) || 0), 0));
  };
  new MutationObserver(upd).observe(box, { childList: true });
  box.addEventListener('input', (e) => { // grams → kcal follows the food's kcal-per-gram
    const row = e.target.closest('.mealrow');
    if (row && e.target.classList.contains('f-g') && row.dataset.kpg) row.querySelector('.f-kcal').value = Math.round(Number(e.target.value || 0) * Number(row.dataset.kpg) * 10) / 10;
    upd();
  });
  $('#mtype').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; cur = b.dataset.t; $('#mtype').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); box.querySelectorAll('.sel-type').forEach((sel) => (sel.value = cur)); };
  wireMealRows(box);
  $('#add').onclick = () => { box.insertAdjacentHTML('beforeend', mealRowEdit({ type: cur })); box.lastElementChild.querySelector('.f-name').focus(); };
  wireFavPanel($('#favToggle'), $('#favPanel'), box, curType);
  wireFoodSearch(sheet.querySelector('.fs'), (f) => addFoodRow(box, { type: cur, name: f.name, grams: f.grams, kcal: f.kcal, ui: f.ui }));
  $('#save').onclick = async () => {
    const added = readMealRows(box);
    if (!added.length) { $('#err').textContent = '음식을 하나 이상 담아 주세요.'; return; }
    const r = cache[date] || {};
    const meals = [...(r.meals || []), ...added];
    const rec = { date, weight: r.weight ?? null, steps: r.steps ?? null, calories_consumed: Math.round(meals.reduce((a, m) => a + (m.kcal || 0), 0)) || null, calories_burned: r.calories_burned ?? null, meals, exercises: r.exercises || [] };
    try { await store.save(rec); closeSheet(); await window.__refresh(); } catch (e) { $('#err').textContent = authMsg(e); }
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
// foods that are eaten by count ("텐텐 1개(낱개)", "김밥 1줄") get a base name + unit, so people can type a count
const FOOD_UNITS = ['개', '장', '조각', '꼬치', '칸', '줄', '캔', '병', '잔', '알', '컵', '봉'];
const UNIT_RE = new RegExp(`^(.*?)\\s*1(${FOOD_UNITS.join('|')})(?:\\(낱개\\))?$`);
function unitOf(name) { const m = UNIT_RE.exec(name || ''); return m && m[1] ? { base: m[1].trim(), unit: m[2] } : {}; }
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
`.trim().split('\n').map((l) => { const [name, grams, kcal, cat] = l.split('|'); return { name, grams: +grams, kcal: +kcal, cat, ...unitOf(name) }; });

const SNACKISH = ['간식', '음료', '디저트'];
const foodNorm = (t) => t.toLowerCase().replace(/\s+/g, '');
let customFoods = [], IS_ADMIN = false, MY_UID = null, pendingFoodCount = 0;
const FOOD_CATS = ['식사', '외식', '간식', '음료', '디저트'];
// base list + approved foods + my own pending submissions
function allFoods(approvedOnly) {
  const names = new Set(FOODS.map((f) => f.name));
  const extra = customFoods.filter((f) => !names.has(f.name) && (f.status === 'approved' || (!approvedOnly && f.user_id === MY_UID)))
    .map((f) => ({ name: f.name, pending: f.status === 'pending', grams: Number(f.grams) || 0, kcal: Number(f.kcal), cat: f.cat, ...unitOf(f.name) }));
  return [...FOODS, ...extra];
}
function foodSearchHtml() {
  return `<div class="fs">
    <button type="button" class="fs-addlink">+ 목록에 없는 음식 등록하기</button>
    <div class="fs-add" hidden>
      <input class="in fa-name" maxlength="36" placeholder="음식 이름 (예: 텐텐)">
      <label class="f" style="margin-top:8px">먹는 단위</label>
      <select class="in fa-unit"><option value="">1인분(한 번에 먹는 양)</option>${FOOD_UNITS.map((u) => `<option value="${u}">낱개 · 1${u}</option>`).join('')}</select>
      <div class="two" style="margin-top:8px"><label class="unit-in"><input class="fa-g" type="number" inputmode="decimal" placeholder="1회(1개)당 g"><span>g</span></label><label class="unit-in"><input class="fa-k" type="number" inputmode="decimal" step="any" placeholder="0"><span>kcal</span></label></div>
      <div class="seg scroll fa-cat" style="margin-top:8px">${FOOD_CATS.map((c, i) => `<button type="button" data-c="${c}"${i === 2 ? ' class="on"' : ''}>${c}</button>`).join('')}</div>
      <p class="desc small" style="margin:4px 0 8px">낱개를 고르면 <b>1개당</b> g과 kcal를 적어요. 나중에 개수로 입력할 수 있어요. 관리자가 승인하면 모든 사용자의 검색에 보여요. 승인 전에는 나만 볼 수 있어요.</p>
      <button type="button" class="btn fa-submit">목록에 추가</button><div class="err fa-err"></div>
    </div></div>`;
}
function wireFoodSearch(root, onPick) {
  // let users add foods that are missing from the list (visible to everyone after admin approval)
  const panel = root.querySelector('.fs-add'), fe = root.querySelector('.fa-err'); let cat = '간식';
  root.querySelector('.fs-addlink').onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) { root.querySelector('.fa-name').value = (sheet.querySelector('#aName, #rows .mealrow:last-child .f-name')?.value || '').trim(); root.querySelector('.fa-name').focus(); } };
  root.querySelector('.fa-cat').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; cat = b.dataset.c; root.querySelectorAll('.fa-cat button').forEach((x) => x.classList.toggle('on', x === b)); };
  root.querySelector('.fa-submit').onclick = async () => {
    let name = root.querySelector('.fa-name').value.trim(); const unit = root.querySelector('.fa-unit').value, kc = num(root.querySelector('.fa-k').value), g = num(root.querySelector('.fa-g').value);
    if (name && unit && !unitOf(name).unit) name = `${name} 1${unit}`; // count foods are stored as "<name> 1<unit>" so everyone can type a count
    if (!name) { fe.textContent = '음식 이름을 입력해 주세요.'; return; }
    if (kc == null || kc < 0 || kc > 3000) { fe.textContent = 'kcal를 0~3000 사이로 입력해 주세요.'; return; }
    try {
      let row = await store.foods.add({ name, grams: g, kcal: kc, cat });
      if (IS_ADMIN && row?.id && row.status !== 'approved') { await store.foods.review(row.id, 'approved'); row = { ...row, status: 'approved' }; }
      customFoods.push(row); fe.textContent = ''; panel.hidden = true;
      ['.fa-name', '.fa-g', '.fa-k'].forEach((c) => (root.querySelector(c).value = ''));
      const u = unitOf(name);
      onPick({ name: u.unit ? `${u.base} 1${u.unit}` : name, grams: g ?? 0, kcal: kc, cat, ...(u.unit ? { ui: { base: u.base, unit: u.unit, g: g || 0, k: kc } } : {}) });
      fe.textContent = row.status === 'approved' ? '' : '추가했어요 · 승인되면 모두에게 보여요';
    } catch (e) { fe.textContent = authMsg(e); }
  };
}
/* 음식 이름을 치면 바로 아래에 자동완성 목록(드롭다운)이 나와요 */
const AC_SEL = '.mealrow:not(.exrow) .f-name, #aName';
let acList = [];
function acClose() { document.querySelectorAll('.ac').forEach((x) => x.remove()); }
function acFill(inp, f) {
  const row = inp.closest('.mealrow'), name = f.unit ? `${f.base} 1${f.unit}` : f.name, g = f.grams || '', k = Math.round(f.kcal);
  const set = (el, v) => { if (el) el.value = v; };
  if (row) {
    set(row.querySelector('.f-name'), name); set(row.querySelector('.f-g'), g); set(row.querySelector('.f-kcal'), k);
    if (f.grams > 0) row.dataset.kpg = f.kcal / f.grams; else delete row.dataset.kpg;
    if (f.unit) { row.dataset.ui = encodeURIComponent(JSON.stringify({ base: f.base, unit: f.unit, g: f.grams || 0, k: f.kcal })); row.dataset.n = 1; } else { delete row.dataset.ui; delete row.dataset.n; }
    row.querySelector('.f-kcal').dispatchEvent(new Event('input', { bubbles: true }));
  } else { set(inp, name); set(document.getElementById('aG'), g); set(document.getElementById('aK'), k); }
  acClose();
}
document.addEventListener('input', (e) => {
  const inp = e.target, row = inp.closest?.('.mealrow');
  if (row && !row.classList.contains('exrow') && inp.classList.contains('f-g') && row.dataset.kpg) { row.querySelector('.f-kcal').value = Math.round(Number(inp.value || 0) * Number(row.dataset.kpg) * 10) / 10; return; }
  if (!inp.matches?.(AC_SEL)) return;
  if (row?.dataset.ui) { // 낱개 음식: 이름의 숫자만 바꾸면 개수·g·kcal이 따라와요 (예: 텐텐 5개)
    const u = JSON.parse(decodeURIComponent(row.dataset.ui)), m = inp.value.match(/^(.+?)\s*(\d+(?:\.\d+)?)\s*(\S+)$/);
    if (m && m[1].trim() === u.base && m[3] === u.unit) {
      const n = Number(m[2]); row.dataset.n = n; if (u.g) row.querySelector('.f-g').value = Math.round(u.g * n * 10) / 10; row.querySelector('.f-kcal').value = Math.round(u.k * n * 10) / 10;
      row.querySelector('.f-kcal').dispatchEvent(new Event('input', { bubbles: true })); acClose(); return;
    }
    delete row.dataset.ui; delete row.dataset.n;
  }
  acClose();
  const q = foodNorm(inp.value); if (!q) return;
  const hit = allFoods().map((f) => [f, foodNorm(f.name).indexOf(q)]).filter((x) => x[1] >= 0).sort((a, b) => a[1] - b[1] || a[0].name.length - b[0].name.length).slice(0, 6).map((x) => x[0]);
  if (!hit.length) return;
  acList = hit;
  const box = document.createElement('div'); box.className = 'ac';
  box.innerHTML = hit.map((f, i) => `<button type="button" class="ac-i" data-ac="${i}"><b>${esc(f.unit ? `${f.base} 1${f.unit}` : f.name)}${f.pending ? ' (승인 대기)' : ''}</b><span>${f.grams ? f.grams + 'g · ' : ''}${Math.round(f.kcal)}kcal</span></button>`).join('');
  (row ? row.querySelector('.mealrow-top') : inp).after(box);
});
document.addEventListener('pointerdown', (e) => {
  const it = e.target.closest?.('[data-ac]');
  if (it) { e.preventDefault(); const box = it.closest('.ac'), inp = box.previousElementSibling?.querySelector?.('.f-name') || box.previousElementSibling; acFill(inp, acList[Number(it.dataset.ac)]); return; }
  if (!e.target.closest?.('.ac') && !e.target.matches?.(AC_SEL)) acClose();
}, true);
function addFoodRow(box, v) {
  if (v.ui) { // per-piece food: tapping again adds one more piece to the same row
    const ex = [...box.querySelectorAll('.mealrow[data-ui]')].find((r) => { const u = JSON.parse(decodeURIComponent(r.dataset.ui)); return u.base === v.ui.base && u.unit === v.ui.unit; });
    if (ex) { const n = Number(ex.dataset.n || 1) + 1; ex.dataset.n = n; ex.querySelector('.f-name').value = `${v.ui.base} ${n}${v.ui.unit}`; if (v.ui.g) ex.querySelector('.f-g').value = Math.round(v.ui.g * n * 10) / 10; ex.querySelector('.f-kcal').value = Math.round(v.ui.k * n); return; }
  }
  const rows = box.querySelectorAll('.mealrow'), last = rows[rows.length - 1];
  if (last && !last.querySelector('.f-name').value.trim()) last.outerHTML = mealRowEdit(v); else box.insertAdjacentHTML('beforeend', mealRowEdit(v));
}
function mealRowEdit(v = {}, opts = {}) {
  const on = v.name && isFavorite(v.name);
  const star = opts.star === false ? '' : `<button type="button" class="favstar${on ? ' on' : ''}" title="즐겨찾기에 저장">${on ? '★' : '☆'}</button>`;
  return `<div class="mealrow" data-plan="${v.plan ? 1 : ''}" ${stAttrs(v)}${v.grams > 0 && v.kcal != null ? ` data-kpg="${v.kcal / v.grams}"` : ''}${v.ui ? ` data-ui="${encodeURIComponent(JSON.stringify(v.ui))}" data-n="1"` : ''}>
    <div class="mealrow-top">
      <select class="in sel-type">${MEAL_TYPES.map((t) => `<option${v.type === t ? ' selected' : ''}>${t}</option>`).join('')}</select>
      <input class="in f-name" placeholder="음식명 (치면 목록이 나와요)" autocomplete="off" value="${esc(v.name ?? '')}">
      ${star}<button type="button" class="rm" aria-label="삭제">✕</button>
    </div>
    <div class="mealrow-bottom">
      <label class="unit-in"><input class="f-g" type="number" inputmode="decimal" placeholder="0" value="${v.grams ?? ''}"><span>g</span></label>
      <label class="unit-in"><input class="f-kcal" type="number" inputmode="decimal" step="any" placeholder="0" value="${v.kcal ?? ''}"><span>kcal</span></label>
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
    return items.length ? `<div class="favcat">${c}</div>` + items.map(([f, i]) => `<button type="button" class="favchip" data-fav="${i}">${esc(f.name)}${f.grams ? ` · ${f.grams}g` : ''}${f.kcal != null ? ` · ${f.kcal}kcal` : ''}</button>`).join('') : '';
  }).join('');
}
function wireFavPanel(toggleBtn, panelEl, mealsBox, typeFn) {
  toggleBtn.onclick = () => { panelEl.hidden = !panelEl.hidden; };
  panelEl.onclick = (e) => {
    const c = e.target.closest('.favchip'); if (!c) return;
    mealsBox.insertAdjacentHTML('beforeend', mealRowEdit({ ...favorites[c.dataset.fav], ...(typeFn ? { type: typeFn() } : {}) }));
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
      <label class="unit-in"><input class="f-kcal" type="number" inputmode="decimal" step="any" placeholder="0" value="${v.kcal ?? ''}"><span>kcal</span></label>
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
  <div class="food-actions"><button class="btn ghost" id="addMeal">+ 식사 추가</button><button class="btn ghost" id="favToggle">☆ 즐겨찾기에서 추가</button></div>
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
      calories_consumed: num($('#f-in').value) ?? (meals.length ? Math.round(meals.reduce((a, m) => a + (m.kcal || 0), 0)) : null),
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
  openSheet(`<div class="sheet-head"><h2>${dateLabel(planDate)} 식단 계획</h2></div><div id="rows">${rows}</div>
  <div class="food-actions"><button class="btn ghost" id="add">+ 추가</button><button class="btn ghost" id="favToggle">☆ 즐겨찾기에서 추가</button></div>
  ${foodSearchHtml()}
  <div class="favpanel" id="favPanel" hidden>${favChipsHtml()}</div>
  <div class="err" id="err"></div><button class="btn" id="save">저장</button>`);
  $('#add').onclick = wireMealRows($('#rows'));
  wireFavPanel($('#favToggle'), $('#favPanel'), $('#rows'));
  wireFoodSearch(sheet.querySelector('.fs'), (f) => addFoodRow($('#rows'), { type: SNACKISH.includes(f.cat) ? '간식' : '점심', name: f.name, grams: f.grams, kcal: f.kcal, ui: f.ui }));
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
        <label class="unit-in"><input class="f-kcal" type="number" inputmode="decimal" step="any" placeholder="자동" value="${v.kcal ?? ''}"><span>kcal</span></label>
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

/* ---------------- swipe between weeks on 히스토리 탭 ---------------- */
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
window.__refresh = () => refresh();
(function pullToRefresh() {
  const ind = document.createElement('div'); ind.id = 'ptr'; ind.textContent = '↓ 당겨서 새로고침'; document.body.appendChild(ind);
  let y0 = null, dy = 0, busy = false;
  const atTop = () => (document.scrollingElement?.scrollTop || 0) <= 0 && !document.body.classList.contains('sheet-open');
  addEventListener('touchstart', (e) => { y0 = atTop() && !busy && e.touches.length === 1 ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (y0 == null) return; dy = e.touches[0].clientY - y0;
    if (dy <= 0 || !atTop()) { ind.style.transform = ''; ind.classList.remove('show'); return; }
    const h = Math.min(dy * 0.5, 80); ind.classList.add('show'); ind.style.transform = `translate(-50%,${h - 48}px)`;
    ind.textContent = dy > 130 ? '↑ 놓으면 새로고침' : '↓ 당겨서 새로고침';
  }, { passive: true });
  addEventListener('touchend', async () => {
    if (y0 == null) return; const go = dy > 130; y0 = null;
    if (!go) { ind.classList.remove('show'); ind.style.transform = ''; return; }
    busy = true; ind.textContent = '새로고침 중…'; ind.style.transform = 'translate(-50%,24px)';
    try { await refresh(); } catch {}
    ind.textContent = '완료'; setTimeout(() => { ind.classList.remove('show'); ind.style.transform = ''; busy = false; }, 500);
  }, { passive: true });
})();
async function refresh() { await loadAll(); await loadToday(); if (tab === 'plan') { planData = { meals: await store.meals.get(planDate), exercises: await store.exercises.get(planDate) }; weekStats = await loadWeekStats(planDate); } if (tab === 'meals') await loadDay(); render(); }
function render() {
  const v = $('#view');
  v.innerHTML = { home: viewHome, meals: viewMeals, record: viewRecord, stats: viewStats, plan: viewPlan, settings: viewSettings }[tab]();
  $('#title').textContent = { home: '오늘', meals: '기록', record: '히스토리', stats: '통계', plan: '계획', settings: '설정' }[tab];
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
  const wa = e.target.closest('[data-wadd]'); if (wa && !READONLY) { const add = Number(wa.dataset.wadd); if (document.getElementById('wTot')) closeSheet(); return saveCheckin({ water_ml: Math.max(0, waterMl(cache[today]) + add) }); }
  const ws = e.target.closest('[data-wsub]'); if (ws && !READONLY) return saveCheckin({ water_ml: Math.max(0, waterMl(cache[today]) - Number(ws.dataset.wsub)) });
  if (e.target.closest('#wOpen') && !READONLY) return openWaterSheet();
  const ckb = e.target.closest('[data-ck]'); if (ckb && !READONLY) { const [k, v] = ckb.dataset.ck.split(':'); return saveCheckin({ [k]: (cache[today]?.checkin || {})[k] === v ? null : v }); }
  const mas = e.target.closest('#mascot'); if (mas) { mas.classList.remove('boing'); void mas.offsetWidth; mas.classList.add('boing'); if (mas.closest('[data-m=party]')) burstConfetti(); return; }
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
    const rec = { date, weight: r.weight ?? null, steps: r.steps ?? null, calories_consumed: Math.round(meals.reduce((a, v) => a + (v.kcal || 0), 0)) || null, calories_burned: r.calories_burned ?? null, meals, exercises: r.exercises || [] };
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
  { tab: 'home', sel: TOUR_TAB('meals'), tap: true, title: '기록 탭', text: '오늘 먹을 식단과 할 운동을 체크하고 기록하는 곳이에요. 눌러보세요!' },
  { tab: 'meals', sel: '.check-row .box', title: '체크하기', text: '계획대로 먹거나 운동했다면 동그라미를 눌러 체크해요. 기록에 자동으로 반영돼요.' },
  { tab: 'meals', sel: '.check-row .more', title: '다르게 했을 때', text: '오른쪽 「양·변경」 버튼: 양이 달랐거나 다른 걸 먹었거나 안 먹었을 때, 대신 한 운동이 있을 때 눌러요. 계획은 그대로 남아요.' },
  { tab: 'meals', sel: '[data-fooddate]', tap: true, title: '계획에 없던 음식', text: '간식이나 외식처럼 계획에 없던 음식은 여기서 추가해요. 눌러볼까요?' },
  { sheet: true, title: '음식 추가창', text: '음식 이름을 검색하면 칼로리가 자동으로 채워져요. 0.5배·1.5배로 양도 조절하고, 자주 먹는 음식은 즐겨찾기에서 골라요. (지금은 저장하지 않아도 돼요)' },
  { tab: 'meals', sel: TOUR_TAB('record'), tap: true, title: '히스토리 탭', text: '날짜별 체중·식단·운동과 인바디를 모아보는 곳이에요. 눌러보세요!' },
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
