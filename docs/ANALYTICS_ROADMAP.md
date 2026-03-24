# Drawing Office Analytics Roadmap

Bu dosya simdilik referans amaclidir. Eventleri hemen genisletmiyoruz.

Neden bekliyoruz:

- `extensions-hub-sites` tarafindaki README ve genel public site yapisi hala sekilleniyor
- uygulamanin kalici auth + social + realtime akisi yeni oturuyor
- product event isimlerini erken sabitlemek istemiyoruz

## Simdiden kabul edilen kurallar

Toplanabilir:

- urun etkilesim eventleri
- ekran/surface gecisleri
- sonuc bilgisi
- hedef kullanici ID gibi operasyonel baglam
- session mode bilgisi

Toplanmamali:

- mesaj icerigi
- cizim payload'i
- canvas/image raw data
- ozel serbest metin icerigi

## Sonra eklenmesi planlanan temel eventler

- `Extension Installed`
- `Signed In`
- `Signed Out`
- `Loaded Social State`
- `Sent Friend Request`
- `Accepted Friend Request`
- `Rejected Friend Request`
- `Started Session`
- `Ended Session`
- `Updated Preferences`
- `Opened Paywall`
- `Opened Website Pricing`

## Ortak property seti

- `appId`
- `screen`
- `surface`
- `result`
- `mode`
- `targetUserId`

## Event eklemeye geri donmeden once kontrol listesi

1. Hub website copy ve route yapisi sakinlesmis olmali.
2. Drawing Office popup -> board -> session akisi stabil olmali.
3. Hangi eventlerin extension, hangilerinin website tarafinda toplanacagi netlesmeli.
4. Privacy/terms copy analytics dilini yansitacak hale gelmeli.

## Not

Bu dosya bana daha sonra analytics eventlerini genisletmemizi hatirlatmak icin de burada tutuluyor.
