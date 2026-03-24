# Sync Sketch Party

Tek seferlik sync ile arkadas listesi olusturan, online durum gosteren ve iki farkli cizim modu sunan Chrome extension + WebSocket relay prototipi.

## Neler var

- `manifest.json`: Chrome extension tanimi
- `popup.html`: Profil bilgisi ve sunucu adresi girilen baslangic paneli
- `board.html`: Arkadas listesi, sync alani, cizim tuvali ve sohbet ekrani
- `server.js`: Kullanici profili, arkadas eslestirme, online durum ve oturum yonetimi
- `server-data.json`: Arkadaslik bilgilerinin basit kalici kaydi
- `extension-marketing-kit/`: Ileride screenshot ve promo video uretmek icin reusable scriptler
- `docs/ANALYTICS_ROADMAP.md`: Analytics eventlerini ne zaman ve nasil genisletecegimize dair notlar

## Yerel Kurulum

1. Node.js kurulu degilse kur.
2. Bu klasorde `npm install` calistir.
3. Relay sunucuyu baslatmak icin `npm start` calistir.
4. Chrome'da `chrome://extensions` ac.
5. Gelistirici modunu aktif et.
6. `Load unpacked` ile bu klasoru sec.
7. Extension popup'inda isim ve sunucu adresi olarak `http://localhost:3000` gir.
8. Acilan panelde kendi sync kodunu arkadasinla paylas.
9. Arkadasinin kodunu sync alanina girerek bir kez esles.
10. Arkadas listesinden online kullaniciyi secip mod baslat.
11. `Ciz gonder` modunda sen cizersin, karsi taraf izler.
12. `Es zamanli` modunda iki taraf da ayni anda cizebilir.

## Farkli Bilgisayarlar Icin

Bu proje artik internetten erisilebilen bir sunucuya deploy edilmeye uygun.

1. `server.js` tek portta hem HTTP hem WebSocket dinler.
2. Health check icin `GET /health` endpoint'i vardir.
3. Extension'a `https://senin-domainin.com` yazman yeterli; istemci bunu otomatik olarak `wss://` baglantisina cevirir.

Ornek deploy secenekleri:

- Bir VPS uzerinde `npm install` ve `npm start`
- Docker ile bir cloud servisine deploy
- Render, Railway, Fly.io benzeri tek-instance Node servisleri

Docker ile calistirmak icin:

1. `docker build -t sync-sketch-party .`
2. `docker run -p 3000:3000 -v %cd%/data:/app/data -e DATA_FILE=/app/data/server-data.json sync-sketch-party`

Sunucu deploy olduktan sonra extension icinde sunucu adresi olarak ornegin `https://draw.yourapp.com` girmen yeterli olur.

## Hizli Test: Render

Arkadasinla farkli bilgisayarlardan en hizli test icin Render uzerinden mevcut `server.js` sunucusunu yayinlayabilirsin.

1. Bu repo'yu GitHub'a push et.
2. Render'da `New +` -> `Blueprint` sec.
3. Repo'yu bagla; Render [render.yaml](C:/Users/burak/Desktop/Burakhrk/SideProjects/DrawingExtension/render.yaml) dosyasini otomatik okuyacak.
4. Deploy bitince Render sana `https://...onrender.com` adresi verecek.
5. Extension popup'inda sunucu adresi olarak bu `https` adresini yaz.
6. Extension istemcisi bunu otomatik olarak `wss` baglantisina cevirir.

Not:

- Render resmi dokumanina gore WebSocket baglantilarini public internetten kabul ediyor. [WebSockets on Render](https://render.com/docs/websocket)
- Render web service'leri public URL ve TLS ile gelir; uygulama `PORT` env'ine baglanmalidir. Bizim sunucu bunu zaten yapiyor. [Web Services](https://render.com/docs/web-services)
- Su an `server-data.json` dosyasi varsayilan olarak lokal diske yaziliyor. Render dokumanina gore kalici disk baglanmazsa dosya sistemi gecicidir; yani deploy/restart sonrasinda arkadaslik verisi silinebilir. Hemen test etmek icin sorun degil. [Persistent Disks](https://render.com/docs/disks)

## Notlar

- Su an cizimler sadece aktif oturum icinde canli aktarilir; gecmis cizimi yeni oturuma tasima yok.
- Arkadaslik bilgisi varsayilan olarak `server-data.json` icinde tutulur. Uretim ortaminda kalici disk yoksa bu veri sifirlanabilir.
- Her kullanici icin ilk kayitta yerel bir cihaz anahtari olusturulur. Ayni `userId` baska bir cihaz anahtariyla taklit edilmeye calisilirsa sunucu baglantiyi reddeder.
- Kisa baglanti kopmalarinda oturum aninda dusmez; varsayilan olarak `8` saniyelik geri baglanma penceresi vardir.
- Gercek sosyal urun icin bir veritabani eklemek iyi olur. Bu prototip su an tek sunucu uzerinde calisan MVP yapisinda.
- Kimlik korumasi su an cihaz anahtari tabanli hafif bir seviyede. Gercek sosyal urun icin Supabase Auth veya benzeri tam kimlik dogrulama eklenmeli.
