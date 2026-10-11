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

`loop`은 길게 누를 때 반복할 구간(샘플 길이 대비 비율)입니다. `false`로 두면 반복 없이 샘플대로 자연스럽게 사라지고, `"maxHold": 초`를 넣으면 누르고 있어도 그 시간 뒤에 끝납니다. `release`는 건반을 뗀 뒤 소리가 줄어드는 시간(초)입니다. 샘플이 없는 음은 가장 가까운 샘플의 높이를 바꿔 내는데, `"shiftUp": true`면 바로 아래 샘플만 올려 씁니다(Starbound 악기 방식).

음색은 트랙 표에서 트랙마다 고릅니다. "자동"이면 오른손은 오른손 기본 음색, 베이스와 코드는 베이스 기본 음색으로 납니다. `"part": "bass"`를 넣은 음색이 베이스 기본 음색이 됩니다(없으면 `"treble"`로 봅니다).

## 악기 연결 (FR-4xb)
USB COMPUTER 단자로 연결하면 입력이 자동으로 잡힙니다. 악기 음색으로 곡을 들으려면 악기의 MIDI → Ext Seq → Acordion을 On으로 두고, 트랙 표에서 음색을 "MIDI: Roland Arranger"로 고르세요.

## 개발
```
npm install
npm run app    # 개발 창
npm run dist   # release/에 exe 생성
```
