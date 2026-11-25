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
    favorites: {
      get: async () => ok(await sb.from('users').select('favorites').eq('id', await uid()).maybeSingle())?.favorites || [],
      save: async (list) => ok(await sb.from('users').update({ favorites: list }).eq('id', await uid())),
    },
  };
}

// read-only snapshot used by the shared link (scripts/build_share.py)
const READONLY = !!window.DIET_SHARE;
function shareStore(D) {
  const recs = Object.fromEntries((D.records || []).map((r) => [r.date, r]));
  const deny = async () => { throw new Error('공유 페이지에서는 기록할 수 없어요'); };
  const plan = (f) => ({ get: async (date) => D.plans?.[date]?.[f] || [], save: deny });
  return {
    mode: 'share', label: '공유 보기',
    range: async (from, to) => Object.values(recs).filter((r) => r.date >= from && r.date <= to).sort((a, b) => a.date.localeCompare(b.date)),
    save: deny, remove: deny, meals: plan('meals'), exercises: plan('exercises'),
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
}
const recs = () => Object.values(cache).sort((a, b) => a.date.localeCompare(b.date));
const kcal = (n) => (n == null ? '–' : Number(n).toLocaleString() + ' kcal');

/* ---------------- meals: typed + grouped ---------------- */
const MEAL_TYPES = ['아침', '점심', '저녁', '간식'];
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
function mealRowView(m) {
  const g = m.grams ? `<span class="g">${m.grams}g</span>` : '';
  const favdata = encodeURIComponent(JSON.stringify({ name: m.name, grams: m.grams ?? null, kcal: m.kcal ?? null }));
  const on = isFavorite(m.name);
  return `<div class="li"><div class="li-left"><button type="button" class="favmini${on ? ' on' : ''}" title="즐겨찾기에 저장" data-favitem="${favdata}">${on ? '★' : '☆'}</button><div class="li-name">${esc(m.name)}${g}</div></div><b class="kcal">${m.kcal ?? '–'} kcal</b></div>`;
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
  return p.join(' · ');
}
function exRowView(e) {
  const cat = e.category ? `<span class="tag t-${EX_CATS.indexOf(e.category)}">${esc(e.category)}</span>` : '';
  const kcalTxt = e.kcal != null ? `<span class="g">${e.kcal}kcal</span>` : '';
  return `<div class="li"><div class="li-left"><div>${cat}<span class="li-name">${esc(e.name)}</span>${e.notes ? `<small>${esc(e.notes)}</small>` : ''}</div></div><div class="li-right"><b>${exDetail(e) || '–'}</b>${kcalTxt}</div></div>`;
}

/* ---------------- program: safe auto-plan ---------------- */
// Target: maintenance (~30 kcal/kg) minus 500 → ~0.5 kg/week. Never below 1,300 kcal.
const KCAL_FLOOR = 1300;
function kcalTarget(weight) {
  const w = weight || 68;
  return Math.min(1800, Math.max(KCAL_FLOOR, Math.round((w * 30 - 500) / 10) * 10));
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
let PROGRAM_START = '2026-11-23'; // Monday of program week 1 (progression counts from here). Per user: users.program_start, filled on first login.
const mondayOf = (dateStr) => { const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
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
  return [WARM(gym), ...main, ...BIG3, COOL];
}
function cardioDay(day, gym) {
  const c = {
    2: gym ? { name: '트레드밀 경사 걷기', duration: 40, kcal: 200, notes: '경사 5~7%, 손잡이 잡지 않기. 말은 할 수 있지만 노래는 못 부를 속도' }
      : { name: '빠르게 걷기 (중강도)', duration: 40, kcal: 180, notes: '말은 할 수 있지만 노래는 못 부를 정도 (힘든 정도 5~6/10)' },
    4: gym ? { name: '실내 사이클 인터벌', duration: 35, kcal: 190, notes: '빠르게 3분 + 보통 2분 × 7회' } : { name: '인터벌 걷기', duration: 35, kcal: 170, notes: '빠르게 3분 + 보통 2분 × 7회' },
    6: gym ? { name: '트레드밀 + 사이클', duration: 50, kcal: 230, notes: '25분씩, 대화 가능한 강도' } : { name: '길게 걷기', duration: 50, kcal: 220, notes: '평소보다 조금 빠르게, 쉬지 않고 이어서' },
  }[day];
  return [{ category: '유산소', ...c }, COOL];
}
function exercisesFor(date) {
  const day = new Date(date + 'T00:00:00').getDay(), gym = useGym;
  const list = day === 1 || day === 5 ? strengthDay(date, 'A', gym) : day === 3 ? strengthDay(date, 'B', gym)
    : day === 0 ? [{ category: '유산소', name: '가벼운 산책', duration: 30, kcal: 110, notes: '회복일, 편한 속도로' }, { category: '스트레칭', name: '전신 스트레칭 (회복일)', duration: 15, kcal: 40 }]
    : cardioDay(day, gym);
  return list.map((e) => ({ ...e, done: false }));
}
async function generatePlan(date) {
  const target = kcalTarget(latestWeight());
  await store.meals.save(date, mealsFor(date, target));
  await store.exercises.save(date, exercisesFor(date));
}

/* plan item status: '' (not yet) | done (as planned) | swap (ate/did something else) | skip.
   The planned name/amount/kcal are never modified; what actually happened lives in `actual`
   and is what gets copied into the day's record. */
let todayPlan = { meals: [], exercises: [] };
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
  const rec = { date, weight: r.weight ?? null, steps: r.steps ?? null, calories_consumed: sum || null, calories_burned: r.calories_burned ?? null, meals, exercises };
  await store.save(rec);
  cache[date] = { ...r, ...rec };
}
async function setItemStatus(kind, i, st, actual) {
  const list = dayPlan[kind];
  const { st: _s, actual: _a, done: _d, ...base } = list[i];
  list[i] = { ...base, ...(st ? { st } : {}), done: st === 'done', ...(st === 'swap' && actual ? { actual } : {}) };
  await store[kind].save(mealDate, list);
  await syncRecordFromPlan(mealDate, dayPlan);
  if (mealDate === today) todayPlan = dayPlan;
  render();
}
function togglePlanItem(kind, i) {
  const st = itemStatus(dayPlan[kind][i]);
  if (st === 'swap' || st === 'skip') return openStatusSheet(kind, i);
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
      ${isMeal ? `<label class="f">즐겨찾기에서 고르기</label><div class="favpanel" id="aFav">${favChipsHtml()}</div>` : ''}
    </div>
    <div class="err" id="err"></div>
    <button class="btn" id="stSave">저장</button>
    ${st ? '<button class="btn ghost" id="stClear">체크 해제</button>' : ''}`);
  let pick = st || 'done';
  sheet.querySelectorAll('[data-st]').forEach((b) => { b.onclick = () => {
    pick = b.dataset.st;
    sheet.querySelectorAll('[data-st]').forEach((x) => x.classList.toggle('on', x === b));
    $('#swapForm').hidden = pick !== 'swap';
  }; });
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
      else { const duration = num($('#aMin').value); actual = { name, duration, kcal: num($('#aK').value) ?? estimateExerciseKcal(name, duration) }; }
    }
    closeSheet();
    try { await setItemStatus(kind, i, pick, actual); } catch (e) { alert(e.message); }
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
  const mealRows = MEAL_TYPES.map((type) => {
    const ms = todayPlan.meals.filter((m) => m.type === type); if (!ms.length) return '';
    const sts = ms.map(itemStatus), left = sts.filter((x) => !x).length;
    const planned = ms.reduce((a, m) => a + (m.kcal || 0), 0);
    const ate = ms.reduce((a, m) => a + (actualOf(m, 'meals')?.kcal || 0), 0);
    const [txt, cls] = left === ms.length ? ['아직', 'wait'] : left ? [`${ms.length - left}/${ms.length} 체크`, 'part']
      : sts.every((x) => x === 'done') ? ['계획대로', 'done'] : sts.every((x) => x === 'skip') ? ['안 먹음', 'skip'] : ['다르게 먹음', 'swap'];
    return `<div class="sum-row"><span class="sum-k">${type}</span><span class="pill s-${cls}">${txt}</span><b>${left === ms.length ? '–' : ate.toLocaleString()} <small>/ ${planned.toLocaleString()} kcal</small></b></div>`;
  }).join('');
  const exRows = todayPlan.exercises.map((e) => { const s = itemStatus(e);
    return `<div class="sum-row"><span class="sum-k ex">${esc(e.name)}</span><span class="mark m-${s || 'none'}">${ICON[s]}</span></div>`; }).join('');
  const exDone = todayPlan.exercises.filter((e) => ['done', 'swap'].includes(itemStatus(e))).length;
  const exExtraToday = (t?.exercises || []).filter((x) => !x.plan);
  const exExtraSum = exExtraToday.length ? `<div class="sum-row"><span class="sum-k ex">추가 운동 ${exExtraToday.length}개${exExtraToday.some((x) => x.duration) ? ` · ${exExtraToday.reduce((a, x) => a + (x.duration || 0), 0)}분` : ''}</span><span class="pill s-part">계획 외</span></div>` : '';
  const planCards = items.length ? `
  <div class="card"><div class="card-title">오늘의 식단<span class="sub">${ateKcal.toLocaleString()} / ${target.toLocaleString()} kcal</span></div>
    <div class="bar"><i style="width:${Math.min(100, Math.round((ateKcal / target) * 100))}%"></i></div>${mealRows}
    <button class="link-btn" data-gotab="meals">할일 탭에서 체크하기 ›</button></div>
  <div class="card"><div class="card-title">오늘의 운동<span class="sub">${exDone}/${todayPlan.exercises.length} 완료</span></div>
    ${exRows || '<div class="empty">오늘은 쉬는 날이에요</div>'}${exExtraSum}</div>`
    : `<div class="card"><div class="card-title">오늘 플랜이 아직 없어요</div><p class="desc">체중에 맞춰 하루 ${target.toLocaleString()}kcal 식단과 운동 루틴을 만들어 드려요.</p><button class="btn" id="genToday">추천 플랜 받기</button></div>`;
  return `
  <div class="hero">
    <div class="eyebrow">${dailyQuote()}</div>
    <div class="big">${last ? Number(last.weight).toFixed(2) + ' kg' : '체중을 기록해주세요'}</div>
    ${first && last && first !== last ? `<div class="delta ${diff <= 0 ? 'down' : 'up'}">시작 대비 ${diff > 0 ? '+' : ''}${diff.toFixed(2)} kg</div>` : ''}
    <button class="pill-btn" id="quickWeight">${t?.weight != null ? '오늘 체중 수정' : '오늘 체중 입력'}</button>
  </div>
  ${items.length ? `<div class="card"><div class="card-title">오늘 할 일<span class="sub">${doneN}/${items.length} 완료</span></div><div class="bar"><i style="width:${pct}%"></i></div>
    <p class="desc">${pct === 100 ? '오늘 플랜을 모두 해냈어요! 🎉' : (READONLY ? '할일 탭에서 항목별로 볼 수 있어요.' : '할일 탭에서 체크하면 기록에 자동으로 반영돼요.')}</p></div>` : ''}
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
    try { await store.save(rec); closeSheet(); await refresh(); } catch (e) { $('#err').textContent = e.message; }
  };
}

