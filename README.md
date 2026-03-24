# Sync Sketch Party

Tek seferlik sync ile arkadas listesi olusturan, online durum gosteren ve iki farkli cizim modu sunan Chrome extension + WebSocket relay prototipi.

## Proje Yapisi

Bu repo artik starter kit'teki ayri katman mantigina daha yakin bir yapi kullanir:

- `src/background/`: service worker ve tab mesaj kopruleri
- `src/content/`: aktif sekmeye surpriz efekt basan content script
- `src/dashboard/`: ana board ekraninin HTML, CSS ve JS dosyalari
- `src/popup/`: popup giris ve hizli baslatma yuzeyi
- `src/lib/`: Supabase auth, social client, analytics ve ortak yardimci katmanlar
- `src/types/`: ileride tip dosyalari icin ayrilmis alan
- `relay/`: deploy edilen stateless WebSocket relay sunucusu
- `public/icons/`: extension ikon kaynaklari icin ayrilmis alan
- `scripts/`: repo-ozel yardimci scriptler icin ayrilmis alan
- `store-assets/`: store screenshot, promo ve video ciktilari icin ayrilmis alan
- `docs/`: urun ve analytics notlari
- `extension-marketing-kit/`: ileride screenshot ve promo video uretmek icin reusable scriptler

## Onemli Dosyalar

- `manifest.json`: Chrome extension tanimi
- `src/popup/popup.html`: popup UI
- `src/dashboard/dashboard.html`: arkadas listesi, draft/cizim ve sohbet ekrani
- `src/lib/`: auth, Supabase client ve social wrapper
- `relay/server.js`: JWT dogrulamali realtime relay
- `docs/ANALYTICS_ROADMAP.md`: analytics eventlerini ne zaman ve nasil genisletecegimize dair notlar

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

1. `relay/server.js` tek portta hem HTTP hem WebSocket dinler.
2. Health check icin `GET /health` endpoint'i vardir.
3. Extension'a `https://senin-domainin.com` yazman yeterli; istemci bunu otomatik olarak `wss://` baglantisina cevirir.

Ornek deploy secenekleri:

- Bir VPS uzerinde `npm install` ve `npm start`
- Docker ile bir cloud servisine deploy
- Render, Railway, Fly.io benzeri tek-instance Node servisleri

Docker ile calistirmak icin:

1. `docker build -t sync-sketch-party .`
2. `docker run -p 3000:3000 -e APP_ID=drawing-office -e SUPABASE_URL=https://... -e SUPABASE_ANON_KEY=... sync-sketch-party`

Sunucu deploy olduktan sonra extension icinde sunucu adresi olarak ornegin `https://draw.yourapp.com` girmen yeterli olur.

## Hizli Test: Render

Arkadasinla farkli bilgisayarlardan en hizli test icin Render uzerinden mevcut `relay/server.js` sunucusunu yayinlayabilirsin.

1. Bu repo'yu GitHub'a push et.
2. Render'da `New +` -> `Blueprint` sec.
3. Repo'yu bagla; Render [render.yaml](C:/Users/burak/Desktop/Burakhrk/SideProjects/DrawingExtension/render.yaml) dosyasini otomatik okuyacak.
4. Deploy bitince Render sana `https://...onrender.com` adresi verecek.
5. Extension popup'inda sunucu adresi olarak bu `https` adresini yaz.
6. Extension istemcisi bunu otomatik olarak `wss` baglantisina cevirir.

Not:

- Render resmi dokumanina gore WebSocket baglantilarini public internetten kabul ediyor. [WebSockets on Render](https://render.com/docs/websocket)
- Render web service'leri public URL ve TLS ile gelir; uygulama `PORT` env'ine baglanmalidir. Bizim sunucu bunu zaten yapiyor. [Web Services](https://render.com/docs/web-services)

## Notlar

- Su an cizimler sadece aktif oturum icinde canli aktarilir; gecmis cizimi yeni oturuma tasima yok.
- Relay stateless calisir; kalici arkadaslik ve tercih verisinin kaynagi Supabase'tir.
- Kimlik artik cihaz anahtarina degil Supabase hesabina dayanir; relay kayit sirasinda access token dogrulamasi yapar.
- Realtime oturum baslatma istegi de Supabase `sessions` tablosundaki aktif RPC oturumuyla eslestirilir; tek basina websocket mesaji yeterli degildir.
- Kisa baglanti kopmalarinda oturum aninda dusmez; varsayilan olarak `8` saniyelik geri baglanma penceresi vardir.
- Relay tarafinda temel payload guard ve rate limit bulunur; bu store/public dagitim icin daha guvenli bir taban verir.
