<div align="center">
  <img src="public/logo.svg" alt="CloudCLI UI" width="64" height="64">
  <h1>Cloud CLI (aka Claude Code UI)</h1>
  <p>Десктопный и мобильный UI для <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a>, <a href="https://docs.cursor.com/en/cli/overview">Cursor CLI</a>, <a href="https://developers.openai.com/codex">Codex</a> и <a href="https://geminicli.com/">Gemini-CLI</a>.<br>Используйте локально или удалённо, чтобы просматривать активные проекты и сессии отовсюду.</p>
</div>

<p align="center">
  <a href="https://cloudcli.ai">CloudCLI Cloud</a> · <a href="https://cloudcli.ai/docs">Документация</a> · <a href="https://discord.gg/buxwujPNRE">Discord</a> · <a href="https://github.com/siteboon/claudecodeui/issues">Сообщить об ошибке</a> · <a href="CONTRIBUTING.md">Участие в разработке</a>
</p>

<p align="center">
  <a href="https://cloudcli.ai"><img src="https://img.shields.io/badge/☁️_CloudCLI_Cloud-Try_Now-0066FF?style=for-the-badge" alt="CloudCLI Cloud"></a>
  <a href="https://discord.gg/buxwujPNRE"><img src="https://img.shields.io/badge/Discord-Join%20Community-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Join our Discord"></a>
  <br><br>
  <a href="https://trendshift.io/repositories/15586" target="_blank"><img src="https://trendshift.io/api/badge/repositories/15586" alt="siteboon%2Fclaudecodeui | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<div align="right"><i><a href="./README.md">English</a> · <b>Русский</b> · <a href="./README.de.md">Deutsch</a> · <a href="./README.ko.md">한국어</a> · <a href="./README.zh-CN.md">中文</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.tr.md">Türkçe</a></i></div>

---

## Скриншоты

<div align="center">

<table>
<tr>
<td align="center">
<h3>Версия для десктопа</h3>
<img src="public/screenshots/desktop-main.png" alt="Desktop Interface" width="400">
<br>
<em>Основной интерфейс с обзором проекта и чатом</em>
</td>
<td align="center">
<h3>Мобильный режим</h3>
<img src="public/screenshots/mobile-chat.png" alt="Mobile Interface" width="250">
<br>
<em>Адаптивный мобильный дизайн с сенсорной навигацией</em>
</td>
</tr>
<tr>
<td align="center" colspan="2">
<h3>Выбор CLI</h3>
<img src="public/screenshots/cli-selection.png" alt="CLI Selection" width="400">
<br>
<em>Выбирайте между Claude Code, Gemini, Cursor CLI и Codex</em>
</td>
</tr>
</table>



</div>

## Возможности