/* ---------------- InBody ---------------- */
// Entered: weight, fat_pct, smm (skeletal muscle), visceral (level), whr (waist-hip ratio).
// Calculated: fat mass, lean mass, BMR (InBody: 370 + 21.6 × lean mass), BMI (needs height).
let HEIGHT = null; // cm
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
    try { await store.save(rec); closeSheet(); await refresh(); } catch (e) { $('#err').textContent = e.message.includes('inbody') ? '인바디 저장 칸이 아직 없어요. Supabase에서 0004_inbody.sql을 먼저 실행해주세요.' : e.message; }
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
  const rows = recs().filter((r) => r[metric] != null).slice(-30);
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
  return `<div class="card"><div class="eyebrow">최근 30회 기록 · ${meta[metric][1]}</div><div class="seg" style="margin-top:12px">${seg}</div>${body}</div>${ibCard}`;
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
  <div class="card"><div class="eyebrow">운동</div>${(r.exercises || []).map(exRowView).join('') || '<div class="empty">기록된 운동이 없어요</div>'}</div>`;
}

function viewMeals() {
  const r = cache[mealDate] || {};
  const planned = dayPlan.meals.reduce((a, m) => a + (m.kcal || 0), 0);
  const ate = (r.meals || []).reduce((a, m) => a + (m.kcal || 0), 0);
  const groups = MEAL_TYPES.map((type) => {
    const rows = dayPlan.meals.map((m, i) => [m, i]).filter(([m]) => m.type === type);
    return rows.length ? `<div class="mg-label">${type}</div>${rows.map(([m, i]) => checkRow('meals', i, m)).join('')}` : '';
  }).join('');
  const extra = (r.meals || []).filter((m) => !m.plan);
  const exExtra = (r.exercises || []).filter((x) => !x.plan);
  const exExtraHtml = exExtra.length ? `<div class="mg-label">계획 외로 한 운동</div>${exExtra.map(exRowView).join('')}` : '';
  const bar = weekBar(mealDate, 'data-mealdate', 'openMealCal', (d) => d === mealDate ? dayPlan.meals.length > 0 : !!(cache[d]?.meals || []).length);
  if (!dayPlan.meals.length && !dayPlan.exercises.length) return `${bar}
    <div class="card"><div class="card-title">${dateLabel(mealDate)} 계획이 없어요</div><p class="desc">추천 플랜을 받으면 이 날 먹을 식단과 운동이 채워져요.</p>
    <button class="btn" id="genDay">추천 플랜 받기</button></div>
    ${extra.length ? `<div class="card"><div class="card-title">기록한 음식</div>${mealGroupsHtml(extra)}</div>` : ''}
    ${exExtra.length ? `<div class="card"><div class="card-title">기록한 운동</div>${exExtra.map(exRowView).join('')}</div>` : ''}
    <div class="card"><button class="link-btn" style="padding:0" data-fooddate="${mealDate}">+ 음식 기록하기</button><button class="link-btn" style="padding:14px 0 0;display:block" data-exdate="${mealDate}">+ 운동 기록하기</button></div>`;
  return `${bar}
  <div class="card"><div class="card-title">${dateLabel(mealDate)} 식단<span class="sub">${ate.toLocaleString()} / ${planned.toLocaleString()} kcal</span></div>
    <p class="desc small">동그라미: 계획대로 먹음 · ⋯: 다른 걸 먹었거나 안 먹었을 때</p>${groups}
    ${extra.length ? `<div class="mg-label">계획 외로 먹은 음식</div>${extra.map(mealRowView).join('')}` : ''}
    <button class="link-btn" data-fooddate="${mealDate}">+ 계획에 없던 음식 기록하기</button></div>
  <div class="card"><div class="card-title">운동<span class="sub">${['일', '월', '화', '수', '목', '금', '토'][new Date(mealDate + 'T00:00:00').getDay()]}요일 루틴</span></div>
    <p class="desc small">동그라미: 계획대로 함 · ⋯: 다른 운동을 했거나 못 했을 때</p>
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
  $('#rows').onclick = (e) => { if (e.target.classList.contains('rm')) e.target.closest('.exrow').remove(); };
  $('#save').onclick = async () => {
    const added = readExRows($('#rows')).map(({ done, ...x }) => x);
    if (!added.length) { $('#err').textContent = '운동 이름을 입력해주세요.'; return; }
    const r = cache[date] || {};
    const rec = { date, weight: r.weight ?? null, steps: r.steps ?? null, calories_consumed: r.calories_consumed ?? null, calories_burned: r.calories_burned ?? null, meals: r.meals || [], exercises: [...(r.exercises || []), ...added] };
    try { await store.save(rec); closeSheet(); await refresh(); } catch (e) { $('#err').textContent = e.message; }
  };
}

