# ANSYS yerel entegrasyonu — Phase 6 doğrulama ve sürüm kararı (2026-10-22)

Bu rapor yalnızca bu branch'teki ANSYS Student 2026 R1 yerel köprüsünü kapsar.
Dinamik/kinematik çözücülerin daha eski **Phase 6** belgeleri ayrı kapsamdır.
Örnek ANSYS CAD'i gerçek MSKU Racing parçası değildir. Fiziksel araç doğruluğu
ve mühendislik kullanım onayı **BLOCKED**; bu karar `Done` veya test geçmesiyle
otomatik değişmez.

## Denetlenen yol ve birimler

1. Tarayıcı yalnızca kullanıcı eylemiyle tokenlı `127.0.0.1:8765` köprüsüne
   bağlanır. Vercel ANSYS çalıştırmaz, CAD yolunu veya tokenı almaz.
2. CAD yerel AGDB/PMDB/STEP dosyasıdır; SHA-256 içeriğini tanımlar, CAD'in
   doğru gerçek araç parçası olduğunu kanıtlamaz. İçe aktarılan gövde, named
   mesnet/yük seçimi sayısı ve seçimlerin ayrıklığı denetlenir. Seçimlerin
   *gerçek* montaj/yük yüzeyleri olduğu henüz doğrulanmamıştır.
3. Studio araç eksenleri sağ elli `+X` ileri, `+Y` sol, `+Z` yukarı ve metre;
   CAD beyanı yine sağ elli dönüşüm (`det R=+1`) ve milimetre kullanır:
   `p_CAD,mm = 1000 R (p_vehicle,m - origin_vehicle,m)`.
   Kuvvet `F_CAD,N = R F_vehicle,N` ile aktarılır; N için 1000 çarpanı yoktur.
   Üç doğrusal olmayan kullanıcının beyan ettiği anchor noktasının farkı
   kontrol edilir. Bu, CAD topolojisiyle otomatik kayıt değildir. Dokuz
   dönüştürülmüş hardpoint Mechanical oturumunda izleme değişkenidir; CAD'e
   bağlanmaz. Quasi-static uygulama noktası artık veri kaynağı olarak korunur,
   ancak bir CAD yüzeyine/moment koluna eşlenmediği için yük bu noktaya
   *uygulanmaz*. Sıfır olmayan moment girdisi reddedilmeye devam eder.
4. Structural Steel, ANSYS kütüphane varsayımıdır; takım malzeme ölçümü
   değildir. Static Structural yükü farklı bir named seçimde bileşenler veya
   tek eksen üzerinden N cinsinden uygulanır. Sabit mesnet idealdir;
   mafsal/temas ve şasi esnekliği modellenmez. Modal aynı CAD/malzeme/mesnet
   tanımıyla, statik kuvvet ve öngerilme olmadan çözülür.
5. Mechanical MKS kullanır. Çıktıdaki gerilme Pa, toplam deformasyon m,
   doğal frekans Hz'dir. Arayüz statik değerleri MPa/mm'ye yalnızca gösterim
   için çevirir. Modal mod şekli ölçeği gerçek zorlanmış deplasman değildir.

## Yeni kabul ve rapor kapıları

- Static ve Modal sonuçları için Mechanical `Done`, sonlu ve beklenen birimde
  sayılar, pozitif mesh/gövde/seçim sayıları ve **boş olmayan `file.rst`** gerekir.
  Static her mesh adımında dosyayı ayrıca kontrol eder. Yalnızca optimizasyon
  durumu veya bir sonuç nesnesinin varlığı yeterli değildir.
- Static rapor, üç adımın mesh boyutu/düğüm/eleman sırasını, her adımın sonuç
  dosyası kanıtını, son adımla yayımlanan sonucun eşitliğini, kaba→orta ve
  orta→ince göreli farkları bağımsız olarak yeniden hesaplar. Kayıtlı
  `PASSED_NUMERICALLY` bu eğilimle çelişirse rapor reddedilir. Bu tarama
  yalnızca **küresel maksimum** gerilme/deformasyona ilişkindir; uzaysal alan
  yakınsaması değildir.
- Mechanical `ElementQuality` ölçümünün min/ortalama/maks değerleri raporda
  sayısal ve sıralı olmalıdır; yoksa `UNVERIFIED`. Bir küresel kalite özeti
  Jacobian ve kalınlık boyunca eleman sayısı denetimi değildir. Şekil-check
  komutunun çözücü girdisindeki varlığı ayrı kanıttır; bütün elemanların
  geçtiğine eşit değildir.
