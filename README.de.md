<div align="center">
  <img src="public/logo.svg" alt="CloudCLI UI" width="64" height="64">
  <h1>Cloud CLI (auch bekannt als Claude Code UI)</h1>
  <p>Eine Desktop- und Mobile-Oberfläche für <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a>, <a href="https://docs.cursor.com/en/cli/overview">Cursor CLI</a>, <a href="https://developers.openai.com/codex">Codex</a> und <a href="https://geminicli.com/">Gemini-CLI</a>.<br>Lokal oder remote nutzbar – verwalte deine aktiven Projekte und Sitzungen von überall.</p>
</div>

<p align="center">
  <a href="https://cloudcli.ai">CloudCLI Cloud</a> · <a href="https://cloudcli.ai/docs">Dokumentation</a> · <a href="https://discord.gg/buxwujPNRE">Discord</a> · <a href="https://github.com/siteboon/claudecodeui/issues">Fehler melden</a> · <a href="CONTRIBUTING.md">Mitwirken</a>
</p>

<p align="center">
  <a href="https://cloudcli.ai"><img src="https://img.shields.io/badge/☁️_CloudCLI_Cloud-Try_Now-0066FF?style=for-the-badge" alt="CloudCLI Cloud"></a>
  <a href="https://discord.gg/buxwujPNRE"><img src="https://img.shields.io/badge/Discord-Join_Community-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Join Community"></a>
  <br><br>
  <a href="https://trendshift.io/repositories/15586" target="_blank"><img src="https://trendshift.io/api/badge/repositories/15586" alt="siteboon%2Fclaudecodeui | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<div align="right"><i><a href="./README.md">English</a> · <a href="./README.ru.md">Русский</a> · <b>Deutsch</b> · <a href="./README.ko.md">한국어</a> · <a href="./README.zh-CN.md">中文</a> · <a href="./README.ja.md">日本語</a></i></div>

---

## Screenshots

<div align="center">

<table>
<tr>
<td align="center">
<h3>Desktop-Ansicht</h3>
<img src="public/screenshots/desktop-main.png" alt="Desktop-Oberfläche" width="400">
<br>
<em>Hauptoberfläche mit Projektübersicht und Chat</em>
</td>
<td align="center">
<h3>Mobile-Erfahrung</h3>
<img src="public/screenshots/mobile-chat.png" alt="Mobile-Oberfläche" width="250">
<br>
<em>Responsives mobiles Design mit Touch-Navigation</em>
</td>
</tr>
<tr>
<td align="center" colspan="2">
<h3>CLI-Auswahl</h3>
<img src="public/screenshots/cli-selection.png" alt="CLI-Auswahl" width="400">
<br>
<em>Wähle zwischen Claude Code, Gemini, Cursor CLI und Codex</em>
</td>
</tr>
</table>



</div>

## Funktionen