function guessMealType(date) {
  if (date !== today) return '아침';
  const h = new Date().getHours();
  return h < 10 ? '아침' : h < 15 ? '점심' : h < 21 ? '저녁' : '간식';
}
// food-only entry: adds to the day's record without touching weight, steps, exercise or the plan
function openFoodSheet(date) {
  openSheet(`<div class="sheet-head"><h2>${dateLabel(date)} 음식 추가</h2></div>
    <p class="desc small">계획에 없던 음식만 적어요. 다른 기록은 그대로예요.</p>
    <div id="rows">${mealRowEdit({ type: guessMealType(date) })}</div>
    <div class="favrow"><button class="add" id="add">+ 음식 더 추가</button><button class="add" id="favToggle">☆ 자주 먹는 음식에서 추가</button></div>
    <div class="favpanel" id="favPanel" hidden>${favChipsHtml()}</div>
    <div class="err" id="err"></div><button class="btn" id="save">저장</button>`);
  $('#add').onclick = wireMealRows($('#rows'));
  wireFavPanel($('#favToggle'), $('#favPanel'), $('#rows'));
  $('#save').onclick = async () => {
    const added = readMealRows($('#rows'));
    if (!added.length) { $('#err').textContent = '음식 이름을 입력해주세요.'; return; }
    const r = cache[date] || {};
    const meals = [...(r.meals || []), ...added];
    const rec = { date, weight: r.weight ?? null, steps: r.steps ?? null, calories_consumed: meals.reduce((a, m) => a + (m.kcal || 0), 0) || null, calories_burned: r.calories_burned ?? null, meals, exercises: r.exercises || [] };
    try { await store.save(rec); closeSheet(); await refresh(); } catch (e) { $('#err').textContent = e.message; }
  };
}

