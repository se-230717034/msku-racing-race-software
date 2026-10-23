# Phase 6: Modal import timeout ve art arda gerçek çözüm incelemesi

Tarih: 2026-10-23. Dal: `codex/ansys-local-bridge-phase-6` (PR #8; main'e
merge edilmedi). Tüm değerler yerel ANSYS Student 2026 R1 ve bağımsız
PyMechanical örnek AGDB CAD'i için geçerlidir; gerçek MSKU araç parçası
değildir. CAD SHA-256:
`49756ab321a4736c5ba94a318e5bf38363a032c8a9c210a817ce1910c1a201f8`.

## Önceki başarısız deneme ve kanıt sınırı

Önceki gerçek Chromium tekrarında 3-mesh Static `Done`, `NOT_CONVERGED` ve
Static rapor indirmesi tamamlandı. Ardından Modal işi 600 sn test sınırında
`RUNNING/importing` kaldı; Modal için `Done`, sonuç dosyası ve frekans
kanıtı **yoktu**. Eski `importing` mesajı `client.clear()` ile CAD kurulum
çağrısını ayırmıyordu. Geriye dönük RPC izleği veya bu iş için Mechanical
mesaj dökümü olmadığı için beklemenin hangisinde olduğunu ve kesin kök
nedeni söylemek mümkün değildir. Bridge'in `VERIFIED` göstermesi, çalışan
gRPC çağrısının tamamlandığının kanıtı değildi. Bu başarısızlık gizlenmedi.

## Kontrollü gerçek tekrarlar

İlk tanılamada aynı yazılabilir Mechanical prosesinde üç kez 500/400/300 mm
meshli Static, ardından 500 mm Modal çalıştırıldı. `project.clear`, CAD
import, mesh, solve, sonuç okuma çağrıları bağımsız olarak zamanlandı.

| Doğrudan tur | Static | Modal | Çift süre | Modal proje temizliği | Modal CAD import |
| --- | --- | --- | ---: | ---: | ---: |
| 1 | Üç `Done`; `NOT_CONVERGED` | `Done`; 3 sonlu/pozitif Hz | 112,11 sn | 0,281 sn | 9,203 sn |
| 2 | Üç `Done`; `NOT_CONVERGED` | `Done`; 3 sonlu/pozitif Hz | 108,50 sn | 0,282 sn | 9,250 sn |
| 3 | Üç `Done`; `NOT_CONVERGED` | `Done`; 3 sonlu/pozitif Hz | 106,89 sn | 0,297 sn | 9,281 sn |

Üç Modal frekans kümesi aynı örnekte 21,609975179192634 / 21,609977898586124 /
56,38194648923333 Hz oldu. Bu yalnızca tekrarlı sayısal sonuçtur; modal
mesh yakınsaması ve deney korelasyonu değildir. `run_static_structural` ve
`run_modal_analysis` sonlu/birimli değerler, Mechanical `Done` ve boş olmayan
`.rst` dosyası olmadan sonuç döndürmez. Tanılama betiği:
`services/ansys_bridge/scripts/real_sequential_diagnostic.py`.

İkinci, bağımsız uçtan uca test Chromium arayüzünden tokenlı localhost bridge'e
gitti, aynı bridge-owned Mechanical prosesinde üç kez 500 mm Static→Modal
çalıştırdı ve her sonucu tekrar tarayıcıda kontrol etti. Her Static için
pozitif/sonlu Pa ve m, her Modal için üç pozitif/sonlu Hz, CAD hash'i,
`Done` ve `NUMERIC_RESULT_UNVALIDATED_PHYSICALLY` kapıları geçti.

| Tarayıcı turu | Static iş / süre / durum | Modal iş / süre / durum | Çift süre |
| --- | --- | --- | ---: |
| 1 | `7af132d2-8566-4430-8338-0f85da0b066a`, 125,134 sn, `SUCCEEDED/Done` | `6bf9c839-14c7-4243-89da-3312f1992dd2`, 119,658 sn, `SUCCEEDED/Done` | 244,792 sn |
| 2 | `afebeaad-1f96-46a7-bb0e-c5d2cf7d5038`, 103,008 sn, `SUCCEEDED/Done` | `b9d6452c-80df-4114-8645-95d4b986c147`, 123,740 sn, `SUCCEEDED/Done` | 226,748 sn |
| 3 | `69d2b0e9-8fe7-477d-87c6-3e320f10de15`, 101,254 sn, `SUCCEEDED/Done` | `640d0725-21a6-49a6-872b-fce6388b3962`, 103,165 sn, `SUCCEEDED/Done` | 204,419 sn |

Playwright `ansys-real-repeat.spec.ts` toplam 13,7 dk'da geçti. Testin
Static kısmı tek mesh kullanır; **Static mesh yakınsaması iddia etmez**.
Önceki ve doğrudan 3-mesh incelemelerinde `NOT_CONVERGED` korundu. Modal
mesh yakınsaması `NOT_ASSESSED` ve fiziksel doğrulama `UNVERIFIED` kalır.

