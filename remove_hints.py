#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1~10번 예배순서 html 파일에서, 상태 표시용이 아닌 순수 "설명글"만 골라
삭제하는 스크립트. (연결 상태를 보여주는 두 줄 — 악보 이미지 개수,
성경 연결 여부 — 은 실제 정보라서 그대로 둔다.)

사용법:
  cd ~/MEGA/예배순서지
  python3 remove_hints.py
"""
import os

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

# 지울 설명글들 — 실제 파일에 있는 그대로(줄바꿈 포함) 정확히 일치해야
# 지워진다. 상태표시용(dataFolderStatusText, bibleStatusText)은 여기 없음 —
# 그대로 남긴다.
REMOVE_BLOCKS = [
    '        <div class="settings-hint">컴퓨터나 폰의 자료 폴더(개역개정.mybible 같은 성경 파일과 찬송가 사진들이 함께 들어있는 폴더)를 통째로 선택하면 성경 연결과 찬송가 악보 매칭이 한 번에 됩니다. 성경읽기·찬송가 앱과 같은 방식으로 저장되므로, 그 앱들에서 이미 불러와 둔 성경·악보가 있다면 여기서도 별도 작업 없이 그대로 잡힙니다(같은 주소로 열었을 때). 이 브라우저에만 저장되므로, 폰이나 패드에서 열 때는 그 기기에도 자료 폴더를 내려받아 두고(MEGA 앱 등으로) 그 기기에서 한 번 이 버튼을 눌러 연결해주면 됩니다.</div>\n',
    '        <div class="settings-hint" style="margin:0 0 8px;">MEGA 앱처럼 폴더 전체 선택만 되고 안쪽 "자료" 폴더까지 못 들어가진다면, 아래 버튼으로 그 폴더 안에 들어가서 파일들을 직접 여러 개 선택해주세요.</div>\n',
    '        <div class="settings-hint">위에서 자료 폴더를 연결했다면 아래는 그대로 두어도 됩니다. 성경읽기 등 다른 앱에서 이미 저장해 둔 번역본이 있으면 그 이름(ID)만 입력하고 "연결 확인"을 누르세요.</div>\n',
    '        <div class="settings-hint">위에서 자료 폴더를 연결했다면 아래는 그대로 두어도 됩니다. 서버에 실제 이미지 폴더를 올려둔 경우처럼 이 예배순서지 파일과 같은 위치에 폴더를 두고 "번호.jpg" 형식(예: 488.jpg)으로 파일을 넣어두면 그 경로에서도 자동으로 찾습니다. CCM 등 번호가 없는 곡은 제목을 파일명으로 써도 됩니다(예: 깊어진 삶을 주께.jpg).</div>\n',
    '        <div class="settings-hint">항목을 누르면 그 항목의 편집 칸만 펼쳐집니다. 한 번에 하나씩 작업하세요.</div>\n',
    '        <div class="settings-hint" style="margin-top:0;">자주 쓰는 순서를 눌러 바로 추가하세요.</div>\n',
    # 지난번 작업 때 접힌 영역 안으로 옮겨둔 안내문 (2~10번 파일에만 있음)
    '      <div class="settings-hint">대문 화면에서 한 번 연결해두면 여기서는 따로 손댈 일이 거의 없습니다. 폴더 재연결이나 번역본을 직접 확인하고 싶을 때만 열어보세요.</div>\n',
]

def main():
    for name in TARGET_FILES:
        if not os.path.exists(name):
            print(f"[없음]  {name}")
            continue
        with open(name, "r", encoding="utf-8") as f:
            content = f.read()
        removed = 0
        for block in REMOVE_BLOCKS:
            if block in content:
                content = content.replace(block, "")
                removed += 1
        with open(name, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"[{name}] 설명글 {removed}개 삭제함")

if __name__ == "__main__":
    main()