function viewSettings() {
  return `<div class="card">
    <div class="eyebrow">계정</div><div class="big" style="font-size:17px;margin:6px 0 16px">${esc(accountLabel) || '–'}</div>
    <div class="eyebrow">다이어트 시작일</div>
    <button type="button" class="in daterow" id="startDateBtn" style="margin:6px 0 16px">${dateLabel(START)}<span class="chev">›</span></button>
    <div class="eyebrow">키 (BMI 계산용)</div>
    <button type="button" class="in daterow" id="heightBtn" style="margin:6px 0 16px">${HEIGHT ? HEIGHT + ' cm' : '입력해주세요'}<span class="chev">›</span></button>
    <div class="eyebrow">자주 먹는 음식</div>
    <div class="favcats">${FAV_CATS.map((c) => `<button type="button" class="favcat-btn" data-favcat="${c}"><span>${c}</span><b>${favorites.filter((f) => favCat(f) === c).length}</b></button>`).join('')}</div>
    <button type="button" class="in daterow" id="favManageBtn" style="margin:8px 0 16px">전체 보기·편집 (${favorites.length})<span class="chev">›</span></button>
    <div class="eyebrow">운동 장소</div>
    <div class="seg" style="margin:6px 0 4px"><button class="${useGym ? '' : 'on'}" data-gym="0">집 (맨몸)</button><button class="${useGym ? 'on' : ''}" data-gym="1">헬스장 (머신)</button></div>
    <p class="desc small" style="margin:0 0 16px">추천 플랜을 새로 받을 때부터 적용돼요.</p>
    <div class="eyebrow">모드</div><div style="margin:6px 0 16px">${store?.label || ''}</div>
    ${store?.mode === 'supabase' ? '<button class="btn ghost" id="doLogout">로그아웃</button>' : ''}
  </div>`;
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
function viewPlan() {
  return `<div class="card"><button type="button" class="in daterow" id="planDateBtn">${dateLabel(planDate)}<span class="chev">›</span></button></div>
  ${weekCard()}
  <div class="card"><div class="card-title">추천 플랜<span class="sub">하루 ${kcalTarget(latestWeight()).toLocaleString()}kcal</span></div>
    <p class="desc">체중 기준 주 0.5kg 감량 속도로 맞췄어요. 건강을 위해 ${KCAL_FLOOR.toLocaleString()}kcal 아래로는 내려가지 않아요. 허리에 무리 없는 운동만 넣었어요.</p>
    <button class="btn" data-plan="gen">${dateLabel(planDate)} 추천 플랜으로 채우기</button><button class="btn ghost" data-plan="genweek">앞으로 7일 한 번에 채우기</button></div>
  <div class="card"><div class="card-title">식단<span class="sub">${(planData.meals || []).reduce((a, m) => a + (m.kcal || 0), 0).toLocaleString()} kcal</span></div>${mealGroupsHtml(planData.meals)}<button class="btn ghost" data-plan="meals">식단 편집</button></div>
  <div class="card"><div class="card-title">운동</div>${(planData.exercises || []).map(exRowView).join('') || '<div class="empty">계획된 운동이 없어요</div>'}<button class="btn ghost" data-plan="exercises">운동 편집</button></div>`;
}

/* ---------------- sheet (view / editor) ---------------- */
const sheet = $('#sheet'), bg = $('#sheetBg');
function openSheet(html) {
  sheet.innerHTML = `<div class="sheet-handle"></div>${html}`;
  sheet.style.transform = '';
  sheet.hidden = bg.hidden = false;
}
function closeSheet() { sheet.hidden = bg.hidden = true; sheet.style.transform = ''; }
bg.onclick = closeSheet;
sheet.addEventListener('click', (e) => { const fav = e.target.closest('.favmini'); if (fav) favMiniClick(fav); });

// swipe-down-to-close: dragging the handle always works; dragging the content works
// once it's already scrolled to the top (so it reads as "nothing left to pull").
(() => {
  let startY = null, dragging = false, fromHandle = false;
  sheet.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
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
function mealRowEdit(v = {}, opts = {}) {
  const on = v.name && isFavorite(v.name);
  const star = opts.star === false ? '' : `<button type="button" class="favstar${on ? ' on' : ''}" title="즐겨찾기에 저장">${on ? '★' : '☆'}</button>`;
  return `<div class="mealrow" data-plan="${v.plan ? 1 : ''}">
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
      item.category = type === '간식' ? '간식' : '식사';
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
  <label class="f">식사</label>${mealGroupsHtml(r.meals)}
  <label class="f">운동</label>${(r.exercises || []).map(exRowView).join('') || '<div class="empty">기록된 운동이 없어요</div>'}`);
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
  <label class="f">운동</label><div id="exs">${(r.exercises || []).map((e) => exRowEdit(e)).join('')}</div><button class="add" id="addEx">+ 운동 추가</button>
  <div class="err" id="err"></div>
  <button class="btn" id="save">저장</button>${cache[date] ? '<button class="btn danger" id="del">기록 삭제</button>' : ''}`);
  $('#addMeal').onclick = wireMealRows($('#meals'));
  wireFavPanel($('#favToggle'), $('#favPanel'), $('#meals'));
  $('#addEx').onclick = () => $('#exs').insertAdjacentHTML('beforeend', exRowEdit({ category: '유산소' }));
  $('#exs').onclick = (e) => { if (e.target.classList.contains('rm')) e.target.closest('.exrow').remove(); };
  const doSave = async () => {
    const meals = readMealRows($('#meals'));
    const exercises = readExRows($('#exs')).map(({ done, ...e }) => e);
    const w = num($('#f-weight').value);
    const rec = {
      date, weight: w == null ? null : Math.round(w * 100) / 100, steps: num($('#f-steps').value),
      calories_consumed: num($('#f-in').value) ?? (meals.length ? meals.reduce((a, m) => a + (m.kcal || 0), 0) : null),
      calories_burned: num($('#f-out').value), meals, exercises,
    };
    try { await store.save(rec); closeSheet(); await refresh(); } catch (e) { $('#err').textContent = e.message; }
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
    cells += `<button class="day${date === pickerSelected ? ' sel' : ''}${date === today ? ' today' : ''}" data-pick="${date}"><span class="n">${d}</span></button>`;
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
  <div class="favrow"><button class="add" id="add">+ 추가</button><button class="add" id="favToggle">☆ 즐겨찾기에서 추가</button></div>
  <div class="favpanel" id="favPanel" hidden>${favChipsHtml()}</div>
  <div class="err" id="err"></div><button class="btn" id="save">저장</button>`);
  $('#add').onclick = wireMealRows($('#rows'));
  wireFavPanel($('#favToggle'), $('#favPanel'), $('#rows'));
  $('#save').onclick = async () => {
    try {
      const old = planData.meals || [];
      const meals = readMealRows($('#rows')).map((m) => {
        const o = old.find((x) => x.name === m.name && x.type === m.type);
        return o ? { ...m, ...(o.st ? { st: o.st } : {}), ...(o.actual ? { actual: o.actual } : {}), done: !!o.done } : m;
      });
      await store.meals.save(planDate, meals); closeSheet(); await refreshPlan();
    } catch (e) { $('#err').textContent = e.message; }
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
    try { favorites = readFavRows($('#rows')); await store.favorites.save(favorites); renderFavoritesView(); render(); } catch (e) { $('#err').textContent = e.message; }
  };
  $('#save').onclick = doSave;
  $('#headSaveFav').onclick = doSave;
}
function exRowEdit(v = {}) {
  return `<div class="mealrow exrow" data-done="${v.done ? 1 : ''}" data-plan="${v.plan ? 1 : ''}">
    <div class="mealrow-top"><select class="in sel-cat">${EX_CATS.map((c) => `<option${v.category === c ? ' selected' : ''}>${c}</option>`).join('')}</select>
      <input class="in f-name" placeholder="운동명" value="${esc(v.name ?? '')}"><span></span><button type="button" class="rm" aria-label="삭제">✕</button></div>
    <div class="mealrow-bottom four">
      <label class="unit-in"><input class="f-min" type="number" inputmode="numeric" placeholder="0" value="${v.duration ?? ''}"><span>분</span></label>
      <label class="unit-in"><input class="f-sets" type="number" inputmode="numeric" placeholder="0" value="${v.sets ?? ''}"><span>세트</span></label>
      <label class="unit-in"><input class="f-reps" placeholder="12회" value="${esc(v.reps ?? '')}"></label>
      <label class="unit-in"><input class="f-kcal" type="number" inputmode="numeric" placeholder="자동" value="${v.kcal ?? ''}"><span>kcal</span></label>
    </div>
    <input class="in f-notes" placeholder="메모 (자세, 속도 등)" value="${esc(v.notes ?? '')}" style="margin-top:8px;height:40px;font-size:14px">
  </div>`;
}
function readExRows(box) {
  return [...box.querySelectorAll('.exrow')].map((row) => {
    const q = (c) => row.querySelector(c).value.trim();
    const name = q('.f-name'), duration = num(q('.f-min')), sets = num(q('.f-sets'));
    const e = { category: q('.sel-cat'), name, duration, sets, reps: q('.f-reps') || null, kcal: num(q('.f-kcal')), notes: q('.f-notes') || null, done: !!row.dataset.done, ...(row.dataset.plan ? { plan: true } : {}) };
    if (e.kcal == null) e.kcal = estimateExerciseKcal(name, duration || (sets ? sets * 2 : null)) ?? (e.category === '근력' && sets ? sets * 8 : null);
    return e;
  }).filter((e) => e.name);
}
async function editPlanExercises() {
  const rows = (planData.exercises || []).map((x) => exRowEdit(x)).join('');
  openSheet(`<div class="sheet-head"><h2>${dateLabel(planDate)} 운동 계획</h2></div><div id="rows">${rows}</div><button class="add" id="add">+ 추가</button><div class="err" id="err"></div><button class="btn" id="save">저장</button>`);
  $('#add').onclick = () => $('#rows').insertAdjacentHTML('beforeend', exRowEdit({ category: '유산소' }));
  $('#rows').onclick = (e) => { if (e.target.classList.contains('rm')) e.target.closest('.exrow').remove(); };
  $('#save').onclick = async () => {
    try {
      const exercises = readExRows($('#rows'));
      await store.exercises.save(planDate, exercises); closeSheet(); await refreshPlan();
    } catch (e) { $('#err').textContent = e.message; }
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
  $('#title').textContent = { home: '오늘', meals: '할일', record: '기록', stats: '통계', plan: '계획', settings: '설정' }[tab];
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
  if (gy) { useGym = gy.dataset.gym === '1'; try { localStorage.setItem('diet.gym', useGym ? '1' : '0'); } catch {} return render(); }
  const go = e.target.closest('[data-gotab]');
  if (go) { tab = go.dataset.gotab; mealDate = today; return loadDay().then(render); }
  const md = e.target.closest('[data-mealdate]');
  if (md) return setMealDate(md.dataset.mealdate);
  if (e.target.closest('#openMealCal')) return openDatePicker(mealDate, setMealDate);
  if (e.target.closest('#genDay')) return generatePlan(mealDate).then(async () => { if (mealDate === today) await loadToday(); await loadDay(); render(); });
  if (e.target.closest('#quickWeight')) return openWeightSheet();
  if (e.target.closest('#genToday')) return generatePlan(today).then(refresh);
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
  else if (t.dataset.plan === 'gen') { if ((planData.meals.length || planData.exercises.length) && !confirm('기존 계획을 추천 플랜으로 바꿀까요?')) return; generatePlan(planDate).then(refreshPlan).then(loadToday); }
  else if (t.dataset.plan === 'genweek') {
    if (!confirm('오늘부터 7일 계획을 추천 플랜으로 채울까요? (이미 있는 날은 건너뛰어요)')) return;
    (async () => { for (let i = 0; i < 7; i++) { const d = addDays(today, i); if (!(await store.meals.get(d)).length) await generatePlan(d); } await loadToday(); await refreshPlan(); })();
  }
});
document.querySelector('.tabs').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  tab = b.dataset.tab;
  if (tab === 'plan') await refreshPlan(); else if (tab === 'meals') { await loadDay(); render(); } else render();
});

