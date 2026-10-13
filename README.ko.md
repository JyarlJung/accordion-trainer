# Accordion Trainer

[English](README.md) | **한국어**

Synthesia처럼 노트가 떨어지는 아코디언 연습 프로그램입니다. MIDI 파일을 열면 양손의 노트가 실제로 누를 버튼이나 건반 위로 떨어집니다. 오른손은 C 시스템, B 시스템(바얀) 버튼 배열 또는 피아노 건반, 왼손은 스트라델라 베이스입니다.

https://github.com/user-attachments/assets/d34d6058-2042-4767-a283-51cd317efa61

## 전자 아코디언으로 연습하기
Roland V-Accordion 같은 전자 아코디언을 USB로 연결하면 내가 치는 것을 그대로 읽습니다.
- **연습 모드**: 노트를 칠 때까지 곡이 기다립니다. 오른손, 베이스, 또는 둘 다 고를 수 있고, 코드는 구성음을 모두 함께 누르고 있어야 넘어갑니다.
- 누를 때마다 박자에 맞았는지 판정하고, 누르고 있는 버튼이 화면에 바로 표시됩니다.
- 몇 마디만 반복하거나, 속도를 늦추거나, 메트로놈에 맞춰 연습할 수 있습니다.

## 일반 아코디언의 경우
MIDI가 없는 일반 아코디언도 버튼식이든 건반식이든 화면의 노트를 보며 따라 칠 수 있습니다. 버튼과 건반은 마우스로 눌러도 됩니다.

## 오른손 음역 자르기
피아노용 MIDI처럼 오른손으로 치기 어려운 낮은 음이 섞여 있으면, 노트가 떨어지는 레인을 클릭해 정리할 수 있습니다.
- **왼쪽 클릭**: 그 레인과 그보다 낮은 음을 오른손에서 뺍니다.
- **오른쪽 클릭**: 같은 음들을 빼서 베이스 파트로 넘깁니다. 베이스 버튼과 코드로 치게 됩니다.
- 같은 레인을 같은 버튼으로 다시 클릭하면 되돌립니다.

## 시작하기
[Releases](../../releases)에서 exe를 받아 실행합니다(설치 불필요). Web MIDI를 지원하는 브라우저(Chrome, Edge)에서도 같은 프로그램이 동작합니다: **[웹에서 바로 실행](https://jyarljung.github.io/accordion-trainer/)**. 처음 화면의 "샘플 곡 열기"로 Greensleeves를 바로 열어 볼 수 있습니다.

### Roland V-Accordion
USB COMPUTER 단자로 연결하면 입력이 자동으로 잡힙니다. 악기 음색으로 곡을 들으려면 악기의 MIDI → Ext Seq → Accordion을 On으로 두고, 트랙의 음색을 "MIDI: Roland Arranger"로 고르세요.

## 소리
곡은 [SpessaSynth](https://github.com/spessasus/spessasynth_lib)로 재생하고, [GeneralUser GS](https://www.schristiancollins.com/generaluser) 사운드폰트를 함께 넣어 배포합니다(기본 음색 Italian Accordion).

## 개발
```
npm install
npm run app    # 개발 창
npm run dist   # release/에 exe 생성
```

## 라이선스
MIT. 함께 배포하는 구성 요소의 라이선스는 `public/licenses/`에 있습니다.
- SpessaSynth (spessasynth_lib, spessasynth_core): Apache License 2.0, © Spessasus
- GeneralUser GS: © S. Christian Collins, GeneralUser GS License v2.0
- 샘플 곡 `public/demo/greensleeves.mid`: Greensleeves (Traditional), 아코디언 편곡 Ralf Axel Gehlert, [Mutopia Project #1265](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1265), 퍼블릭 도메인
