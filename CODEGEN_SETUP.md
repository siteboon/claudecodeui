# Настройка Codegen в Claude Code UI

## Обзор

Claude Code UI теперь поддерживает интеграцию с Codegen - мощным AI-агентом для разработки программного обеспечения. Эта интеграция позволяет использовать возможности Codegen прямо из веб-интерфейса.

## Архитектура интеграции

### Backend компоненты

1. **server/codegen-cli.js** - Модуль для управления процессами Codegen
   - Функция `spawnCodegen()` - запуск новых сессий
   - Функция `abortCodegenSession()` - завершение сессий
   - Управление WebSocket соединениями

2. **server/routes/codegen.js** - API маршруты для Codegen
   - `POST /api/codegen/command` - отправка команд
   - `POST /api/codegen/abort` - прерывание сессий
   - Аутентификация через JWT токены

3. **server/index.js** - Основной сервер
   - Импорт Codegen модулей
   - Подключение защищенных маршрутов
   - WebSocket обработка

### Frontend компоненты

1. **src/components/CodegenLogo.jsx** - SVG логотип Codegen
   - Зеленая цветовая схема (#10B981 to #047857)
   - Анимированные элементы
   - Адаптивный дизайн

2. **src/components/ChatInterface.jsx** - Основной интерфейс чата
   - Выбор провайдера (Claude/Cursor/Codegen)
   - Обработка сообщений Codegen
   - Отображение логотипов и статусов

3. **src/components/MainContent.jsx** и **Sidebar.jsx**
   - Поддержка выбора Codegen провайдера
   - Обновленная навигация

## Установка и настройка

### Предварительные требования

1. Node.js (версия 16 или выше)
2. npm или yarn
3. Установленный Codegen CLI

### Шаги установки

1. **Клонирование репозитория**
   ```bash
   git clone https://github.com/evgenygurin/claudecodeui.git
   cd claudecodeui
   ```

2. **Установка зависимостей**
   ```bash
   npm install
   ```

3. **Установка дополнительных зависимостей для сборки**
   ```bash
   npm install --save-dev terser
   ```

4. **Сборка проекта**
   ```bash
   npm run build
   ```

5. **Запуск сервера**
   ```bash
   npm start
   ```

## Использование

### Выбор провайдера

1. Откройте веб-интерфейс Claude Code UI
2. В интерфейсе чата найдите секцию выбора провайдера
3. Выберите "Codegen" из доступных опций
4. Интерфейс автоматически переключится на зеленую тему Codegen

### Отправка команд

1. После выбора Codegen введите команду в текстовое поле
2. Нажмите Enter или кнопку отправки
3. Команда будет отправлена через WebSocket на backend
4. Ответ от Codegen отобразится в интерфейсе чата

### Управление сессиями

- Каждая сессия Codegen имеет уникальный ID
- Сессии автоматически возобновляются при переключении между проектами
- Возможность прерывания длительных операций

## API Endpoints

### POST /api/codegen/command
Отправка команды в Codegen

**Параметры:**
```json
{
  "type": "codegen-command",
  "command": "string",
  "sessionId": "string",
  "options": {
    "cwd": "string",
    "projectPath": "string",
    "sessionId": "string",
    "resume": boolean,
    "toolsSettings": object
  }
}
```

### POST /api/codegen/abort
Прерывание сессии Codegen

**Параметры:**
```json
{
  "sessionId": "string"
}
```

## Конфигурация

### Настройки провайдера

Выбор провайдера сохраняется в localStorage:
```javascript
localStorage.setItem('selected-provider', 'codegen');
```

### WebSocket сообщения

Формат сообщений для Codegen:
```javascript
{
  type: 'codegen-command',
  command: input,
  sessionId: effectiveSessionId,
  options: {
    cwd: selectedProject.fullPath || selectedProject.path,
    projectPath: selectedProject.fullPath || selectedProject.path,
    sessionId: effectiveSessionId,
    resume: !!effectiveSessionId,
    toolsSettings: toolsSettings
  }
}
```

## Стилизация

### Цветовая схема Codegen

- Основной цвет: `#10B981` (зеленый)
- Темный оттенок: `#047857`
- Тень: `ring-2 ring-green-500/20`
- Границы: `border-green-500`

### CSS классы

```css
.codegen-theme {
  border-green-500 shadow-lg ring-2 ring-green-500/20
}
```

## Отладка

### Логи сервера

Сервер выводит подробные логи для отладки:
- Запуск/остановка процессов Codegen
- WebSocket соединения
- Ошибки аутентификации

### Логи браузера

В консоли браузера отображаются:
- Сообщения WebSocket
- Ошибки JavaScript
- Состояние провайдера

## Устранение неполадок

### Проблемы со сборкой

1. **Ошибка "terser not found"**
   ```bash
   npm install --save-dev terser
   ```

2. **CSS предупреждения**
   - Предупреждения CSS не критичны и не влияют на функциональность

### Проблемы с WebSocket

1. Проверьте подключение к серверу
2. Убедитесь в корректности JWT токена
3. Проверьте настройки CORS

### Проблемы с Codegen

1. Убедитесь, что Codegen CLI установлен
2. Проверьте права доступа к файлам проекта
3. Убедитесь в корректности путей к проекту

## Разработка

### Структура файлов

```
claudecodeui/
├── server/
│   ├── codegen-cli.js      # Управление процессами Codegen
│   ├── routes/codegen.js   # API маршруты
│   └── index.js           # Основной сервер
├── src/
│   └── components/
│       ├── CodegenLogo.jsx    # Логотип Codegen
│       ├── ChatInterface.jsx  # Основной интерфейс
│       ├── MainContent.jsx    # Контент
│       └── Sidebar.jsx        # Боковая панель
└── CODEGEN_SETUP.md       # Эта документация
```

### Добавление новых функций

1. Backend изменения в `server/routes/codegen.js`
2. Frontend изменения в соответствующих компонентах
3. Обновление WebSocket обработчиков
4. Тестирование интеграции

## Безопасность

### Аутентификация

- Все API маршруты защищены JWT токенами
- Middleware `authenticateToken` проверяет валидность токенов
- Сессии изолированы по пользователям

### Изоляция процессов

- Каждая сессия Codegen запускается в отдельном процессе
- Процессы имеют ограниченные права доступа
- Автоматическое завершение неактивных сессий

## Производительность

### Оптимизация сборки

- Минификация CSS и JavaScript
- Разделение кода на чанки
- Сжатие gzip

### Управление памятью

- Автоматическая очистка завершенных процессов
- Ограничение количества одновременных сессий
- Мониторинг использования ресурсов

## Поддержка

Для получения поддержки:
1. Проверьте логи сервера и браузера
2. Убедитесь в корректности конфигурации
3. Создайте issue в репозитории GitHub

## Лицензия

Проект распространяется под лицензией MIT.

