# TO_DO — lista zadań forka claudecodeui

## Zasady tego pliku

- Nowe zadania dodajemy **na dole sekcji TO DO**.
- Ukończone zadania przenosimy **na dół pliku do sekcji DONE**.
- W każdym zadaniu: **Co zrobić / Co ustalono / Czego się spodziewać** — prostym językiem, bez żargonu.
- Po każdym ukończonym zadaniu dopisz **Jak przetestować** — konkretne kroki weryfikacji (co otworzyć, kliknąć, wywołać, co powinno się zmienić).
- Dla każdego zadania **zawsze zakładamy issue na GitHub** z labelami `enhancement` + `needs-testing`; link wklejamy w sekcji DONE.
- Każde zadanie **zawsze ma oznaczony status**: 🔴 Nie rozpoczęte / 🟡 W toku / 🟢 Ukończone.

---

## TO DO

---

## DONE

### Slash commands: obsługa komend Claude Code CLI (np. /compact)

- **Status:** 🟢 Ukończone
- **Issue:** https://github.com/szmidtpiotr/claudecodeui/issues/6
- **Task-master:** #27
- **Co zrobiono:**
  - Menu slash (/) pokazywało tylko predefiniowane komendy UI — komendy Claude Code CLI jak `/compact` były niedostępne.
  - Dodano nową sekcję „Claude CLI" w menu slash z komendami `/compact` i `/doctor` (fioletowe ikony Zap).
  - Wybór komendy CLI z menu **wstawia ją do pola tekstowego** (nie wykonuje przez API serwera) — użytkownik widzi co wysyła i zatwierdza Enterem.
  - Enter wysyła komendę bezpośrednio do Claude Code SDK, który obsługuje ją natywnie.
  - Pliki zmienione: `server/routes/commands.js`, `CommandMenu.tsx`, `useSlashCommands.ts`, `useChatComposerState.ts`.
- **Jak przetestować:**
  1. W polu tekstowym czatu wpisz `/compact` — w menu slash powinna pojawić się sekcja „Claude CLI" z opcją `/compact`.
  2. Wybierz `/compact` z menu (kliknięcie lub Tab/Enter) — komenda powinna się wstawić do pola tekstowego.
  3. Naciśnij Enter — Claude Code SDK wykona kompaktowanie kontekstu.
  4. Tak samo przetestuj `/doctor`.

### UX: Ukryj/zwiń treść po kompaktowaniu kontekstu

- **Status:** 🟢 Ukończone
- **Issue:** https://github.com/szmidtpiotr/claudecodeui/issues/5
- **Task-master:** #26
- **Co zrobiono:**
  - Po kompaktowaniu SDK wysyłało do UI masę tekstu (podsumowanie/kontekst) który wyglądał jak odpowiedź — mylący dla użytkownika.
  - Wiadomości z flagą `isCompactSummary: true` renderowane jako **zwinięty blok** z nagłówkiem „Compacted context" (domyślnie zamknięty, z możliwością rozwinięcia kliknięciem).
  - Nowy toggle **„Show compact summaries"** w Quick Settings (ikona Minimize2) — domyślnie wyłączony. Gdy włączony, podsumowania wyświetlają się inline jak normalne wiadomości (przydatne do debugowania).
  - Pliki zmienione: `useUiPreferences.ts`, `quick-settings-panel/types.ts`, `quick-settings-panel/constants.ts`, `QuickSettingsPanelView.tsx`, `chat/types/types.ts`, `MainContent.tsx`, `ChatInterface.tsx`, `ChatMessagesPane.tsx`, `MessageComponent.tsx`, `chat.json`, `settings.json`.
- **Jak przetestować:**
  1. Uruchom `/compact` w czacie (lub poczekaj na auto-compact przy długiej rozmowie).
  2. Po kompaktowaniu zamiast ściany tekstu pojawi się szary zwinięty blok „Compacted context" — kliknij żeby rozwinąć/zwinąć.
  3. Wejdź w Quick Settings (panel boczny) → włącz „Show compact summaries" → podsumowanie pokazuje się inline bez zwijania.
  4. Wyłącz toggle → znów wraca do zwiniętego bloku.

### UX: Informacja o kompaktowaniu kontekstu + reset wskaźnika tokenów

- **Status:** 🟢 Ukończone
- **Issue:** https://github.com/szmidtpiotr/claudecodeui/issues/4
- **Task-master:** #24, #25
- **Co zrobiono:**
  - SDK Claude Code wysyła wiadomość `{type:'system', subtype:'status', status:'compacting'}` gdy kompaktuje kontekst, ale serwer ją cicho odrzucał — użytkownik widział tylko generyczne „Thinking / Processing / Analyzing..." przez cały czas kompaktowania (2+ minuty).
  - Naprawiono w `server/modules/providers/list/claude/claude-sessions.provider.ts`: dodano obsługę tej wiadomości — gdy `status === 'compacting'` emitowany jest `kind: 'status'` z `text: 'Compacting context...'` do frontendu.
  - Komponent `ClaudeStatus` wyświetla ten tekst zamiast kręcenia się w kółko po generycznych słowach.
  - **Dodatkowa poprawka:** wskaźnik zużycia tokenów w stopce zostawał na 100% po kompaktowaniu, bo SDK zwraca `result` z `modelUsage` odzwierciedlającym koszt samego kompaktowania (~100% okna kontekstu jako input). Naprawiono w `server/claude-sdk.js`: dodano flagę `compactionOccurred` — po wykryciu zdarzenia compacting, wysyłany jest `token_budget` z `used: 0` zamiast zawyżonych danych, co resetuje wskaźnik.