- **Адаптивный дизайн** - одинаково хорошо работает на десктопе, планшете и телефоне, поэтому можно пользоваться агентами и с мобильных устройств
- **Интерактивный чат-интерфейс** - встроенный чат для бесшовного общения с агентами
- **Интегрированный shell-терминал** - прямой доступ к CLI агентов через встроенную оболочку
- **Проводник файлов** - интерактивное дерево файлов с подсветкой синтаксиса и редактированием в реальном времени
- **Git Explorer** - просмотр, stage и commit изменений. Также можно переключать ветки
- **Управление сессиями** - возобновляйте диалоги, управляйте несколькими сессиями и отслеживайте историю
- **Система плагинов** - расширяйте CloudCLI кастомными плагинами — добавляйте новые вкладки, бэкенд-сервисы и интеграции. [Создать свой →](https://github.com/cloudcli-ai/cloudcli-plugin-starter)
- **Интеграция с TaskMaster AI** *(опционально)* - продвинутое управление проектами с планированием задач на базе AI, разбором PRD и автоматизацией workflow
- **Совместимость с моделями** - работает с семействами моделей Claude, GPT и Gemini (см. [`shared/modelConstants.js`](shared/modelConstants.js) для полного списка поддерживаемых моделей)


## Быстрый старт

### CloudCLI Cloud (рекомендуется)

Самый быстрый способ начать — локальная настройка не требуется. Получите полностью управляемую контейнеризированную среду разработки с доступом из веба, мобильного приложения, API или вашей любимой IDE.

**[Начать с CloudCLI Cloud](https://cloudcli.ai)**


### Self-Hosted (Open source)

#### npm

Попробовать CloudCLI UI можно сразу через **npx** (требуется **Node.js** v22+):

```bash
npx @cloudcli-ai/cloudcli
```

Или установить **глобально** для регулярного использования:

```bash
npm install -g @cloudcli-ai/cloudcli
cloudcli
```

Откройте `http://localhost:3001` — все ваши существующие сессии будут обнаружены автоматически.

Посетите **[документацию →](https://cloudcli.ai/docs)**, чтобы узнать про дополнительные варианты конфигурации, PM2, настройку удалённого сервера и многое другое.

#### Docker Sandboxes (Экспериментально)

Запускайте агентов в изолированных песочницах с гипервизорной изоляцией. По умолчанию запускается Claude Code. Требуется [`sbx` CLI](https://docs.docker.com/ai/sandboxes/get-started/).

```
npx @cloudcli-ai/cloudcli@latest sandbox ~/my-project
```

Поддерживаются Claude Code, Codex и Gemini CLI. Подробнее в [документации sandbox](docker/).

---

## Какой вариант подходит вам?

CloudCLI UI — это open source UI-слой, на котором построен CloudCLI Cloud. Вы можете развернуть его на своей машине или использовать CloudCLI Cloud, который добавляет полностью управляемую облачную среду, командные функции и более глубокие интеграции.

| | CloudCLI UI (Self-hosted) | CloudCLI Cloud |
|---|---|---|
| **Лучше всего подходит для** | Разработчиков, которым нужен полноценный UI для локальных агентских сессий на своей машине | Команд и разработчиков, которым нужны агенты в облаке с доступом откуда угодно |
| **Как вы получаете доступ** | Браузер через `[yourip]:port` | Браузер, любая IDE, REST API, n8n |
| **Настройка** | `npx @cloudcli-ai/cloudcli` | Настройка не требуется |
| **Машина должна оставаться включённой** | Да | Нет |
| **Доступ с мобильных устройств** | Любой браузер в вашей сети | Любое устройство, нативное приложение в разработке |
| **Доступные сессии** | Все сессии автоматически обнаруживаются из `~/.claude` | Все сессии внутри вашей облачной среды |
| **Поддерживаемые агенты** | Claude Code, Cursor CLI, Codex, Gemini CLI | Claude Code, Cursor CLI, Codex, Gemini CLI |
| **Проводник файлов и Git** | Да, встроены в UI | Да, встроены в UI |
| **Конфигурация MCP** | Управляется через UI, синхронизируется с вашим локальным конфигом `~/.claude` | Управляется через UI |
| **Доступ из IDE** | Ваша локальная IDE | Любая IDE, подключенная к вашей облачной среде |
| **REST API** | Да | Да |
| **n8n node** | Нет | Да |
| **Совместная работа** | Нет | Да |
| **Стоимость платформы** | Бесплатно, open source | От $7/месяц |

> В обоих вариантах используются ваши собственные AI-подписки (Claude, Cursor и т.д.) — CloudCLI предоставляет среду, а не сам AI.

---

## Безопасность и конфигурация инструментов

**🔒 Важное примечание**: все инструменты Claude Code **по умолчанию отключены**. Это предотвращает автоматический запуск потенциально опасных операций.

### Включение инструментов

Чтобы использовать всю функциональность Claude Code, вам нужно вручную включить инструменты:

1. **Откройте настройки инструментов** - нажмите на иконку шестерёнки в боковой панели
2. **Включайте выборочно** - активируйте только те инструменты, которые вам нужны
3. **Примените настройки** - ваши предпочтения сохраняются локально

<div align="center">

![Tools Settings Modal](public/screenshots/tools-modal.png)
*Интерфейс настройки инструментов — включайте только то, что вам нужно*

</div>

**Рекомендуемый подход**: начните с базовых инструментов и добавляйте остальные по мере необходимости. Эти настройки всегда можно изменить позже.

---

## Плагины

У CloudCLI есть система плагинов, которая позволяет добавлять кастомные вкладки со своим frontend UI и (опционально) Node.js бэкендом. Устанавливайте плагины напрямую из git-репозиториев в **Settings > Plugins** или создавайте свои.

### Доступные плагины

| Плагин | Описание |
|---|---|
| **[Project Stats](https://github.com/cloudcli-ai/cloudcli-plugin-starter)** | Показывает количество файлов, строки кода, разбивку по типам файлов, самые большие файлы и недавно изменённые файлы для текущего проекта |

### Создать свой

**[Plugin Starter Template →](https://github.com/cloudcli-ai/cloudcli-plugin-starter)** — сделайте форк этого репозитория, чтобы создать свой плагин. В шаблоне есть рабочий пример с рендерингом на фронтенде, live-обновлением контекста и RPC-коммуникацией с бэкенд-сервером.

**[Plugin Documentation →](https://cloudcli.ai/docs/plugin-overview)** — полный гайд по plugin API, формату манифеста, модели безопасности и другому.

---
## FAQ

<details>
<summary>Чем это отличается от Claude Code Remote Control?</summary>

Claude Code Remote Control позволяет отправлять сообщения в сессию, которая уже запущена в вашем локальном терминале. Ваша машина должна оставаться включённой, терминал — открытым, а сессии завершаются примерно через 10 минут без сетевого соединения.

CloudCLI UI и CloudCLI Cloud расширяют Claude Code, а не работают рядом с ним — ваши MCP-серверы, разрешения, настройки и сессии остаются теми же самыми, что и в нативном Claude Code. Ничего не дублируется и не управляется отдельно.

Вот что это означает на практике:

- **Все ваши сессии, а не одна** — CloudCLI UI автоматически находит каждую сессию из папки `~/.claude`. Remote Control предоставляет только одну активную сессию, чтобы сделать её доступной в мобильном приложении Claude.
- **Ваши настройки — это ваши настройки** — MCP-серверы, права инструментов и конфигурация проекта, изменённые в CloudCLI UI, записываются напрямую в конфиг Claude Code и вступают в силу сразу же, и наоборот.
- **Работает с большим числом агентов** — Claude Code, Cursor CLI, Codex и Gemini CLI, а не только Claude Code.
- **Полноценный UI, а не просто окно чата** — проводник файлов, Git-интеграция, управление MCP и shell-терминал — всё встроено.
- **CloudCLI Cloud работает в облаке** — закройте ноутбук, и агент продолжит работать. Не нужно следить за терминалом и держать машину постоянно активной.

</details>

<details>
<summary>Нужно ли отдельно платить за AI-подписку?</summary>

Да. CloudCLI предоставляет среду, а не сам AI. Вы приносите свою подписку Claude, Cursor, Codex или Gemini. CloudCLI Cloud начинается от $7/месяц за хостируемую среду поверх этого.

</details>

<details>
<summary>Можно ли пользоваться CloudCLI UI с телефона?</summary>

Да. Для self-hosted запустите сервер на своей машине и откройте `[yourip]:port` в любом браузере в вашей сети. Для CloudCLI Cloud откройте сервис с любого устройства — без VPN, проброса портов и дополнительной настройки. Нативное приложение тоже в разработке.

</details>

<details>
<summary>Повлияют ли изменения, сделанные в UI, на мой локальный Claude Code?</summary>

Да, в self-hosted режиме. CloudCLI UI читает и записывает тот же конфиг `~/.claude`, который Claude Code использует нативно. MCP-серверы, добавленные через UI, сразу появляются в Claude Code, и наоборот.

</details>

---

## Сообщество и поддержка

- **[Документация](https://cloudcli.ai/docs)** — установка, настройка, возможности и устранение неполадок
- **[Discord](https://discord.gg/buxwujPNRE)** — помощь и общение с другими пользователями
- **[GitHub Issues](https://github.com/siteboon/claudecodeui/issues)** — сообщения об ошибках и запросы новых функций
- **[Руководство для контрибьюторов](CONTRIBUTING.md)** — как участвовать в развитии проекта

## Лицензия

GNU General Public License v3.0 - подробности в файле [LICENSE](LICENSE).

Этот проект open source и бесплатен для использования, модификации и распространения в рамках лицензии GPL v3.

## Благодарности

### Используется
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** - официальный CLI от Anthropic
- **[Cursor CLI](https://docs.cursor.com/en/cli/overview)** - официальный CLI от Cursor
- **[Codex](https://developers.openai.com/codex)** - OpenAI Codex
- **[Gemini-CLI](https://geminicli.com/)** - Google Gemini CLI
- **[React](https://react.dev/)** - библиотека пользовательских интерфейсов
- **[Vite](https://vitejs.dev/)** - быстрый инструмент сборки и dev-сервер
- **[Tailwind CSS](https://tailwindcss.com/)** - utility-first CSS framework
- **[CodeMirror](https://codemirror.net/)** - продвинутый редактор кода
- **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)** *(опционально)* - AI-управление проектами и планирование задач


### Спонсоры
- [Siteboon - AI powered website builder](https://siteboon.ai)
---

<div align="center">
  <strong>Сделано с заботой для сообщества Claude Code, Cursor и Codex.</strong>
</div>