- Token korumalı `GET .../{job_id}/report` sadece başarılı ve kanıtı tam iş
  için sürümlü JSON rapor üretir. Yol (özel CAD dosya adresi) ve token dışarı
  verilmez; CAD içerik hash'i, iş kimliği, istek parametreleri, sonuçlar,
  uyarılar, `VERIFIED`/`UNVERIFIED`/`BLOCKED` kontrol listesi ve eksikler
  dahil edilir. `VERIFIED` burada yalnızca belirtilen **sayısal/yazılım
  kanıtı** anlamındadır. Bütün raporlarda `physicalValidation=UNVERIFIED`,
  `releaseReadiness=BLOCKED`, `approvedForEngineeringUse=false` sabittir.
  Başarısız/tamamlanmamış iş raporlanmaz. Son iş bellekte tutulur; kalıcı,
  imzalı arşiv veya insan onay süreci yoktur. Tarayıcı raporu yerel JSON
  olarak indirir; Vercel'e yüklemez.

## Tekrarlanabilir kanıt ve örnek sonuçlar

Kullanılan küçük, bağımsız PyMechanical örnek CAD SHA-256:
`49756ab321a4736c5ba94a318e5bf38363a032c8a9c210a817ce1910c1a201f8`.
Yerel Student v261 kurulumu, PyMechanical üzerinden yazılabilir Mechanical
prosesini ve iki çekirdekli gerçek çözümleri doğruladı. Proses ürün metni
`Ansys Mechanical Enterprise` dedi; bu metin tek başına hangi akademik
lisans özelliğinin tahsis edildiğinin kanıtı değildir. Lisans kontrolü
atlatılmadı ve iç Workbench bayrakları kullanılmadı.

| Deneme | Mechanical / sonuç dosyası | Ölçülen sonuç | Durum |
| --- | --- | --- | --- |
| Static, 500 mm | `Done`, `.rst` 1.441.792 bayt; 4.464 düğüm/840 eleman | 253,5319357825563 Pa; 7,250757351503458e-9 m | `VERIFIED` sayısal, fiziksel `UNVERIFIED` |
| Modal, 500 mm | `Done`, `.rst` 1.179.648 bayt; 4.464 düğüm/840 eleman | 21,609975179192634 / 21,609977898586124 / 56,38194648923333 Hz | `VERIFIED` sayısal, modal yakınsama `UNVERIFIED` |
| Static tarayıcı→köprü→ANSYS→tarayıcı, 500/400/300 mm | Üç gerçek `Done`; son adım 14.404 düğüm/2.925 eleman | 253,5319357825563 → 264,88754152944796 → 278,7390026061557 Pa; son deformasyon 7,259030706281926e-9 m | `NOT_CONVERGED`, raporda `BLOCKED` |

Gerçek tarayıcı testinde yanlış CAD yolu sayısal sonuç vermedi. Başarılı
analizlerde MPa/mm ve Hz görünümü ile statik/modal JSON indirmeleri denetlendi;
indirilen dosyalarda CAD yolu yok, fiziksel onay `false` idi. Kütüphane
malzemesi ve fiziksel doğrulama eksikliği tarayıcıda görünür kaldı.

Üç meshli örneğin tepe gerilmesinde kaba→orta fark %4,287, orta→ince
fark %4,969'dur: son fark büyüdüğü için mevcut %5 eşiğinin tek başına
altında olması yeterli değildir. `NOT_CONVERGED` **gizlenmedi**. Artış
bir mesnet/yük kenarı tekilliğinden, yerel hot-spot hareketinden, mesh
dağılımından veya başka bir etkiden kaynaklanabilir; mevcut küresel
maksimumlar nedeni ayırt edemez. Uzaysal gerilme konumu/alanı, daha ince
mesh, alternatif fiziksel BC ve eleman tip/kalınlık incelemesi gerekir.
Statik MAPDL iki `MP/TB` malzeme-enerji uyarısı vermeye devam etti. Önceki
incelemede üretilen yük-yüzeyi elemanıyla ilişkili görülmüştü; mevcut
çözümde her eleman tipi yeniden kanıtlanmadı. Enerji sonucu dışa aktarılmıyor;
uyarı teknik raporda ve arayüzde korunuyor. Eski shape-inactive ve PCG
uyarıları bu örnekte yoktu.

Son kapılar: 217 Python testi (mühendislik, API, köprü), Ruff, mypy,
ESLint, TypeScript, 67 frontend testi, üretim build'i, 13 normal Chromium
akışı (lisanslı test varsayılan pakette atlandı) ve ayrı opt-in **gerçek**
Student Chromium akışı geçti. FastAPI TestClient için bir Starlette/httpx
deprecation uyarısı ve Vite büyük-bundle tavsiyesi sürüyor; test hatası
değiller. CI gerçek ANSYS koşturmaz; fake istemci testleri lisanslı çözücü
veya fiziksel doğrulama kanıtı sayılmaz.

