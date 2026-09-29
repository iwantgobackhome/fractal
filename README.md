# Fractal

Fractal은 PDF 논문을 읽고 보관하며, 선택한 AI 제공자로 번역하거나 질문할 수 있는 개인용 앱입니다. Windows와 macOS에서 데스크톱 앱 또는 브라우저용 허브로 실행할 수 있고, Android 앱을 연결할 수 있습니다.

## 준비 및 실행

Node.js 22.12 이상과 npm이 필요합니다. AI 기능에는 `codex` 또는 `claude` CLI를 설치하고 로그인해야 합니다. Codex는 앱 안의 계정 메뉴에서 **Fractal 허브 전용 세션**에 별도로 로그인합니다. Claude는 설치된 CLI의 로그인 상태를 사용합니다.

```sh
npm ci
npm run desktop
```

창 없이 허브만 실행하려면 `npm run build` 후 `npm run hub`를 실행하고 `http://127.0.0.1:7327/`을 엽니다. 포트는 `PAPERREAD_PORT`로 바꿀 수 있습니다. Windows 설치 파일은 `npm run desktop:dist`로 만들며 `dist/installer/`에 저장됩니다. macOS에서는 소스 실행이 가능하고 DMG 설정이 준비되어 있습니다.

데이터는 Windows의 `%LOCALAPPDATA%\Fractal`, macOS의 `${XDG_DATA_HOME:-~/.local/share}/fractal`에 저장됩니다. 첫 실행 때 기존 PaperRead 데이터를 복사해 가져오며 원본은 그대로 둡니다. `FRACTAL_DATA`로 데이터 위치를 지정할 수 있습니다.

## Android 연결

JDK 17과 Android SDK를 준비한 뒤 `apps/android`에서 `./gradlew assembleDebug` (Windows: `gradlew.bat assembleDebug`)를 실행합니다. 생성된 `app/build/outputs/apk/debug/app-debug.apk`를 기기에 설치합니다. 데스크톱의 **설정 → 기기 연결**에서 같은 Wi-Fi 또는 Tailscale 연결을 켜고 QR 코드를 스캔합니다. 선택적으로 `tailscale serve`로 HTTPS 프록시를 둘 수 있습니다. 에뮬레이터에서 호스트 PC는 `10.0.2.2`입니다.

논문 본문은 번역, 질문, 설명을 요청할 때만 선택한 AI 제공자로 전송됩니다. 일반 LAN 연결은 토큰을 쓰는 평문 HTTP이므로 신뢰할 수 있는 네트워크에서 사용하고, 가능하면 Tailscale을 사용하세요.

포트가 이미 사용 중이면 `PAPERREAD_PORT`를 바꾸거나 기존 허브를 종료하세요. AI가 응답하지 않으면 CLI 설치와 로그인 상태를 확인하고, Codex는 앱 안의 계정 메뉴에서 다시 로그인하세요.

[설계와 사용 문서](docs/) · [구조](docs/ARCHITECTURE.md) · [HTTP API](docs/API.md) · [서드파티 고지](THIRD_PARTY_NOTICES.md)
