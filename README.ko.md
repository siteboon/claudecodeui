<div align="center">
  <img src="public/logo.svg" alt="Claude Code UI" width="64" height="64">
  <h1>Cloud CLI (일명 Claude Code UI)</h1>
</div>


[Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Cursor CLI](https://docs.cursor.com/en/cli/overview) 및 [Codex](https://developers.openai.com/codex)를 위한 데스크톱 및 모바일 UI입니다. 로컬 또는 원격으로 사용하여 Claude Code, Cursor 또는 Codex의 활성 프로젝트와 세션을 확인하고, 어디서든(모바일 또는 데스크톱) 변경할 수 있습니다. 어디서든 작동하는 적절한 인터페이스를 제공합니다.

<div align="right"><i><a href="./README.md">English</a> · <a href="./README.zh-CN.md">中文</a> · <a href="./README.ja.md">日本語</a></i></div>

## 스크린샷

<div align="center">

<table>
<tr>
<td align="center">
<h3>데스크톱 뷰</h3>
<img src="public/screenshots/desktop-main.png" alt="Desktop Interface" width="400">
<br>
<em>프로젝트 개요와 채팅을 보여주는 메인 인터페이스</em>
</td>
<td align="center">
<h3>모바일 경험</h3>
<img src="public/screenshots/mobile-chat.png" alt="Mobile Interface" width="250">
<br>
<em>터치 내비게이션이 포함된 반응형 모바일 디자인</em>
</td>
</tr>
<tr>
<td align="center" colspan="2">
<h3>CLI 선택</h3>
<img src="public/screenshots/cli-selection.png" alt="CLI Selection" width="400">
<br>
<em>Claude Code, Cursor CLI, Codex 중 선택</em>
</td>
</tr>
</table>



</div>

## 기능

- **반응형 디자인** - 데스크톱, 태블릿, 모바일에서 원활하게 작동하여 모바일에서도 Claude Code, Cursor 또는 Codex를 사용할 수 있습니다
- **대화형 채팅 인터페이스** - Claude Code, Cursor 또는 Codex와 원활하게 소통하는 내장 채팅 인터페이스
- **통합 셸 터미널** - 내장 셸 기능을 통한 Claude Code, Cursor CLI 또는 Codex 직접 접근
- **파일 탐색기** - 구문 강조 및 실시간 편집이 가능한 대화형 파일 트리
- **Git 탐색기** - 변경사항 보기, 스테이징 및 커밋. 브랜치 전환도 가능
- **세션 관리** - 대화 재개, 여러 세션 관리 및 기록 추적
- **TaskMaster AI 통합** *(선택사항)* - AI 기반 작업 계획, PRD 분석 및 워크플로우 자동화를 통한 고급 프로젝트 관리
- **모델 호환성** - Claude Sonnet 4.5, Opus 4.5 및 GPT-5.2 지원


## 빠른 시작

### 사전 요구사항

- [Node.js](https://nodejs.org/) v22 이상
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) 설치 및 구성, 그리고/또는
- [Cursor CLI](https://docs.cursor.com/en/cli/overview) 설치 및 구성, 그리고/또는
- [Codex](https://developers.openai.com/codex) 설치 및 구성

### 원클릭 실행 (권장)

설치 없이 바로 실행:

```bash
npx @siteboon/claude-code-ui
```

서버가 시작되면 `http://localhost:3001` (또는 설정한 PORT)에서 접근할 수 있습니다.

**재시작**: 서버를 중지한 후 동일한 `npx` 명령을 다시 실행하면 됩니다
### 전역 설치 (정기적 사용 시)

자주 사용하는 경우 한 번만 전역 설치:

```bash
npm install -g @siteboon/claude-code-ui
```

간단한 명령으로 시작:

```bash
claude-code-ui
```


**재시작**: Ctrl+C로 중지한 후 `claude-code-ui`를 다시 실행합니다.

**업데이트**:
```bash
cloudcli update
```

### CLI 사용법

전역 설치 후 `claude-code-ui`와 `cloudcli` 명령을 사용할 수 있습니다:

| 명령 / 옵션 | 약어 | 설명 |
|------------------|-------|-------------|
| `cloudcli` 또는 `claude-code-ui` | | 서버 시작 (기본값) |
| `cloudcli start` | | 서버 명시적 시작 |
| `cloudcli status` | | 구성 및 데이터 위치 표시 |
| `cloudcli update` | | 최신 버전으로 업데이트 |
| `cloudcli help` | | 도움말 정보 표시 |
| `cloudcli version` | | 버전 정보 표시 |
| `--port <port>` | `-p` | 서버 포트 설정 (기본값: 3001) |
| `--database-path <path>` | | 사용자 지정 데이터베이스 위치 설정 |

**예시:**
```bash
cloudcli                          # 기본 설정으로 시작
cloudcli -p 8080              # 사용자 지정 포트로 시작
cloudcli status                   # 현재 구성 표시
```

### 백그라운드 서비스로 실행 (프로덕션 권장)

프로덕션 환경에서는 PM2(Process Manager 2)를 사용하여 Claude Code UI를 백그라운드 서비스로 실행하세요:

#### PM2 설치

```bash
npm install -g pm2
```

#### 백그라운드 서비스로 시작

```bash
# 백그라운드에서 서버 시작
pm2 start claude-code-ui --name "claude-code-ui"

# 또는 짧은 별칭 사용
pm2 start cloudcli --name "claude-code-ui"

# 사용자 지정 포트로 시작
pm2 start cloudcli --name "claude-code-ui" -- --port 8080
```


#### 시스템 부팅 시 자동 시작

시스템 부팅 시 Claude Code UI를 자동으로 시작하려면:

```bash
# 플랫폼에 맞는 시작 스크립트 생성
pm2 startup

# 현재 프로세스 목록 저장
pm2 save
```


### 로컬 개발 설치

1. **리포지토리 클론:**
```bash
git clone https://github.com/siteboon/claudecodeui.git
cd claudecodeui
```

2. **의존성 설치:**
```bash
npm install
```

3. **환경 구성:**
```bash
cp .env.example .env
# 원하는 설정으로 .env 파일 편집
```

4. **애플리케이션 시작:**
```bash
# 개발 모드 (핫 리로드 포함)
npm run dev

```
애플리케이션은 .env에서 지정한 포트에서 시작됩니다

5. **브라우저 열기:**
   - 개발: `http://localhost:3001`

## 보안 및 도구 설정

**🔒 중요 공지**: 모든 Claude Code 도구는 **기본적으로 비활성화**되어 있습니다. 이는 잠재적으로 유해한 작업이 자동으로 실행되는 것을 방지합니다.

### 도구 활성화

Claude Code의 전체 기능을 사용하려면 수동으로 도구를 활성화해야 합니다:

1. **도구 설정 열기** - 사이드바의 톱니바퀴 아이콘을 클릭
3. **선택적으로 활성화** - 필요한 도구만 활성화
4. **설정 적용** - 환경설정은 로컬에 저장됩니다

<div align="center">

![도구 설정 모달](public/screenshots/tools-modal.png)
*도구 설정 인터페이스 - 필요한 것만 활성화하세요*

</div>

**권장 접근법**: 기본 도구부터 활성화하고 필요에 따라 추가하세요. 언제든지 이 설정을 조정할 수 있습니다.

## TaskMaster AI 통합 *(선택사항)*

Claude Code UI는 고급 프로젝트 관리 및 AI 기반 작업 계획을 위한 **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)**(일명 claude-task-master) 통합을 지원합니다.

제공 기능
- PRD(제품 요구사항 문서)에서 AI 기반 작업 생성
- 스마트 작업 분해 및 의존성 관리
- 시각적 작업 보드 및 진행 상황 추적

**설정 및 문서**: 설치 지침, 구성 가이드 및 사용 예시는 [TaskMaster AI GitHub 리포지토리](https://github.com/eyaltoledano/claude-task-master)를 방문하세요.
설치 후 설정에서 활성화할 수 있습니다


## 사용 가이드

### 핵심 기능

#### 프로젝트 관리
Claude Code, Cursor 또는 Codex 세션을 사용할 수 있을 때 자동으로 발견하고 프로젝트로 그룹화합니다
- **프로젝트 작업** - 프로젝트 이름 변경, 삭제 및 정리
- **스마트 내비게이션** - 최근 프로젝트 및 세션에 빠르게 접근
- **MCP 지원** - UI를 통해 자체 MCP 서버 추가

#### 채팅 인터페이스
- **반응형 채팅 또는 Claude Code/Cursor CLI/Codex CLI 사용** - 적응형 채팅 인터페이스를 사용하거나 셸 버튼을 사용하여 선택한 CLI에 연결할 수 있습니다
- **실시간 통신** - WebSocket 연결을 통해 선택한 CLI(Claude Code/Cursor/Codex)에서 응답 스트리밍
- **세션 관리** - 이전 대화 재개 또는 새 세션 시작
- **메시지 기록** - 타임스탬프 및 메타데이터가 포함된 전체 대화 기록
- **다중 형식 지원** - 텍스트, 코드 블록 및 파일 참조

#### 파일 탐색기 및 편집기
- **대화형 파일 트리** - 확장/축소 내비게이션으로 프로젝트 구조 탐색
- **실시간 파일 편집** - 인터페이스에서 직접 파일 읽기, 수정 및 저장
- **구문 강조** - 다양한 프로그래밍 언어 지원
- **파일 작업** - 파일 및 디렉토리 생성, 이름 변경, 삭제

#### Git 탐색기


#### TaskMaster AI 통합 *(선택사항)*
- **시각적 작업 보드** - 개발 작업 관리를 위한 칸반 스타일 인터페이스
- **PRD 파서** - 제품 요구사항 문서를 생성하고 구조화된 작업으로 변환
- **진행 상황 추적** - 실시간 상태 업데이트 및 완료 추적

#### 세션 관리
- **세션 지속성** - 모든 대화 자동 저장
- **세션 정리** - 프로젝트 및 타임스탬프별 세션 그룹화
- **세션 작업** - 대화 기록 이름 변경, 삭제 및 내보내기
- **크로스 디바이스 동기화** - 모든 기기에서 세션 접근

### 모바일 앱
- **반응형 디자인** - 모든 화면 크기에 최적화
- **터치 친화적 인터페이스** - 스와이프 제스처 및 터치 내비게이션
- **모바일 내비게이션** - 엄지 내비게이션을 위한 하단 탭 바
- **적응형 레이아웃** - 접을 수 있는 사이드바 및 스마트 콘텐츠 우선순위
- **홈 화면 바로가기 추가** - 홈 화면에 바로가기를 추가하면 앱이 PWA처럼 작동합니다

## 아키텍처

### 시스템 개요

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend       │    │  Agent     │
│   (React/Vite)  │◄──►│ (Express/WS)    │◄──►│  Integration    │
│                 │    │                 │    │                │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### 백엔드 (Node.js + Express)
- **Express 서버** - 정적 파일 제공이 포함된 RESTful API
- **WebSocket 서버** - 채팅 및 프로젝트 새로고침을 위한 통신
- **에이전트 통합 (Claude Code / Cursor CLI / Codex)** - 프로세스 생성 및 관리
- **파일 시스템 API** - 프로젝트를 위한 파일 브라우저 노출

### 프론트엔드 (React + Vite)
- **React 18** - hooks를 사용한 현대적 컴포넌트 아키텍처
- **CodeMirror** - 구문 강조를 지원하는 고급 코드 편집기



### 기여하기

기여를 환영합니다! 커밋 규칙, 개발 워크플로우, 릴리스 프로세스에 대한 자세한 내용은 [Contributing Guide](CONTRIBUTING.md)를 참조해주세요.

## 문제 해결

### 일반적인 문제 및 해결 방법


#### "Claude 프로젝트를 찾을 수 없음"
**문제**: UI에 프로젝트가 없거나 프로젝트 목록이 비어 있음
**해결 방법**:
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)가 올바르게 설치되었는지 확인
- 초기화를 위해 최소 하나의 프로젝트 디렉토리에서 `claude` 명령 실행
- `~/.claude/projects/` 디렉토리가 존재하고 적절한 권한이 있는지 확인

#### 파일 탐색기 문제
**문제**: 파일이 로드되지 않음, 권한 오류, 빈 디렉토리
**해결 방법**:
- 프로젝트 디렉토리 권한 확인 (터미널에서 `ls -la`)
- 프로젝트 경로가 존재하고 접근 가능한지 확인
- 자세한 오류 메시지는 서버 콘솔 로그 검토
- 프로젝트 범위 밖의 시스템 디렉토리에 접근하지 않는지 확인


## 라이선스

GNU General Public License v3.0 - 자세한 내용은 [LICENSE](LICENSE) 파일을 참조하세요.

이 프로젝트는 오픈 소스이며 GPL v3 라이선스에 따라 자유롭게 사용, 수정 및 배포할 수 있습니다.

## 감사의 말

### 사용 기술
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** - Anthropic의 공식 CLI
- **[Cursor CLI](https://docs.cursor.com/en/cli/overview)** - Cursor의 공식 CLI
- **[Codex](https://developers.openai.com/codex)** - OpenAI Codex
- **[React](https://react.dev/)** - 사용자 인터페이스 라이브러리
- **[Vite](https://vitejs.dev/)** - 빠른 빌드 도구 및 개발 서버
- **[Tailwind CSS](https://tailwindcss.com/)** - 유틸리티 우선 CSS 프레임워크
- **[CodeMirror](https://codemirror.net/)** - 고급 코드 편집기
- **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)** *(선택사항)* - AI 기반 프로젝트 관리 및 작업 계획

## 지원 및 커뮤니티

### 최신 정보 받기
- 이 리포지토리에 **Star**를 눌러 지지를 표시하세요
- **Watch**로 업데이트 및 새 릴리스를 확인하세요
- 프로젝트를 **Follow**하여 공지사항을 받으세요

### 스폰서
- [Siteboon - AI powered website builder](https://siteboon.ai)
---

<div align="center">
  <strong>Claude Code, Cursor 및 Codex 커뮤니티를 위해 정성껏 만들었습니다.</strong>
</div>
