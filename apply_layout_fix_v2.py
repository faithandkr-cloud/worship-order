#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1~10번 예배순서 html 파일에서
"예배 정보"(예배 이름) 칸과 "성경·찬송 자료" 토글 버튼을
한 줄로 합치는 변경을 한 번에 적용하는 스크립트 (v2 - 정규식 기반).

파일마다 "성경·찬송 자료" 섹션에 안내문(설명 글) 한 줄이 있는 것도 있고
없는 것도 있어서, 정규식으로 두 경우 다 처리한다. 안내문이 있으면 버리지
않고 접힌 부분("자료연결" 버튼을 눌러야 보이는 곳) 맨 위로 옮긴다.

사용법:
  1) 이 파일을 예배순서지 폴더(~/MEGA/예배순서지)에 둔다.
  2) 그 폴더에서 실행: python3 apply_layout_fix_v2.py
  3) 각 파일마다 "적용됨" / "이미 적용됨" / "찾지 못함"을 보여준다.
     "찾지 못함"이 나오면 그 파일의 실제 markup을 다시 보여주세요.
"""
import os
import re

TARGET_FILES = [
    "1. 주일오전예배.html",
    "2. 주일오후예배.html",
    "3. 수요기도회.html",
    "4. 새벽예배.html",
    "5. 금요기도회.html",
    "6. 구역예배.html",
    "7. 추도예배.html",
    "8. 청년예배.html",
    "9. 학생예배.html",
    "10. 심방예배.html",
]

ALREADY_MARK = 'class="advanced-toggle-btn"'

PATTERN = re.compile(
    r'<div class="settings-section">\s*'
    r'<h2>예배 정보</h2>\s*'
    r'<div class="settings-field">\s*'
    r'<label for="serviceTitleInput">예배 이름</label>\s*'
    r'(?P<input><input type="text" id="serviceTitleInput"[^>]*>)\s*'
    r'</div>\s*'
    r'</div>\s*'
    r'<div class="settings-section">\s*'
    r'<h2>성경·찬송 자료</h2>\s*'
    r'(?P<hint><div class="settings-hint">.*?</div>\s*)?'
    r'<div class="settings-save-row"[^>]*>\s*'
    r'<button type="button" class="preset-btn" id="dataSettingsToggleBtn">[^<]*</button>\s*'
    r'</div>\s*'
    r'</div>\s*'
    r'(?P<advtag><div id="dataSettingsAdvanced"[^>]*>)',
    re.DOTALL,
)

def build_replacement(m):
    input_tag = m.group("input")
    advtag = m.group("advtag")
    hint = m.group("hint") or ""
    hint = hint.strip()
    # 안내문이 있었다면 접힌 영역 "안쪽" 맨 위로 옮긴다(그래야 평소엔 안 보이고
    # "자료연결" 버튼을 눌러야만 보인다).
    hint_line = ("\n      " + hint) if hint else ""
    return (
        '<div class="settings-section">\n'
        '        <h2>예배 정보</h2>\n'
        '        <div class="field-row">\n'
        '          <div class="settings-field">\n'
        '            <label for="serviceTitleInput">예배 이름</label>\n'
        f'            {input_tag}\n'
        '          </div>\n'
        '          <button type="button" class="advanced-toggle-btn" id="dataSettingsToggleBtn">자료연결 ▾</button>\n'
        '        </div>\n'
        '      </div>\n\n'
        f'      {advtag}{hint_line}'
    )

def main():
    for name in TARGET_FILES:
        if not os.path.exists(name):
            print(f"[없음]      {name} — 이 폴더에서 파일을 찾지 못했습니다.")
            continue

        with open(name, "r", encoding="utf-8") as f:
            content = f.read()

        if ALREADY_MARK in content:
            print(f"[이미 적용됨] {name}")
            continue

        new_content, n = PATTERN.subn(build_replacement, content, count=1)
        if n == 0:
            print(f"[찾지 못함]  {name} — markup이 예상과 달라 자동으로 못 바꿨습니다. 이 파일은 따로 봐드릴게요.")
            continue

        with open(name, "w", encoding="utf-8") as f:
            f.write(new_content)
        print(f"[적용됨]    {name}")

if __name__ == "__main__":
    main()