**Tekrarlanabilirlik sınırlaması (2026-10-23):** Son rapor-kaynak tutarlılığı
değişikliğinden sonra aynı lisanslı Chromium akışı tekrar çalıştırıldı.
Static üç gerçek çözüm, görünür `NOT_CONVERGED` ve indirilen Static rapor
başarıyla doğrulandı; ardından Modal işi `RUNNING/importing` durumunda kaldı
ve 600 saniyelik tarayıcı test sınırına ulaştı. Bu tekrarı **geçti** diye
saymıyoruz. Köprü bağlantısı daha sonra hâlâ `VERIFIED` bildiriyordu, ancak
bu Modal çözüm kanıtı değildir. Doğrudan Modal smoke ve önceki tam Chromium
akışı geçmişti. Yeni rapor aritmetiğinin bu hang'e neden olduğuna ilişkin
kanıt yok; Mechanical oturumu/import takılması ile test-ortamı gecikmesi
ayrıştırılamadı. Kök neden için proses/RPC ve Mechanical mesaj zaman çizelgesi
toplanmalı, art arda analizler yinelenmeli. Bu nedenle uçtan uca
tekrarlanabilirlik ve üretim güvenilirliği **BLOCKED** olarak kalır.

**23 Ekim takip incelemesi:** [ayrıntılı gerçek koşu kanıtı](ANSYS_PHASE_6_REPEAT_EVIDENCE_2026-10-23.md)
ile aynı yazılabilir Mechanical oturumunda üç doğrudan 3-mesh Static→Modal
çifti ve ayrı bir tarayıcı→localhost bridge→ANSYS→tarayıcı oturumunda üç
Static→Modal çifti art arda tamamlandı. Önceki tekil 600 sn import takılması
yeniden üretilemedi. Eski logda `importing` aşaması proje temizleme ile CAD
içe aktarmayı ayırmadığı ve RPC zaman çizelgesi bulunmadığı için kesin kök
neden **bilinmiyor**. Yeni aşama mesajları, 300 sn varsayılan bekleme sınırı,
geç sonuç reddi ve oturum karantinası güvenli başarısızlığı sağlar; takılmış
Mechanical çağrısının işletim sistemi seviyesinde zorla iptal edildiği iddia
edilmez. Bu tekrarlı yazılım testi önceki başarısız denemeyi silmez veya
gerçek araç sonuçlarını fiziksel olarak doğrulamaz.

## Sürüm kararı ve açık eksikler

| Durum | Gözlem | Gereken sonraki kanıt |
| --- | --- | --- |
| `VERIFIED` (yazılım/sayısal) | Yerel güvenlik kapısı, gerçek örnek Static/Modal `Done`, dosya/birim/sonlu değer kontrolleri, tarayıcı rapor akışı | Diğer ANSYS sürümleri ve gerçek parça konfigürasyonlarında tekrar |
| `UNVERIFIED` (mühendislik) | Gerçek araç CAD-topoloji kaydı, measured malzeme ve yoğunluk, yük yüzeyi/noktası, gerçek mesnet/mafsal/temas, modal mesh ve fiziksel test korelasyonu yok | CAD revizyonu + ölçümler + test düzeneği/araç korelasyonu ve bağımsız benchmark |
| `BLOCKED` | Örnek küresel max gerilme `NOT_CONVERGED`; gerçek araç sonucu için fiziksel onay yok. Tarihsel Modal import timeout'unun kesin nedeni saptanmadı; sonraki üçlü tekrar geçti. | Uzaysal ve yük/BC duyarlılığıyla tekillik araştırması, mesh yakınsaması, timeout tekrarlarsa yeni aşama/RPC logları, uzman incelemesi |

Yazılım entegrasyonu PR incelemesine hazır olabilir; gerçek Formula Student
tasarım kararları için **yayın/onay hazır değildir**. ANSYS Student sınırları
ön kontrol olarak 128.000 düğüm/eleman ve iki çekirdekten ibaret değildir:
çözücü kendi lisans ve model limitlerini ayrıca uygular; takımın kullanım
hakkı sorumlular tarafından doğrulanmalıdır.

Kaynaklar: [Mechanical mesh convergence açıklaması](https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/wb_sim/ds_Convergence.html),
[v261 NamedSelection API](https://scripting.mechanical.docs.pyansys.com/version/stable/api/ansys/mechanical/stubs/v261/Ansys/ACT/Automation/Mechanical/NamedSelection.html),
[ANSYS Student koşulları ve sınırları](https://www.ansys.com/academic/students/ansys-student).