Son Modal koşusu sırasında canlı MAPDL `solve.out` içinde `Ansys Mechanical
Enterprise Academic Student`, `RUN COMPLETED`, sıfır uyarı ve sıfır hata
işareti; `file.rst` 1.179.648 bayt görüldü. Mechanical ürün bilgisindeki
`Enterprise` ibaresi tek başına lisans checkout'u sayılmadı; Academic Student
ürün satırı gerçek solver çıktısından okundu. Lisans denetimi atlatılmadı,
iki çekirdek sınırı ve 128.000 düğüm/eleman ön kontrolü değişmedi.

## Kaynaklar, süreç yaşam döngüsü ve çıkarım sınırı

Testte tek bridge-owned `AnsysWBU` ve iki `ansyscl` süreci görüldü. Son
tarayıcı turu yakınında Mechanical çalışma kümesi yaklaşık 0,7 GB; sistemde
yaklaşık 11,2 GB boş fiziksel bellek vardı. Headless Chromium render süreci
10:10 başlangıcından itibaren 10:20'de 4.312 CPU-saniyesi tüketmişti; bu
tarayıcı E2E'nin doğrudan betiğe göre çok daha yavaş olmasına olası kaynak
rekabeti katkısıdır. Ancak önceki tekil 600 sn Modal import takılmasının
**kanıtlanmış kök nedeni değildir**. Üçlü tekrar sonrası bridge kapatıldığında
hem 8765 hem 10000 dinleyici portu ve o bridge'e ait Mechanical prosesi
kapandı. İşlemler aynı proses içinde yeni proje ile yürüdü; önceki Static
yükleri/sonuçları Modal'a miras kalmadı.

Aynı tam Python regresyon paketi yoğun headless Chromium koşusuyla eşzamanlı
220 test için 334,94 sn, tarayıcı/ANSYS kapandıktan sonraki 221 testlik son
koşuda 7,65 sn sürdü. Test sayısı bir yeni eşzamanlılık testi nedeniyle
farklıdır; bu karşılaştırma kaynak rekabetini destekler ama tek başına
hangi Chromium işlevinin veya hangi Mechanical çağrısının geciktiğini
kanıtlamaz.

## Güvenlik ve kalan risk

Yeni watchdog varsayılan 300 sn boyunca ilerlemeyen **tek aşamayı** `FAILED`
işaretler, sonucu/raporu reddeder, geç dönmüş yanıtın başarıya çevrilmesini
engeller ve eski Mechanical oturumunu karantinaya alır. Proje temizleme ile
CAD importu ayrı mesajlanır; iş kimliği/aşama/süre yerel loga yazılır.
Farklı analiz türleri aynı Mechanical prosesine eşzamanlı sokulmaz. Bloke
gRPC akışını güvenli ve belgeli API ile iptal etme kanıtı bulunmadığından
timeout, işletim sistemi prosesinin mutlaka öldürüldüğü anlamına gelmez;
proses takılı kalırsa kullanıcı yerel oturumu kontrol edip bridge'i yeniden
başlatmalıdır. Bu davranış regresyon testleriyle, gerçek timeout'u simüle
eden **sahte istemci** üzerinde denetlendi; gerçek ANSYS hang'i tekrar
oluşmadığı için gerçek kurtarma yolu fiziksel olarak sınanmadı.

Karar: yazılım tekrarı bu örnekte geçti; eski timeout'un nedeni açık kaldı.
Gerçek araç CAD'i, ölçülmüş malzeme, sınır koşulu ve deney korelasyonu yok.
`NOT_CONVERGED` ve fiziksel doğrulama eksikliği mühendislik onayını
**BLOCKED** tutar.

Son regresyon kapıları: 222 Python testi, 104 bridge testi, Ruff, mypy,
ESLint, TypeScript, 67 frontend testi, üretim build'i ve 13 normal Chromium
akışı geçti. Normal tarayıcı paketinde iki opt-in gerçek ANSYS testi atlandı;
üçlü lisanslı test yukarıda ayrıca çalıştırıldı.

Son cleanup/eşzamanlılık kodu eklendikten sonra var olan ayrı opt-in 3-mesh
Chromium Static→Modal/rapor akışı tekrar çalıştırıldı: 1/1 geçti (4,8 dk).
Static iş `7581c916-5cd4-4476-8fa5-1dc4efcc3f4f` üç gerçek `Done` sonucu,
278,7390026061557 Pa ve 7,259030706281926e-9 m son değerleri döndürdü;
`NOT_CONVERGED` ile iki MAPDL `MP/TB` uyarısı arayüzde korundu. Modal iş
`4ef4ff25-7819-44ce-bf83-b6d0432d2ce8` `Done` ve doğrulanmış frekanslarla
tamamlandı. Yeni yerel aşama logunda Static proje temizliği 0,390 sn,
CAD kurulumu 22,250 sn; Modal proje temizliği 0,391 sn, CAD kurulumu
10,187 sn ve solve→extracting geçişi 79,110 sn olarak kaydedildi. Bridge
kapatıldıktan sonra kendi Mechanical prosesi ve 8765/10000 dinleyicileri
kalmadı. Böylece son koddaki aşama ayrımı ve gerçek rapor/uyarı akışı da
gözlendi; tarihsel timeout'un kesin nedenine dair yeni kanıt üretmedi.
