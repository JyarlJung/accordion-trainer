# Accordion Trainer

> Synthesia-style practice tool for the C-system button accordion (Roland FR-4xb). Korean UI.

C시스템 버튼 아코디언 연습 프로그램입니다. MIDI 파일을 불러오면 실제 버튼 배치 위로 노트가 떨어지고, 악기를 연결하면 누르는 버튼을 실시간으로 보여줍니다.

## 실행
[Releases](../../releases)에서 exe를 받아 실행합니다(설치 불필요).

## 음색 추가
exe 옆에 `samples/<음색 이름>/` 폴더를 만들고 샘플과 `manifest.json`을 넣습니다.

```json
{ "label": "내 아코디언", "urls": { "A3": "a3.ogg", "A4": "a4.ogg" }, "loop": [0.1, 0.35] }
```

`loop`은 길게 누를 때 반복할 구간(샘플 길이 대비 비율)입니다.

## 악기 연결 (FR-4xb)
USB COMPUTER 단자로 연결하면 입력이 자동으로 잡힙니다. 악기 음색으로 곡을 들으려면 악기의 MIDI → Ext Seq → Acordion을 On으로 두고, 앱 ⚙ 설정에서 음색을 "MIDI: Roland Arranger"로 고르세요.

## 개발
```
npm install
npm run app    # 개발 창
npm run dist   # release/에 exe 생성
```
