<div align="center">
  <img src="public/logo.svg" alt="CloudCLI UI" width="64" height="64">
  <h1>Cloud CLI (Claude Code UI olarak da bilinir)</h1>
  <p><a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a>, <a href="https://docs.cursor.com/en/cli/overview">Cursor CLI</a>, <a href="https://developers.openai.com/codex">Codex</a> ve <a href="https://geminicli.com/">Gemini-CLI</a> için masaüstü ve mobil arayüz.<br>Yerel ya da uzaktan kullanarak aktif projelerine ve oturumlarına her yerden erişebilirsin.</p>
</div>

<p align="center">
  <a href="https://cloudcli.ai">CloudCLI Cloud</a> · <a href="https://cloudcli.ai/docs">Dokümantasyon</a> · <a href="https://discord.gg/buxwujPNRE">Discord</a> · <a href="https://github.com/siteboon/claudecodeui/issues">Sorun Bildir</a> · <a href="CONTRIBUTING.md">Katkıda Bulun</a>
</p>

<p align="center">
  <a href="https://cloudcli.ai"><img src="https://img.shields.io/badge/☁️_CloudCLI_Cloud-Hemen_Dene-0066FF?style=for-the-badge" alt="CloudCLI Cloud"></a>
  <a href="https://discord.gg/buxwujPNRE"><img src="https://img.shields.io/badge/Discord-Toplulu%C4%9Fa%20Kat%C4%B1l-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord'a Katıl"></a>
  <br><br>
  <a href="https://trendshift.io/repositories/15586" target="_blank"><img src="https://trendshift.io/api/badge/repositories/15586" alt="siteboon%2Fclaudecodeui | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<div align="right"><i><a href="./README.md">English</a> · <a href="./README.ru.md">Русский</a> · <a href="./README.de.md">Deutsch</a> · <a href="./README.ko.md">한국어</a> · <a href="./README.zh-CN.md">中文</a> · <a href="./README.ja.md">日本語</a> · <b>Türkçe</b></i></div>

---

## Ekran Görüntüleri

<div align="center">

<table>
<tr>
<td align="center">
<h3>Masaüstü Görünümü</h3>
<img src="public/screenshots/desktop-main.png" alt="Masaüstü Arayüzü" width="400">
<br>
<em>Proje genel bakışı ve sohbeti gösteren ana arayüz</em>
</td>
<td align="center">
<h3>Mobil Deneyim</h3>
<img src="public/screenshots/mobile-chat.png" alt="Mobil Arayüz" width="250">
<br>
<em>Dokunma gezinmesiyle duyarlı mobil tasarım</em>
</td>
</tr>
<tr>
<td align="center" colspan="2">
<h3>CLI Seçimi</h3>
<img src="public/screenshots/cli-selection.png" alt="CLI Seçimi" width="400">
<br>
<em>Claude Code, Gemini, Cursor CLI ve Codex arasında seçim yap</em>
</td>
</tr>
</table>



</div>

## Özellikler

- **Duyarlı Tasarım** — Masaüstü, tablet ve mobilde sorunsuz çalışır; böylece ajanlarını telefondan da kullanabilirsin
- **Etkileşimli Sohbet Arayüzü** — Ajanlarla akıcı iletişim için dahili sohbet arayüzü
- **Entegre Shell Terminali** — Yerleşik shell özelliği üzerinden ajan CLI'larına doğrudan erişim
- **Dosya Gezgini** — Sözdizimi vurgulama ve canlı düzenleme ile etkileşimli dosya ağacı
- **Git Gezgini** — Değişikliklerini görüntüle, staging'e ekle ve commit'le. Dallar arası geçiş de yapabilirsin
- **Oturum Yönetimi** — Konuşmalara devam et, birden fazla oturumu yönet ve geçmişi takip et
- **Eklenti Sistemi** — CloudCLI'ı özel eklentilerle genişlet: yeni sekmeler, arka uç servisleri ve entegrasyonlar ekle. [Kendi eklentini yaz →](https://github.com/cloudcli-ai/cloudcli-plugin-starter)
- **TaskMaster AI Entegrasyonu** *(İsteğe Bağlı)* — AI destekli görev planlama, PRD ayrıştırma ve iş akışı otomasyonu ile gelişmiş proje yönetimi
- **Model Uyumluluğu** — Claude, GPT ve Gemini model aileleriyle çalışır (desteklenen tüm modeller için [`shared/modelConstants.js`](shared/modelConstants.js) dosyasına bak)


