# Accordion Trainer

> Synthesia-style practice tool for the C-system button accordion (Roland FR-4xb). Korean UI.

C시스템 버튼 아코디언 연습 프로그램입니다. MIDI 파일을 불러오면 실제 버튼 배치 위로 노트가 떨어지고, 악기를 연결하면 누르는 버튼을 실시간으로 보여줍니다.

## 실행
[Releases](../../releases)에서 exe를 받아 실행합니다(설치 불필요). 같은 프로그램이 브라우저에서도 동작합니다(Chrome, Edge 등 Web MIDI를 지원하는 브라우저).

## 음색
소리는 SoundFont 신시사이저 [SpessaSynth](https://github.com/spessasus/spessasynth_lib)로 내고, 음색은 [GeneralUser GS](https://www.schristiancollins.com/generaluser) 사운드폰트(GM/GS 악기 287개)를 함께 넣어 배포합니다. 트랙 표에서 트랙마다 악기를 고르며, 기본은 Italian Accordion, 드럼 트랙(10번 채널)은 드럼 키트입니다. 펼친 툴바의 "베이스 옥타브"로 베이스와 코드 소리를 한 옥타브씩 올리거나 내릴 수 있습니다.

## 악기 연결 (FR-4xb)
USB COMPUTER 단자로 연결하면 입력이 자동으로 잡힙니다. 악기 음색으로 곡을 들으려면 악기의 MIDI → Ext Seq → Acordion을 On으로 두고, 트랙 표에서 음색을 "MIDI: Roland Arranger"로 고르세요.

## 개발
```
npm install
npm run app    # 개발 창
npm run dist   # release/에 exe 생성
```

## 라이선스
이 프로그램은 MIT 라이선스입니다. 함께 배포하는 구성 요소의 라이선스는 `public/licenses/`에 있습니다.
- SpessaSynth (spessasynth_lib, spessasynth_core): Apache License 2.0, © Spessasus
- GeneralUser GS: © S. Christian Collins, GeneralUser GS License v2.0