function showLogin(sb) {
  const box = $('#login'); box.hidden = false;
  box.innerHTML = `<div class="card"><h2 style="margin-bottom:6px">다이어트 기록</h2><div class="eyebrow">이메일로 가입하고 내 기록을 시작하세요. 기록은 본인만 볼 수 있어요.</div>
    <input class="in" id="em" type="email" placeholder="이메일" autocomplete="username"><input class="in" id="pw" type="password" placeholder="비밀번호 (6자 이상)" autocomplete="current-password">
    <div class="err" id="lerr"></div><button class="btn" id="go">로그인</button><button class="btn ghost" id="su">처음이에요 (회원가입)</button>
    <p class="desc small" style="margin:14px 0 0">아이폰: Safari 공유 버튼 → <b>홈 화면에 추가</b>하면 앱처럼 쓸 수 있어요.</p></div>`;
  const run = (fn) => async () => {
    const { data, error } = await sb.auth[fn]({ email: $('#em').value.trim(), password: $('#pw').value });
    if (error) $('#lerr').textContent = error.message;
    else if (!data.session) $('#lerr').textContent = '가입 확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해주세요.';
    else location.reload();
  };
  $('#go').onclick = run('signInWithPassword'); $('#su').onclick = run('signUp');
}

(async function boot() {
  try {
    $('#hello').textContent = dailyQuote();
    if (READONLY) {
      store = shareStore(window.DIET_SHARE); accountLabel = '공유 보기 (읽기 전용)';
      if (window.DIET_SHARE.start) START = window.DIET_SHARE.start;
      if (window.DIET_SHARE.height) HEIGHT = Number(window.DIET_SHARE.height);
      document.body.classList.add('readonly');
    } else if (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) {
      store = await supabaseStore();
      const { data } = await store.sb.auth.getSession();
      if (!data.session) return showLogin(store.sb);
      accountLabel = data.session.user.email;
      const { data: urow } = await store.sb.from('users').select('start_date').eq('id', data.session.user.id).maybeSingle();
      if (urow?.start_date) START = urow.start_date;
      const { data: hrow } = await store.sb.from('users').select('height').eq('id', data.session.user.id).maybeSingle(); // null until 0004 migration
      if (hrow?.height) HEIGHT = Number(hrow.height);
      const { data: prow } = await store.sb.from('users').select('program_start').eq('id', data.session.user.id).maybeSingle(); // null until 0005 migration
      if (prow?.program_start) PROGRAM_START = prow.program_start;
      else if (prow) { PROGRAM_START = mondayOf(today); await store.sb.from('users').update({ program_start: PROGRAM_START }).eq('id', data.session.user.id); }
    } else {
      store = localStore(); accountLabel = '데모 계정';
      HEIGHT = num(lsGet('diet.height'));
      PROGRAM_START = lsGet('diet.programStart') || mondayOf(today);
      try { localStorage.setItem('diet.programStart', PROGRAM_START); } catch {}
      const saved = localStorage.getItem('diet.startDate');
      if (saved) START = saved;
    }
    $('#modeChip').textContent = store.label;
    favorites = await store.favorites.get();
    await refresh();
  } catch (e) { $('#view').innerHTML = `<div class="card"><div class="err">${esc(e.message)}</div></div>`; }
})();