## Hızlı Başlangıç

### CloudCLI Cloud (Önerilen)

Başlamanın en hızlı yolu — yerel kurulum yok. Web, mobil uygulama, API veya favori IDE'nden erişilebilen, tam yönetilen, konteyner tabanlı bir geliştirme ortamına sahip ol.

**[CloudCLI Cloud ile başla](https://cloudcli.ai)**


### Kendin Barındır (Açık Kaynak)

#### npm

CloudCLI UI'yi **npx** ile anında dene (**Node.js** v22+ gerekir):

```
npx @cloudcli-ai/cloudcli
```

Veya düzenli kullanım için **genel olarak** kur:

```
npm install -g @cloudcli-ai/cloudcli
cloudcli
```

`http://localhost:3001` adresini aç — mevcut tüm oturumların otomatik olarak keşfedilir.

Tam yapılandırma seçenekleri, PM2, uzak sunucu kurulumu ve daha fazlası için **[dokümantasyonu ziyaret et →](https://cloudcli.ai/docs)**.

#### Docker Sandbox'lar (Deneysel)

Ajanları hipervizör seviyesinde izolasyonlu sandbox'larda çalıştır. Varsayılan olarak Claude Code başlar. [`sbx` CLI](https://docs.docker.com/ai/sandboxes/get-started/) gerekir.

```
npx @cloudcli-ai/cloudcli@latest sandbox ~/my-project
```

Claude Code, Codex ve Gemini CLI destekler. Kurulum ve gelişmiş seçenekler için [sandbox dokümantasyonuna](docker/) bak.


---

## Hangi seçenek sana uygun?

CloudCLI UI, CloudCLI Cloud'u güçlendiren açık kaynak arayüz katmanıdır. Kendi makinende barındırabilir, izolasyon için Docker sandbox'ta çalıştırabilir veya tam yönetilen ortam için CloudCLI Cloud kullanabilirsin.

| | Kendin Barındır (npm) | Kendin Barındır (Docker Sandbox) *(Deneysel)* | CloudCLI Cloud |
|---|---|---|---|
| **En iyi şunun için** | Kendi makinende yerel ajan oturumları | Web/mobil IDE ile izole ajanlar | Ajanlarını bulutta isteyen ekipler |
| **Nasıl erişilir** | `[yourip]:port` üzerinden tarayıcıda | `localhost:port` üzerinden tarayıcıda | Tarayıcı, herhangi bir IDE, REST API, n8n |
| **Kurulum** | `npx @cloudcli-ai/cloudcli` | `npx @cloudcli-ai/cloudcli@latest sandbox ~/project` | Kurulum gerekmez |
| **İzolasyon** | Kendi host'unda çalışır | Hipervizör seviyesi sandbox (microVM) | Tam bulut izolasyonu |
| **Makinenin açık kalması gerek** | Evet | Evet | Hayır |
| **Mobil erişim** | Ağındaki herhangi bir tarayıcı | Ağındaki herhangi bir tarayıcı | Herhangi bir cihaz, native uygulama yolda |
| **Desteklenen ajanlar** | Claude Code, Cursor CLI, Codex, Gemini CLI | Claude Code, Codex, Gemini CLI | Claude Code, Cursor CLI, Codex, Gemini CLI |
| **Dosya gezgini ve Git** | Evet | Evet | Evet |
| **MCP yapılandırması** | `~/.claude` ile senkron | UI üzerinden yönetilir | UI üzerinden yönetilir |
| **REST API** | Evet | Evet | Evet |
| **Ekip paylaşımı** | Hayır | Hayır | Evet |
| **Platform maliyeti** | Ücretsiz, açık kaynak | Ücretsiz, açık kaynak | Aylık 7 $'dan başlar |

> Tüm seçenekler kendi AI aboneliklerini (Claude, Cursor, vb.) kullanır — CloudCLI AI'ı değil, ortamı sağlar.

---

## Güvenlik ve Araç Yapılandırması

**🔒 Önemli Uyarı**: Tüm Claude Code araçları **varsayılan olarak devre dışıdır**. Bu, potansiyel olarak zararlı işlemlerin otomatik çalışmasını önler.

### Araçları Etkinleştirme

Claude Code'un tam işlevselliğinden yararlanmak için araçları manuel olarak etkinleştirmen gerekir:

1. **Araç Ayarlarını Aç** — Kenar çubuğundaki dişli simgesine tıkla
2. **Seçerek Etkinleştir** — Yalnızca ihtiyacın olan araçları aç
3. **Ayarları Uygula** — Tercihlerin yerel olarak kaydedilir

<div align="center">

![Araç Ayarları Modalı](public/screenshots/tools-modal.png)
*Araç Ayarları arayüzü — yalnızca ihtiyacın olanı etkinleştir*

</div>

**Önerilen yaklaşım**: Temel araçlarla başla ve gerektikçe daha fazlasını ekle. Bu ayarları sonra her zaman değiştirebilirsin.

---

## Eklentiler

CloudCLI, kendi frontend UI'sı ve isteğe bağlı Node.js arka ucu olan özel sekmeler eklemeni sağlayan bir eklenti sistemine sahiptir. Git depolarından eklentileri doğrudan **Ayarlar > Eklentiler**'den yükleyebilir veya kendi eklentini yazabilirsin.

### Mevcut Eklentiler

| Eklenti | Açıklama |
|---|---|
| **[Project Stats](https://github.com/cloudcli-ai/cloudcli-plugin-starter)** | Mevcut projen için dosya sayıları, kod satırları, dosya türü dağılımı, en büyük dosyalar ve son değiştirilen dosyaları gösterir |
| **[Web Terminal](https://github.com/cloudcli-ai/cloudcli-plugin-terminal)** | Çoklu sekme destekli tam xterm.js terminali |

### Kendi Eklentini Yaz

**[Plugin Starter Şablonu →](https://github.com/cloudcli-ai/cloudcli-plugin-starter)** — kendi eklentini oluşturmak için bu repo'yu fork'la. Frontend render, canlı bağlam güncellemeleri ve arka uç sunucusuyla RPC iletişimi içeren çalışan bir örnek içerir.

**[Plugin Dokümantasyonu →](https://cloudcli.ai/docs/plugin-overview)** — plugin API'sı, manifest formatı, güvenlik modeli ve daha fazlası için tam rehber.

---
## Sık Sorulan Sorular

<details>
<summary>Bu Claude Code Remote Control'dan nasıl farklı?</summary>

Claude Code Remote Control, yerel terminalinde zaten çalışan bir oturuma mesaj göndermeni sağlar. Makinen açık kalmak zorunda, terminalin açık kalmak zorunda ve ağ bağlantısı olmadan yaklaşık 10 dakika sonra oturumlar zaman aşımına uğrar.

CloudCLI UI ve CloudCLI Cloud, Claude Code'un yanında değil içinde çalışır — MCP sunucuların, izinlerin, ayarların ve oturumların, Claude Code'un yerel olarak kullandığının birebir aynısıdır. Hiçbir şey çoğaltılmaz veya ayrı yönetilmez.

Pratikte bu ne demek:

- **Tek oturum değil, tüm oturumların** — CloudCLI UI, `~/.claude` klasöründeki her oturumu otomatik keşfeder. Remote Control yalnızca tek aktif oturumu Claude mobil uygulamasına açar.
- **Ayarların sana ait** — UI'da değiştirdiğin MCP sunucuları, araç izinleri ve proje yapılandırması doğrudan Claude Code yapılandırmana yazılır ve anında etkili olur; tersi de geçerli.
- **Daha fazla ajanla çalışır** — Sadece Claude Code değil; Cursor CLI, Codex ve Gemini CLI de.
- **Sadece sohbet penceresi değil, tam UI** — dosya gezgini, Git entegrasyonu, MCP yönetimi ve shell terminali hepsi yerleşik.
- **CloudCLI Cloud bulutta çalışır** — laptop'unu kapat, ajan çalışmaya devam eder. Beklemen gereken terminal yok, uyanık tutman gereken makine yok.

</details>

<details>
<summary>AI aboneliği için ayrıca ödeme yapmam gerekiyor mu?</summary>

Evet. CloudCLI AI'yi değil, ortamı sağlar. Kendi Claude, Cursor, Codex veya Gemini aboneliğini getirirsin. CloudCLI Cloud, barındırılan ortam için aylık 7 $'dan başlar — bunun üzerine eklenir.

</details>

<details>
<summary>CloudCLI UI'yi telefonumda kullanabilir miyim?</summary>

Evet. Kendin barındırdığında, sunucuyu makinende çalıştır ve ağındaki herhangi bir tarayıcıda `[yourip]:port` adresini aç. CloudCLI Cloud için, herhangi bir cihazdan aç — VPN yok, port yönlendirme yok, kurulum yok. Native bir uygulama da hazırlanıyor.

</details>

<details>
<summary>UI'da yaptığım değişiklikler yerel Claude Code kurulumumu etkiler mi?</summary>

Evet, kendin barındırdığında. CloudCLI UI, Claude Code'un yerel olarak kullandığı aynı `~/.claude` yapılandırmasından okur ve ona yazar. UI üzerinden eklediğin MCP sunucuları Claude Code'da anında görünür; tersi de geçerli.

</details>

---

## Topluluk ve Destek

- **[Dokümantasyon](https://cloudcli.ai/docs)** — kurulum, yapılandırma, özellikler ve sorun giderme
- **[Discord](https://discord.gg/buxwujPNRE)** — yardım al ve diğer kullanıcılarla tanış
- **[GitHub Issues](https://github.com/siteboon/claudecodeui/issues)** — hata raporları ve özellik istekleri
- **[Katkı Rehberi](CONTRIBUTING.md)** — projeye nasıl katkıda bulunulur

## Lisans

GNU Affero General Public License v3.0 veya sonrası (AGPL-3.0-or-later) — tam metin ve Bölüm 7 altındaki ek şartlar için [LICENSE](LICENSE) dosyasına bak.

Bu proje açık kaynaklıdır ve AGPL-3.0-or-later lisansı altında özgürce kullanılabilir, değiştirilebilir ve dağıtılabilir. Bu yazılımı değiştirir ve bir ağ servisi olarak çalıştırırsan, değiştirilmiş kaynak kodunu o servisin kullanıcılarına sunmak zorundasın.

CloudCLI UI — (https://cloudcli.ai).

## Teşekkürler

### Kullanılan Teknolojiler
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** — Anthropic'in resmi CLI'ı
- **[Cursor CLI](https://docs.cursor.com/en/cli/overview)** — Cursor'un resmi CLI'ı
- **[Codex](https://developers.openai.com/codex)** — OpenAI Codex
- **[Gemini-CLI](https://geminicli.com/)** — Google Gemini CLI
- **[React](https://react.dev/)** — Kullanıcı arayüzü kütüphanesi
- **[Vite](https://vitejs.dev/)** — Hızlı derleme aracı ve geliştirme sunucusu
- **[Tailwind CSS](https://tailwindcss.com/)** — Utility-first CSS framework
- **[CodeMirror](https://codemirror.net/)** — Gelişmiş kod editörü
- **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)** *(İsteğe Bağlı)* — AI destekli proje yönetimi ve görev planlama


### Sponsorlar
- [Siteboon — AI destekli web sitesi oluşturucu](https://siteboon.ai)
---

<div align="center">
  <strong>Claude Code, Cursor ve Codex topluluğu için özenle yapıldı.</strong>
</div>
