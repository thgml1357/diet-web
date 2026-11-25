#!/usr/bin/env python3
"""
write_plan.py — meal_plans / exercise_plans 에 특정 날짜의 계획을 통째로 upsert (교체).

  python3 scripts/write_plan.py --date 2026-10-11 \
    --meal "아침,오트밀 라떼,300,210" --meal "점심,닭가슴살,120,150" \
    --exercise "저녁 산책,30,120,식후 가벼운 산책"

--meal "type,name,grams,kcal"        (반복 가능, 그날 meals 전체 교체)
--exercise "name,duration,kcal,notes" (반복 가능, 그날 exercises 전체 교체)
--meals-json / --exercises-json       전체 필드 JSON 배열(문자열 또는 파일경로). 운동은 이쪽을 권장:
    [{"category":"근력","name":"맨몸 스쿼트","sets":3,"reps":"10회","kcal":30,"notes":"..."}]
옵션을 안 준 쪽 테이블은 건드리지 않는다. 인증은 scripts/dietlib.py 참고.
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dietlib import load_env, api, get_user_id, upsert, load_json_arg  # noqa: E402,F401


def num(v):
    if v in ("", None):
        return None
    f = float(v)
    return int(f) if f == int(f) else f


def parse_meal(spec):
    parts = (spec.split(",", 3) + [""] * 4)[:4]
    type_, name, grams, kcal = parts
    return {"type": type_.strip() or None, "name": name.strip() or None, "grams": num(grams), "kcal": num(kcal)}


def parse_exercise(spec):
    parts = (spec.split(",", 3) + [""] * 4)[:4]
    name, duration, kcal, notes = parts
    return {"name": name.strip() or None, "duration": num(duration), "kcal": num(kcal), "notes": notes.strip() or None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", default=None, help="service 모드에서만 필요 (기본 DIET_USER_EMAIL)")
    ap.add_argument("--date", required=True)
    ap.add_argument("--meal", action="append", default=[], help="type,name,grams,kcal")
    ap.add_argument("--exercise", action="append", default=[], help="name,duration,kcal,notes")
    ap.add_argument("--meals-json")
    ap.add_argument("--exercises-json")
    args = ap.parse_args()

    env = load_env()
    user_id = get_user_id(env, args.email)

    meals = [parse_meal(m) for m in args.meal] if args.meal else None
    if args.meals_json:
        meals = load_json_arg(args.meals_json)
    exercises = [parse_exercise(e) for e in args.exercise] if args.exercise else None
    if args.exercises_json:
        exercises = load_json_arg(args.exercises_json)

    if meals is not None:
        print("meal_plans:", json.dumps(upsert(env, "meal_plans", {"user_id": user_id, "date": args.date, "meals": meals}), ensure_ascii=False))
    if exercises is not None:
        print("exercise_plans:", json.dumps(upsert(env, "exercise_plans", {"user_id": user_id, "date": args.date, "exercises": exercises}), ensure_ascii=False))


if __name__ == "__main__":
    main()
