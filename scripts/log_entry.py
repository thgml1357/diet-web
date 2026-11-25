#!/usr/bin/env python3
"""
log_entry.py — 채팅으로 받은 식단/운동/체중 등을 Supabase daily_records에 merge-upsert.

기존 레코드가 있으면 숫자 필드는 "제공된 값만" 덮어쓰고, meals/exercises는 뒤에 append한다.
인증은 scripts/dietlib.py 참고 (친구: 본인 이메일/비밀번호 로그인, 앱 주인: service 키).

  python3 scripts/log_entry.py --date 2026-10-09 --weight 68.3 --steps 7000 \
    --meal "점심,닭가슴살,150,250" --exercise "달리기,30,공원 5km"

--meal "이름,그램,kcal"  (type 까지 넣고 싶으면 --meals-json 사용)
--exercise "이름,분,메모"
--meals-json / --exercises-json : 전체 필드 형식의 JSON 배열(문자열 또는 파일경로). 예:
    --meals-json '[{"type":"점심","name":"현미밥","grams":150,"kcal":230}]'
    --exercises-json '[{"category":"유산소","name":"걷기","duration":30,"kcal":120}]'
--note "허리 살짝 뻐근" / --inbody-json '{"weight":68,"fat_pct":30,"smm":22,"visceral":8,"whr":0.9}'
calories_consumed 를 안 주면 meals 의 kcal 합계로 자동 계산한다.
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dietlib import load_env, api, get_user_id, upsert, load_json_arg  # noqa: E402,F401


def get_record(env, user_id, date):
    rows = api(env, "GET", f"/rest/v1/daily_records?select=*&user_id=eq.{user_id}&date=eq.{date}")
    return rows[0] if rows else None


def parse_item(spec, keys):
    # "name,num,num_or_text"
    parts = [p.strip() for p in spec.split(",")]
    while len(parts) < len(keys):
        parts.append("")
    out = {}
    for k, v in zip(keys, parts):
        if k == "name" or k == "notes":
            out[k] = v or None
        else:
            out[k] = float(v) if v not in ("", None) else None
            if out[k] is not None and out[k] == int(out[k]):
                out[k] = int(out[k])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", default=None, help="service 모드에서만 필요 (기본 DIET_USER_EMAIL)")
    ap.add_argument("--date", required=True)
    ap.add_argument("--weight", type=float)
    ap.add_argument("--steps", type=int)
    ap.add_argument("--calories-consumed", type=int)
    ap.add_argument("--calories-burned", type=int)
    ap.add_argument("--meal", action="append", default=[], help="이름,그램,kcal")
    ap.add_argument("--exercise", action="append", default=[], help="이름,분,메모")
    ap.add_argument("--meals-json")
    ap.add_argument("--exercises-json")
    ap.add_argument("--note")
    ap.add_argument("--inbody-json")
    args = ap.parse_args()

    env = load_env()
    user_id = get_user_id(env, args.email)
    existing = get_record(env, user_id, args.date) or {}

    meals = list(existing.get("meals") or [])
    for spec in args.meal:
        meals.append(parse_item(spec, ["name", "grams", "kcal"]))
    if args.meals_json:
        meals += load_json_arg(args.meals_json)

    exercises = list(existing.get("exercises") or [])
    for spec in args.exercise:
        exercises.append(parse_item(spec, ["name", "duration", "notes"]))
    if args.exercises_json:
        exercises += load_json_arg(args.exercises_json)

    consumed = args.calories_consumed
    if consumed is None:
        total = sum(m.get("kcal") or 0 for m in meals)
        consumed = total or existing.get("calories_consumed")

    pick = lambda new, key: new if new is not None else existing.get(key)  # noqa: E731
    rec = {
        "user_id": user_id,
        "date": args.date,
        "weight": pick(args.weight, "weight"),
        "steps": pick(args.steps, "steps"),
        "calories_consumed": consumed,
        "calories_burned": pick(args.calories_burned, "calories_burned"),
        "meals": meals,
        "exercises": exercises,
        "note": args.note if args.note is not None else existing.get("note"),
    }
    if args.inbody_json:
        rec["inbody"] = json.loads(args.inbody_json)
    elif existing.get("inbody"):
        rec["inbody"] = existing["inbody"]

    print(json.dumps(upsert(env, "daily_records", rec), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
