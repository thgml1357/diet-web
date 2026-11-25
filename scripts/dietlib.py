"""dietlib.py — scripts 공용 Supabase 접근 모듈.

두 가지 모드를 자동 선택한다.
  1) service 모드: .env/환경변수에 SUPABASE_SERVICE_ROLE_KEY 가 있으면 RLS를 우회 (앱 주인 전용).
  2) user 모드(기본, 친구용): SUPABASE_ANON_KEY + DIET_USER_EMAIL + DIET_USER_PASSWORD 로 본인 계정에 로그인.
     RLS가 적용돼서 본인 데이터만 읽고 쓸 수 있다. service_role 키는 절대 다른 사람에게 주지 말 것.

필요한 값은 프로젝트 루트의 .env (gitignore됨) 또는 환경변수. 없으면 web/config.js 의 URL/anon key를 사용한다.
"""
import json
import os
import re
import sys
from pathlib import Path
from urllib import error, request

ROOT = Path(__file__).resolve().parent.parent


def load_env():
    env = {}
    cfg = ROOT / "web" / "config.js"
    if cfg.exists():  # anon key/URL은 공개값이라 config.js 에서 기본값을 가져온다
        txt = cfg.read_text()
        for key in ("SUPABASE_URL", "SUPABASE_ANON_KEY"):
            m = re.search(key + r"\s*:\s*'([^']+)'", txt)
            if m:
                env[key] = m.group(1)
    p = ROOT / ".env"
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    for k in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DIET_USER_EMAIL", "DIET_USER_PASSWORD"):
        if os.environ.get(k):
            env[k] = os.environ[k]
    return env


def _http(env, method, path, body, headers):
    data = json.dumps(body).encode() if body is not None else None
    req = request.Request(env["SUPABASE_URL"] + path, data=data, headers=headers, method=method)
    try:
        with request.urlopen(req) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except error.HTTPError as e:
        print("API error:", e.read().decode(), file=sys.stderr)
        raise


def _login(env):
    for k in ("DIET_USER_EMAIL", "DIET_USER_PASSWORD"):
        if not env.get(k):
            raise SystemExit(f".env 또는 환경변수에 {k} 가 필요해요 (앱에서 가입한 이메일/비밀번호).")
    res = _http(env, "POST", "/auth/v1/token?grant_type=password",
                {"email": env["DIET_USER_EMAIL"], "password": env["DIET_USER_PASSWORD"]},
                {"apikey": env["SUPABASE_ANON_KEY"], "Content-Type": "application/json"})
    return res["access_token"], res["user"]["id"]


def api(env, method, path, body=None, extra_headers=None):
    """REST 호출. service 키가 있으면 그 키로, 없으면 로그인한 사용자 토큰으로."""
    if env.get("SUPABASE_SERVICE_ROLE_KEY"):
        key = token = env["SUPABASE_SERVICE_ROLE_KEY"]
    else:
        if "_token" not in env:
            env["_token"], env["_uid"] = _login(env)
        key, token = env["SUPABASE_ANON_KEY"], env["_token"]
    headers = {"apikey": key, "Authorization": "Bearer " + token, "Content-Type": "application/json"}
    if extra_headers:
        headers.update(extra_headers)
    return _http(env, method, path, body, headers)


def get_user_id(env, email=None):
    """대상 사용자 id. user 모드면 로그인한 본인, service 모드면 email 로 조회."""
    if not env.get("SUPABASE_SERVICE_ROLE_KEY"):
        api(env, "GET", "/rest/v1/users?select=id&limit=1")  # 로그인 보장
        return env["_uid"]
    email = email or env.get("DIET_USER_EMAIL")
    if not email:
        raise SystemExit("service 모드에서는 --email 또는 DIET_USER_EMAIL 이 필요해요.")
    rows = api(env, "GET", f"/rest/v1/users?select=id&email=eq.{email}")
    if not rows:
        raise SystemExit(f"user not found for email={email}")
    return rows[0]["id"]


def upsert(env, table, rec):
    return api(env, "POST", f"/rest/v1/{table}?on_conflict=user_id,date", [rec],
               {"Prefer": "resolution=merge-duplicates,return=representation"})


def load_json_arg(v):
    """--meals-json / --exercises-json 값: JSON 문자열이거나 JSON 파일 경로(@file 도 가능)."""
    if v.startswith("@"):
        v = v[1:]
    if os.path.exists(v):
        v = Path(v).read_text()
    return json.loads(v)
