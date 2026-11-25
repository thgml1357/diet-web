# 다이어트 기록 (웹앱)

식단·운동·체중을 기록하고 계획하는 모바일 웹앱. 이메일로 가입하면 내 기록은 나만 볼 수 있어요.

- 사용: 배포 링크를 Safari/Chrome으로 열고 **홈 화면에 추가** → 회원가입
- AI 코치(Claude)를 쓰려면 `docs/AI_GUIDE.md` 내용을 Claude에게 붙여넣기
- 직접 배포: Settings → Pages → Source = GitHub Actions
- 설정 탭에서 비밀번호 변경·회원 탈퇴·내 기록 공유(읽기 전용 링크)를 할 수 있어요 (DB 함수는 supabase/migrations/0006_*.sql)
- 로컬 실행: `python3 -m http.server -d web 8000`
