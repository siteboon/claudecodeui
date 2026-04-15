# Changelog

All notable changes to CloudCLI UI will be documented in this file.


## [1.29.3](https://github.com/siteboon/claudecodeui/compare/v1.29.2...v1.29.3) (2026-04-15)

### Bug Fixes

* **version-upgrade-modal:** implement reload countdown and update UI messages ([#655](https://github.com/siteboon/claudecodeui/issues/655)) ([6413042](https://github.com/siteboon/claudecodeui/commit/641304242d7705b54aab65faa4a7673438c92c60))

### Maintenance

* remove unused route (migrated to providers already) ([31f28a2](https://github.com/siteboon/claudecodeui/commit/31f28a2c183f6ead50941027632d7ab64b7bb2d4))

## [1.29.2](https://github.com/siteboon/claudecodeui/compare/v1.29.1...v1.29.2) (2026-04-14)

### Bug Fixes

* **sandbox:** use backgrounded sbx run to keep sandbox  alive ([9b11c03](https://github.com/siteboon/claudecodeui/commit/9b11c034d9a19710a23b56c62dcf07c21a17bd97))

## [1.29.1](https://github.com/siteboon/claudecodeui/compare/v1.29.0...v1.29.1) (2026-04-14)

### Bug Fixes

* add latest tag to docker npx command and change the detach mode to work without spawn ([4a56972](https://github.com/siteboon/claudecodeui/commit/4a569725dae320a505753359d8edfd8ca79f0fd7))

## [1.29.0](https://github.com/siteboon/claudecodeui/compare/v1.28.1...v1.29.0) (2026-04-14)

### New Features

* adding docker sandbox environments ([13e97e2](https://github.com/siteboon/claudecodeui/commit/13e97e2c71254de7a60afb5495b21064c4bc4241))

### Bug Fixes

* **thinking-mode:** fix dropdown positioning ([#646](https://github.com/siteboon/claudecodeui/issues/646)) ([c7a5baf](https://github.com/siteboon/claudecodeui/commit/c7a5baf1479404bd40e23aa58bd9f677df9a04c6))

### Maintenance

* update release flow node version ([e2459cb](https://github.com/siteboon/claudecodeui/commit/e2459cb0f8b35f54827778a7b444e6c3ca326506))

## [1.28.1](https://github.com/siteboon/claudecodeui/compare/v1.28.0...v1.28.1) (2026-04-10)

### New Features

* add branding, community links, GitHub star badge, and About settings tab ([2207d05](https://github.com/siteboon/claudecodeui/commit/2207d05c1ca229214aa9c2e2c9f4d0827d421574))

### Bug Fixes

* corrupted binary downloads ([#634](https://github.com/siteboon/claudecodeui/issues/634)) ([e61f8a5](https://github.com/siteboon/claudecodeui/commit/e61f8a543d63fe7c24a04b3d2186085a06dcbcdb))
* **ui:** remove mobile bottom nav, unify processing indicator, and improve tooltip behavior on mobile ([#632](https://github.com/siteboon/claudecodeui/issues/632)) ([a8dab0e](https://github.com/siteboon/claudecodeui/commit/a8dab0edcf949ae610820bae9500c433781f7c73))

### Refactoring

* remove unused whispher transcribe logic ([#637](https://github.com/siteboon/claudecodeui/issues/637)) ([590dd42](https://github.com/siteboon/claudecodeui/commit/590dd42649424ab990353fcf59ce0965036d3d25))

## [1.28.0](https://github.com/siteboon/claudecodeui/compare/v1.27.1...v1.28.0) (2026-04-03)

### New Features

* adding session resume in the api ([8f1042c](https://github.com/siteboon/claudecodeui/commit/8f1042cf256be282f009adcceeb55ab2dddf3fba))
* moving new session button higher ([1628868](https://github.com/siteboon/claudecodeui/commit/16288684702dec894cf054291ca3d545ddb8214b))

### Maintenance

* changing package name to @cloudcli-ai/cloudcli ([ef51de2](https://github.com/siteboon/claudecodeui/commit/ef51de259ea2b963bc15f058b084e11220bc216a))

## [1.27.1](https://github.com/siteboon/claudecodeui/compare/v1.26.3...v1.27.1) (2026-03-29)

### Bug Fixes

* prevent split on undefined（[#491](https://github.com/siteboon/claudecodeui/issues/491)） ([#563](https://github.com/siteboon/claudecodeui/issues/563)) ([b54cdf8](https://github.com/siteboon/claudecodeui/commit/b54cdf8168fc224e9907796e4229ae8ed34e6885))

### Maintenance

* add release-it github action ([42a1313](https://github.com/siteboon/claudecodeui/commit/42a131389a6954df0d2c3bedd2cb6d3406c5ebc1))
* add terminal plugin in the plugins list ([004135e](https://github.com/siteboon/claudecodeui/commit/004135ef0187023e1da29c4a7137a28a42ebf9af))
* release tokens ([f1063fd](https://github.com/siteboon/claudecodeui/commit/f1063fd33964ccb517f5ebcdd14526ed162e1138))
* relicense to AGPL-3.0-or-later ([27cd124](https://github.com/siteboon/claudecodeui/commit/27cd12432b7d3237981f86acd9cc99532d843d4a))

## [1.26.3](https://github.com/siteboon/claudecodeui/compare/v1.26.2...v1.26.3) (2026-03-22)

## [1.26.2](https://github.com/siteboon/claudecodeui/compare/v1.26.0...v1.26.2) (2026-03-21)

### Bug Fixes

* change SW cache mechanism ([17d6ec5](https://github.com/siteboon/claudecodeui/commit/17d6ec54af18d333c8b04d2ffc64793e688d996e))
* claude auth changes and adding copy on mobile ([a41d2c7](https://github.com/siteboon/claudecodeui/commit/a41d2c713e87d56f23d5884585b4bb43c43a250a))

## [1.26.0](https://github.com/siteboon/claudecodeui/compare/v1.25.2...v1.26.0) (2026-03-20)

### New Features

* add German (Deutsch) language support ([#525](https://github.com/siteboon/claudecodeui/issues/525)) ([a7299c6](https://github.com/siteboon/claudecodeui/commit/a7299c68237908c752d504c2e8eea91570a30203))
* add WebSocket proxy for plugin backends ([#553](https://github.com/siteboon/claudecodeui/issues/553)) ([88c60b7](https://github.com/siteboon/claudecodeui/commit/88c60b70b031798d51ce26c8f080a0f64d824b05))
* Browser autofill support for login form ([#521](https://github.com/siteboon/claudecodeui/issues/521)) ([72ff134](https://github.com/siteboon/claudecodeui/commit/72ff134b315b7a1d602f3cc7dd60d47c1c1c34af))
* git panel redesign ([#535](https://github.com/siteboon/claudecodeui/issues/535)) ([adb3a06](https://github.com/siteboon/claudecodeui/commit/adb3a06d7e66a6d2dbcdfb501615e617178314af))
* introduce notification system and claude notifications ([#450](https://github.com/siteboon/claudecodeui/issues/450)) ([45e71a0](https://github.com/siteboon/claudecodeui/commit/45e71a0e73b368309544165e4dcf8b7fd014e8dd))
* **refactor:** move plugins to typescript ([#557](https://github.com/siteboon/claudecodeui/issues/557)) ([612390d](https://github.com/siteboon/claudecodeui/commit/612390db536417e2f68c501329bfccf5c6795e45))
* unified message architecture with provider adapters and session store ([#558](https://github.com/siteboon/claudecodeui/issues/558)) ([a4632dc](https://github.com/siteboon/claudecodeui/commit/a4632dc4cec228a8febb7c5bae4807c358963678))

### Bug Fixes

* detect Claude auth from settings env ([#527](https://github.com/siteboon/claudecodeui/issues/527)) ([95bcee0](https://github.com/siteboon/claudecodeui/commit/95bcee0ec459f186d52aeffe100ac1a024e92909))
* remove /exit command from claude login flow during onboarding ([#552](https://github.com/siteboon/claudecodeui/issues/552)) ([4de8b78](https://github.com/siteboon/claudecodeui/commit/4de8b78c6db5d8c2c402afce0f0b4cc16d5b6496))

### Documentation

* add German language link to all README files ([#534](https://github.com/siteboon/claudecodeui/issues/534)) ([1d31c3e](https://github.com/siteboon/claudecodeui/commit/1d31c3ec8309b433a041f3099955addc8c136c35))
* **readme:** hotfix and improve for README.jp.md ([#550](https://github.com/siteboon/claudecodeui/issues/550)) ([7413c2c](https://github.com/siteboon/claudecodeui/commit/7413c2c78422c308ac949e6a83c3e9216b24b649))
* **README:** update translations with CloudCLI branding and feature restructuring ([#544](https://github.com/siteboon/claudecodeui/issues/544)) ([14aef73](https://github.com/siteboon/claudecodeui/commit/14aef73cc6085fbb519fe64aea7cac80b7d51285))

## [1.25.2](https://github.com/siteboon/claudecodeui/compare/v1.25.0...v1.25.2) (2026-03-11)

### New Features

* **i18n:** localize plugin settings for all languages ([#515](https://github.com/siteboon/claudecodeui/issues/515)) ([621853c](https://github.com/siteboon/claudecodeui/commit/621853cbfb4233b34cb8cc2e1ed10917ba424352))

### Bug Fixes

* codeql user value provided path validation ([aaa14b9](https://github.com/siteboon/claudecodeui/commit/aaa14b9fc0b9b51c4fb9d1dba40fada7cbbe0356))
* numerous bugs ([#528](https://github.com/siteboon/claudecodeui/issues/528)) ([a77f213](https://github.com/siteboon/claudecodeui/commit/a77f213dd5d0b2538dea091ab8da6e55d2002f2f))
* **security:** disable executable gray-matter frontmatter in commands ([b9c902b](https://github.com/siteboon/claudecodeui/commit/b9c902b016f411a942c8707dd07d32b60bad087c))
* session reconnect catch-up, always-on input, frozen session recovery ([#524](https://github.com/siteboon/claudecodeui/issues/524)) ([4d8fb6e](https://github.com/siteboon/claudecodeui/commit/4d8fb6e30aa03d7cdb92bd62b7709422f9d08e32))

### Refactoring

* new settings page design and new pill component ([8ddeeb0](https://github.com/siteboon/claudecodeui/commit/8ddeeb0ce8d0642560bd3fa149236011dc6e3707))

## [1.25.0](https://github.com/siteboon/claudecodeui/compare/v1.24.0...v1.25.0) (2026-03-10)

### New Features

* add copy as text or markdown feature for assistant messages ([#519](https://github.com/siteboon/claudecodeui/issues/519)) ([1dc2a20](https://github.com/siteboon/claudecodeui/commit/1dc2a205dc2a3cbf960625d7669c7c63a2b6905f))
* add full Russian language support; update Readme.md files, and .gitignore update ([#514](https://github.com/siteboon/claudecodeui/issues/514)) ([c7dcba8](https://github.com/siteboon/claudecodeui/commit/c7dcba8d9117e84db8aac7d8a7bf6a3aa683e115))
* new plugin system ([#489](https://github.com/siteboon/claudecodeui/issues/489)) ([8afb46a](https://github.com/siteboon/claudecodeui/commit/8afb46af2e5514c9284030367281793fbb014e4f))

### Bug Fixes

* resolve duplicate key issue when rendering model options ([#520](https://github.com/siteboon/claudecodeui/issues/520)) ([9bceab9](https://github.com/siteboon/claudecodeui/commit/9bceab9e1a6e063b0b4f934ed2d9f854fcc9c6a4))

### Maintenance

* add plugins section in readme ([e581a0e](https://github.com/siteboon/claudecodeui/commit/e581a0e1ccd59fd7ec7306ca76a13e73d7c674c1))

## [1.24.0](https://github.com/siteboon/claudecodeui/compare/v1.23.2...v1.24.0) (2026-03-09)

### New Features

* add full-text search across conversations ([#482](https://github.com/siteboon/claudecodeui/issues/482)) ([3950c0e](https://github.com/siteboon/claudecodeui/commit/3950c0e47f41e93227af31494690818d45c8bc7a))

### Bug Fixes

* **git:** prevent shell injection in git routes ([86c33c1](https://github.com/siteboon/claudecodeui/commit/86c33c1c0cb34176725a38f46960213714fc3e04))
* replace getDatabase with better-sqlite3 db in getGithubTokenById ([#501](https://github.com/siteboon/claudecodeui/issues/501)) ([cb4fd79](https://github.com/siteboon/claudecodeui/commit/cb4fd795c938b1cc86d47f401973bfccdd68fdee))

## [1.23.2](https://github.com/siteboon/claudecodeui/compare/v1.22.1...v1.23.2) (2026-03-06)

### New Features

* add clickable overlay buttons for CLI prompts in Shell terminal ([#480](https://github.com/siteboon/claudecodeui/issues/480)) ([2444209](https://github.com/siteboon/claudecodeui/commit/2444209723701dda2b881cea2501b239e64e51c1)), closes [#427](https://github.com/siteboon/claudecodeui/issues/427)
* add terminal shortcuts panel for mobile ([#411](https://github.com/siteboon/claudecodeui/issues/411)) ([b0a3fdf](https://github.com/siteboon/claudecodeui/commit/b0a3fdf95ffdb961261194d10400267251e42f17))
* implement session rename with SQLite storage ([#413](https://github.com/siteboon/claudecodeui/issues/413)) ([198e3da](https://github.com/siteboon/claudecodeui/commit/198e3da89b353780f53a91888384da9118995e81)), closes [#72](https://github.com/siteboon/claudecodeui/issues/72) [#358](https://github.com/siteboon/claudecodeui/issues/358)

### Bug Fixes

* **chat:** finalize terminal lifecycle to prevent stuck processing/thinking UI ([#483](https://github.com/siteboon/claudecodeui/issues/483)) ([0590c5c](https://github.com/siteboon/claudecodeui/commit/0590c5c178f4791e2b039d525ecca4d220c3dcae))
* **codex-history:** prevent AGENTS.md/internal prompt leakage when reloading Codex sessions ([#488](https://github.com/siteboon/claudecodeui/issues/488)) ([64a96b2](https://github.com/siteboon/claudecodeui/commit/64a96b24f853acb802f700810b302f0f5cf00898))
* preserve pending permission requests across WebSocket reconnections ([#462](https://github.com/siteboon/claudecodeui/issues/462)) ([4ee88f0](https://github.com/siteboon/claudecodeui/commit/4ee88f0eb0c648b54b05f006c6796fb7b09b0fae))
* prevent React 18 batching from losing messages during session sync ([#461](https://github.com/siteboon/claudecodeui/issues/461)) ([688d734](https://github.com/siteboon/claudecodeui/commit/688d73477a50773e43c85addc96212aa6290aea5))
* release it script ([dcea8a3](https://github.com/siteboon/claudecodeui/commit/dcea8a329c7d68437e1e72c8c766cf33c74637e9))

### Styling

* improve UI for processing banner ([#477](https://github.com/siteboon/claudecodeui/issues/477)) ([2320e1d](https://github.com/siteboon/claudecodeui/commit/2320e1d74b59c65b5b7fc4fa8b05fd9208f4898c))

### Maintenance

* remove logging of received WebSocket messages in production ([#487](https://github.com/siteboon/claudecodeui/issues/487)) ([9193feb](https://github.com/siteboon/claudecodeui/commit/9193feb6dc83041f3c365204648a88468bdc001b))

## [1.22.0](https://github.com/siteboon/claudecodeui/compare/v1.21.0...v1.22.0) (2026-03-03)

### New Features

* add community button in the app ([84d4634](https://github.com/siteboon/claudecodeui/commit/84d4634735f9ee13ac1c20faa0e7e31f1b77cae8))
* Advanced file editor and file tree improvements ([#444](https://github.com/siteboon/claudecodeui/issues/444)) ([9768958](https://github.com/siteboon/claudecodeui/commit/97689588aa2e8240ba4373da5f42ab444c772e72))
* update document title based on selected project ([#448](https://github.com/siteboon/claudecodeui/issues/448)) ([9e22f42](https://github.com/siteboon/claudecodeui/commit/9e22f42a3d3a781f448ddac9d133292fe103bb8c))

### Bug Fixes

* **claude:** correct project encoded path ([#451](https://github.com/siteboon/claudecodeui/issues/451)) ([9c0e864](https://github.com/siteboon/claudecodeui/commit/9c0e864532dcc5ce7ee890d3b4db722872db2b54)), closes [#447](https://github.com/siteboon/claudecodeui/issues/447)
* **claude:** move model usage log to result message only ([#454](https://github.com/siteboon/claudecodeui/issues/454)) ([506d431](https://github.com/siteboon/claudecodeui/commit/506d43144b3ec3155c3e589e7e803862c4a8f83a))
* missing translation label ([855e22f](https://github.com/siteboon/claudecodeui/commit/855e22f9176a71daa51de716370af7f19d55bfb4))

### Maintenance

* add Gemini-CLI support to README ([#453](https://github.com/siteboon/claudecodeui/issues/453)) ([503c384](https://github.com/siteboon/claudecodeui/commit/503c3846850fb843781979b0c0e10a24b07e1a4b))

## [1.21.0](https://github.com/siteboon/claudecodeui/compare/v1.20.1...v1.21.0) (2026-02-27)

### New Features

* add copy icon for user messages ([#449](https://github.com/siteboon/claudecodeui/issues/449)) ([b359c51](https://github.com/siteboon/claudecodeui/commit/b359c515277b4266fde2fb9a29b5356949c07c4f))
* Google's gemini-cli integration ([#422](https://github.com/siteboon/claudecodeui/issues/422)) ([a367edd](https://github.com/siteboon/claudecodeui/commit/a367edd51578608b3281373cb4a95169dbf17f89))
* persist active tab across reloads via localStorage ([#414](https://github.com/siteboon/claudecodeui/issues/414)) ([e3b6892](https://github.com/siteboon/claudecodeui/commit/e3b689214f11d549ffe1b3a347476d58f25c5aca)), closes [#387](https://github.com/siteboon/claudecodeui/issues/387)

### Bug Fixes

* add support for Codex in the shell ([#424](https://github.com/siteboon/claudecodeui/issues/424)) ([23801e9](https://github.com/siteboon/claudecodeui/commit/23801e9cc15d2b8d1bfc6e39aee2fae93226d1ad))

### Maintenance

* upgrade @anthropic-ai/claude-agent-sdk to version 0.2.59 and add model usage logging ([#446](https://github.com/siteboon/claudecodeui/issues/446)) ([917c353](https://github.com/siteboon/claudecodeui/commit/917c353115653ee288bf97be01f62fad24123cbc))
* upgrade better-sqlite to latest version to support node 25 ([#445](https://github.com/siteboon/claudecodeui/issues/445)) ([4ab94fc](https://github.com/siteboon/claudecodeui/commit/4ab94fce4257e1e20370fa83fa4c0f6fadbb8a2b))

## [1.20.1](https://github.com/siteboon/claudecodeui/compare/v1.19.1...v1.20.1) (2026-02-23)

### New Features

* implement install mode detection and update commands in version upgrade process ([f986004](https://github.com/siteboon/claudecodeui/commit/f986004319207b068431f9f6adf338a8ce8decfc))
* migrate legacy database to new location and improve last login update handling ([50e097d](https://github.com/siteboon/claudecodeui/commit/50e097d4ac498aa9f1803ef3564843721833dc19))

## [1.19.1](https://github.com/siteboon/claudecodeui/compare/v1.19.0...v1.19.1) (2026-02-23)

### Bug Fixes

* add prepublishOnly script to build before publishing ([82efac4](https://github.com/siteboon/claudecodeui/commit/82efac4704cab11ed8d1a05fe84f41312140b223))

## [1.19.0](https://github.com/siteboon/claudecodeui/compare/v1.18.2...v1.19.0) (2026-02-23)

### New Features

* add HOST environment variable for configurable bind address ([#360](https://github.com/siteboon/claudecodeui/issues/360)) ([cccd915](https://github.com/siteboon/claudecodeui/commit/cccd915c336192216b6e6f68e2b5f3ece0ccf966))
* subagent tool grouping ([#398](https://github.com/siteboon/claudecodeui/issues/398)) ([0207a1f](https://github.com/siteboon/claudecodeui/commit/0207a1f3a3c87f1c6c1aee8213be999b23289386))

### Bug Fixes

* **macos:** fix node-pty posix_spawnp error with postinstall script ([#347](https://github.com/siteboon/claudecodeui/issues/347)) ([38a593c](https://github.com/siteboon/claudecodeui/commit/38a593c97fdb2bb7f051e09e8e99c16035448655)), closes [#284](https://github.com/siteboon/claudecodeui/issues/284)
* slash commands with arguments bypass command execution ([#392](https://github.com/siteboon/claudecodeui/issues/392)) ([597e9c5](https://github.com/siteboon/claudecodeui/commit/597e9c54b76e7c6cd1947299c668c78d24019cab))

### Refactoring

* **releases:** Create a contributing guide and proper release notes using a release-it plugin ([fc369d0](https://github.com/siteboon/claudecodeui/commit/fc369d047e13cba9443fe36c0b6bb2ce3beaf61c))

### Maintenance

* update @anthropic-ai/claude-agent-sdk to version 0.1.77 in package-lock.json ([#410](https://github.com/siteboon/claudecodeui/issues/410)) ([7ccbc8d](https://github.com/siteboon/claudecodeui/commit/7ccbc8d92d440e18c157b656c9ea2635044a64f6))