- **Jak przetestować:**
  1. Prowadź długą rozmowę aż do automatycznego kompaktowania, lub wpisz `/compact` w czacie.
  2. Podczas kompaktowania pasek statusu (nad polem tekstowym) powinien wyświetlać **„Compacting context…"** zamiast generycznych słów.
  3. Po zakończeniu kompaktowania wskaźnik tokenów w stopce powinien pokazywać **~0%** (nie 100%).
  4. Wyślij kolejną wiadomość — wskaźnik zaktualizuje się do rzeczywistego zużycia skróconego kontekstu.

### Powiadomienie dźwiękowe i popup gdy wymagana akcja użytkownika

- **Status:** 🟢 Ukończone
- **Issue:** https://github.com/szmidtpiotr/claudecodeui/issues/2
- **Co zrobiono:**
  - Nowy plik `src/utils/audioNotification.ts`: dwutonowy dźwięk (660Hz→880Hz) przez Web Audio API, preferencja w localStorage (`pref:audio:enabled`, domyślnie wyłączony).
  - `useChatRealtimeHandlers.ts`: wywołanie `playActionRequiredSound()` przy zdarzeniu `permission_request`.
  - `NotificationsSettingsTab.tsx`: nowa sekcja „Audio Notifications" z checkboxem włącz/wyłącz.
  - Powiadomienia Web Push (już istniejące w projekcie) podpięte pod to samo zdarzenie — działają w tle na mobile Chrome.
- **Jak przetestować:**
  1. Wejdź w Ustawienia → Notifications, włącz „Audio Notifications".
  2. Uruchom prompt wymagający zgody (np. narzędzie z uprawnieniami do pliku).
  3. Gdy agent się zatrzyma na `permission_request`, powinien zagrać krótki dźwięk (dwa tony: 660→880 Hz).
  4. Test tła: na mobile Chrome z kartą w tle — powinno pojawić się powiadomienie systemowe.

### Utrzymanie połączenia WebSocket za proxy (ping/keepalive)

- **Status:** 🟢 Ukończone
- **Issue:** https://github.com/szmidtpiotr/claudecodeui/issues/3
- **Task-master:** #16
- **Co zrobiono:**
  - Serwer nie wysyłał ramek ping, więc proxy (NGINX Proxy Manager / Cloudflare) zrywało bezczynne połączenia WebSocket po ~60-100s — prawdopodobna przyczyna znikających promptów i utraty sesji.
  - Dodano heartbeat w `server/modules/websocket/services/websocket-server.service.ts`: co 30s serwer pinguje każdego klienta (krócej niż timeout proxy), przeglądarka automatycznie odpowiada pong (działa też podczas streamowania).
  - Klient bez odpowiedzi na poprzedni ping jest rozłączany (`terminate`); interwał czyszczony przy zamknięciu serwera.
  - Brak zmian po stronie klienta — ping/pong jest na poziomie protokołu, obsługiwany przez przeglądarkę.
- **Jak przetestować:**
  1. Wejdź na aplikację przez **prawdziwą domenę** (przez proxy), nie przez `:5173` (dev bezpośrednio nie odtwarza buga).
  2. Zostaw czat bezczynny na 2-3 minuty (dłużej niż timeout proxy).
  3. Wyślij prompt — powinien dojść. Wcześniej połączenie było zrywane i prompt znikał.
  4. Uwaga: Chrome DevTools **nie pokazuje** ramek ping/pong w zakładce Messages (filtruje je) — brak ich tam to normalne, nie błąd.

### Zużycie subskrypcji Claude.ai w stopce

- **Status:** 🟢 Ukończone
- **Issue:** https://github.com/szmidtpiotr/claudecodeui/issues/1
- **Co zrobiono:**
  - Narzędzie `claude-usage-tray` (Python) rozbudowane o tryb `--json` (bez okienka GTK; klucz sesji przez zmienną środowiskową `CLAUDE_SESSION_KEY`). Przeglądarka uruchamiana w trybie headed przez `xvfb-run -a` (wirtualny framebuffer) + `playwright-stealth` — omija detekcję Cloudflare.
  - Backend: nowa usługa `server/services/claudeUsageService.js` (cache 5 min, timeout 60s) + route `GET /api/usage/claude?refresh=1`.
  - Klucz sesji (`claude_session`) przechowywany w bazie per-user; endpointy `GET/PUT/DELETE /api/user/claude-session-key`.
  - Frontend: komponent `UsagePill` obok `TokenUsagePie` — pokazuje `S42%/W17%` (session/weekly), kolor zależny od poziomu (niebieski/pomarańczowy/czerwony), spinner podczas ładowania, `!` przy błędzie, link „Usage: set up" gdy brak klucza.
  - W Ustawieniach → API → nowa sekcja do wpisania klucza sesji Claude.ai.
- **Jak przetestować:**
  1. Otwórz Ustawienia → API, znajdź sekcję „Claude Session Key", wklej klucz sesji Claude.ai (z `~/.config/claude-usage-tray/config.json` lub przeglądarki).
  2. Wróć do czatu — w stopce, obok wykresu tokenów, pojawi się wskaźnik `S__% / W__%`.
  3. Kliknij ikonę odświeżenia obok wskaźnika — dane powinny się zaktualizować.
  4. Bez klucza zamiast liczb widać link „Usage: set up" — kliknięcie otwiera Ustawienia.