- **Responsives Design** – Funktioniert nahtlos auf Desktop, Tablet und Mobilgerät, sodass du Agents auch vom Smartphone aus nutzen kannst
- **Interaktives Chat-Interface** – Eingebaute Chat-Oberfläche für die reibungslose Kommunikation mit den Agents
- **Integriertes Shell-Terminal** – Direkter Zugriff auf die Agents CLI über die eingebaute Shell-Funktionalität
- **Datei-Explorer** – Interaktiver Dateibaum mit Syntaxhervorhebung und Live-Bearbeitung
- **Git-Explorer** – Änderungen anzeigen, stagen und committen. Branches wechseln ebenfalls möglich
- **Sitzungsverwaltung** – Gespräche fortsetzen, mehrere Sitzungen verwalten und Verlauf nachverfolgen
- **Plugin-System** – CloudCLI mit eigenen Plugins erweitern – neue Tabs, Backend-Dienste und Integrationen hinzufügen. [Eigenes Plugin erstellen →](https://github.com/cloudcli-ai/cloudcli-plugin-starter)
- **TaskMaster AI Integration** *(Optional)* – Erweitertes Projektmanagement mit KI-gestützter Aufgabenplanung, PRD-Parsing und Workflow-Automatisierung
- **Modell-Kompatibilität** – Funktioniert mit Claude, GPT und Gemini (vollständige Liste unterstützter Modelle in [`shared/modelConstants.js`](shared/modelConstants.js))


## Schnellstart

### CloudCLI Cloud (Empfohlen)

Der schnellste Einstieg – keine lokale Einrichtung erforderlich. Erhalte eine vollständig verwaltete, containerisierte Entwicklungsumgebung, die über Web, Mobile App, API oder deine bevorzugte IDE erreichbar ist.

**[Mit CloudCLI Cloud starten](https://cloudcli.ai)**


### Self-Hosted (Open Source)

CloudCLI UI sofort mit **npx** ausprobieren (erfordert **Node.js** v22+):

```bash
npx @cloudcli-ai/cloudcli
```

Oder **global** installieren für regelmäßige Nutzung:

```bash
npm install -g @cloudcli-ai/cloudcli
cloudcli
```

Öffne `http://localhost:3001` – alle vorhandenen Sitzungen werden automatisch erkannt.

Die **[Dokumentation →](https://cloudcli.ai/docs)** enthält weitere Konfigurationsoptionen, PM2, Remote-Server-Einrichtung und mehr.


---

## Welche Option passt zu dir?

CloudCLI UI ist die Open-Source-UI-Schicht, die CloudCLI Cloud antreibt. Du kannst es auf deinem eigenen Rechner selbst hosten oder CloudCLI Cloud nutzen, das darauf aufbaut und eine vollständig verwaltete Cloud-Umgebung, Team-Funktionen und tiefere Integrationen bietet.

| | CloudCLI UI (Self-hosted) | CloudCLI Cloud |
|---|---|---|
| **Am besten für** | Entwickler:innen, die eine vollständige UI für lokale Agent-Sitzungen auf ihrem eigenen Rechner möchten | Teams und Entwickler:innen, die Agents in der Cloud betreiben möchten, überall erreichbar |
| **Zugriff** | Browser via `[deineIP]:port` | Browser, jede IDE, REST API, n8n |
| **Einrichtung** | `npx @cloudcli-ai/cloudcli` | Keine Einrichtung erforderlich |
| **Rechner muss laufen** | Ja | Nein |
| **Mobiler Zugriff** | Jeder Browser im Netzwerk | Jedes Gerät, native App in Entwicklung |
| **Verfügbare Sitzungen** | Alle Sitzungen automatisch aus `~/.claude` erkannt | Alle Sitzungen in deiner Cloud-Umgebung |
| **Unterstützte Agents** | Claude Code, Cursor CLI, Codex, Gemini CLI | Claude Code, Cursor CLI, Codex, Gemini CLI |
| **Datei-Explorer und Git** | Ja, direkt in der UI | Ja, direkt in der UI |
| **MCP-Konfiguration** | Über UI verwaltet, synchronisiert mit lokalem `~/.claude` | Über UI verwaltet |
| **IDE-Zugriff** | Deine lokale IDE | Jede IDE, die mit deiner Cloud-Umgebung verbunden ist |
| **REST API** | Ja | Ja |
| **n8n-Node** | Nein | Ja |
| **Team-Sharing** | Nein | Ja |
| **Plattformkosten** | Kostenlos, Open Source | Ab $7/Monat |

> Beide Optionen verwenden deine eigenen KI-Abonnements (Claude, Cursor usw.) – CloudCLI stellt die Umgebung bereit, nicht die KI.

---

## Sicherheit & Tool-Konfiguration

**🔒 Wichtiger Hinweis**: Alle Claude Code Tools sind **standardmäßig deaktiviert**. Dies verhindert, dass potenziell schädliche Operationen automatisch ausgeführt werden.

### Tools aktivieren

Um den vollen Funktionsumfang von Claude Code zu nutzen, müssen Tools manuell aktiviert werden:

1. **Tool-Einstellungen öffnen** – Klicke auf das Zahnrad-Symbol in der Seitenleiste
2. **Selektiv aktivieren** – Nur die benötigten Tools einschalten
3. **Einstellungen übernehmen** – Deine Einstellungen werden lokal gespeichert

<div align="center">

![Tool-Einstellungen Modal](public/screenshots/tools-modal.png)
*Tool-Einstellungen – nur aktivieren, was benötigt wird*

</div>

**Empfohlene Vorgehensweise**: Mit grundlegenden Tools starten und bei Bedarf weitere hinzufügen. Die Einstellungen können jederzeit angepasst werden.

---

## Plugins

CloudCLI verfügt über ein Plugin-System, mit dem benutzerdefinierte Tabs mit eigener Frontend-UI und optionalem Node.js-Backend hinzugefügt werden können. Plugins können direkt in **Einstellungen > Plugins** aus Git-Repos installiert oder selbst entwickelt werden.

### Verfügbare Plugins

| Plugin | Beschreibung |
|---|---|
| **[Project Stats](https://github.com/cloudcli-ai/cloudcli-plugin-starter)** | Zeigt Dateianzahl, Codezeilen, Dateityp-Aufschlüsselung, größte Dateien und zuletzt geänderte Dateien des aktuellen Projekts |

### Eigenes Plugin erstellen

**[Plugin-Starter-Vorlage →](https://github.com/cloudcli-ai/cloudcli-plugin-starter)** – Forke dieses Repository, um ein eigenes Plugin zu erstellen. Es enthält ein funktionierendes Beispiel mit Frontend-Rendering, Live-Kontext-Updates und RPC-Kommunikation zu einem Backend-Server.

**[Plugin-Dokumentation →](https://cloudcli.ai/docs/plugin-overview)** – Vollständige Anleitung zur Plugin-API, zum Manifest-Format, zum Sicherheitsmodell und mehr.

---
## FAQ

<details>
<summary>Wie unterscheidet sich das von Claude Code Remote Control?</summary>

Claude Code Remote Control ermöglicht es, Nachrichten an eine bereits im lokalen Terminal laufende Sitzung zu senden. Der Rechner muss eingeschaltet bleiben, das Terminal muss offen bleiben, und Sitzungen laufen nach etwa 10 Minuten ohne Netzwerkverbindung ab.

CloudCLI UI und CloudCLI Cloud erweitern Claude Code, anstatt neben ihm zu laufen – MCP-Server, Berechtigungen, Einstellungen und Sitzungen sind exakt dieselben, die Claude Code nativ verwendet. Nichts wird dupliziert oder separat verwaltet.

Das bedeutet in der Praxis:

- **Alle Sitzungen, nicht nur eine** – CloudCLI UI erkennt automatisch jede Sitzung aus dem `~/.claude`-Ordner. Remote Control stellt nur die einzelne aktive Sitzung bereit, um sie in der Claude Mobile App verfügbar zu machen.
- **Deine Einstellungen sind deine Einstellungen** – MCP-Server, Tool-Berechtigungen und Projektkonfiguration, die in CloudCLI UI geändert werden, werden direkt in die Claude Code-Konfiguration geschrieben und treten sofort in Kraft – und umgekehrt.
- **Funktioniert mit mehr Agents** – Claude Code, Cursor CLI, Codex und Gemini CLI, nicht nur Claude Code.
- **Vollständige UI, nicht nur ein Chat-Fenster** – Datei-Explorer, Git-Integration, MCP-Verwaltung und ein Shell-Terminal sind alle eingebaut.
- **CloudCLI Cloud läuft in der Cloud** – Laptop zuklappen, der Agent läuft weiter. Kein Terminal zu überwachen, kein Rechner, der laufen muss.

</details>

<details>
<summary>Muss ich ein KI-Abonnement separat bezahlen?</summary>

Ja. CloudCLI stellt die Umgebung bereit, nicht die KI. Du bringst dein eigenes Claude-, Cursor-, Codex- oder Gemini-Abonnement mit. CloudCLI Cloud beginnt bei $7/Monat für die gehostete Umgebung zusätzlich dazu.

</details>

<details>
<summary>Kann ich CloudCLI UI auf meinem Smartphone nutzen?</summary>

Ja. Bei Self-Hosted: Server auf dem eigenen Rechner starten und `[deineIP]:port` in einem beliebigen Browser im Netzwerk öffnen. Bei CloudCLI Cloud: Von jedem Gerät aus öffnen – kein VPN, keine Portweiterleitung, keine Einrichtung. Eine native App ist ebenfalls in Entwicklung.

</details>

<details>
<summary>Wirken sich Änderungen in der UI auf mein lokales Claude Code-Setup aus?</summary>

Ja, bei Self-Hosted. CloudCLI UI liest aus und schreibt in dieselbe `~/.claude`-Konfiguration, die Claude Code nativ verwendet. MCP-Server, die über die UI hinzugefügt werden, erscheinen sofort in Claude Code und umgekehrt.

</details>

---

## Community & Support

- **[Dokumentation](https://cloudcli.ai/docs)** — Installation, Konfiguration, Funktionen und Fehlerbehebung
- **[Discord](https://discord.gg/buxwujPNRE)** — Hilfe erhalten und mit anderen Nutzer:innen in Kontakt treten
- **[GitHub Issues](https://github.com/siteboon/claudecodeui/issues)** — Fehlerberichte und Feature-Anfragen
- **[Beitragsrichtlinien](CONTRIBUTING.md)** — So kannst du zum Projekt beitragen

## Lizenz

GNU General Public License v3.0 – siehe [LICENSE](LICENSE)-Datei für Details.

Dieses Projekt ist Open Source und kann unter der GPL v3-Lizenz kostenlos genutzt, modifiziert und verteilt werden.

## Danksagungen

### Erstellt mit
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** - Anthropics offizielle CLI
- **[Cursor CLI](https://docs.cursor.com/en/cli/overview)** - Cursors offizielle CLI
- **[Codex](https://developers.openai.com/codex)** - OpenAI Codex
- **[Gemini-CLI](https://geminicli.com/)** - Google Gemini CLI
- **[React](https://react.dev/)** - UI-Bibliothek
- **[Vite](https://vitejs.dev/)** - Schnelles Build-Tool und Dev-Server
- **[Tailwind CSS](https://tailwindcss.com/)** - Utility-first CSS-Framework
- **[CodeMirror](https://codemirror.net/)** - Erweiterter Code-Editor
- **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)** *(Optional)* - KI-gestütztes Projektmanagement und Aufgabenplanung


### Sponsoren
- [Siteboon - KI-gestützter Website-Builder](https://siteboon.ai)
---

<div align="center">
  <strong>Mit Sorgfalt für die Claude Code-, Cursor- und Codex-Community erstellt.</strong>
</div>
