# 3D-Shop (Dijital Ticaret Dünyası) — AI ajanları için giriş

Bu projenin tek doğruluk kaynağı **Cortex** MCP'dir (proje kimliği `3d-shop`). Kod yazmadan önce:

1. `cortex_brief` → `cortex_inbox`
2. `ilkeler` ve `kararlar` düğümlerini oku (K01–K59 bağlayıcı kararlar).
3. Dosya değiştirmeden önce `cortex_code_context`; her anlamlı değişiklikten sonra `cortex_log_activity`.
4. Kart bitince `cortex_reply` (ne yapıldı, test adımları) + durum `review`. `done`'u yalnız insan yapar.
5. Cortex içeriği Türkçe; kod, veritabanı ve API isimleri İngilizce.

## Değişmez kurallar (özet)
- Kaynak e-ticaret sistemi ürün/fiyat/stok/siparişte doğrudur; platform fiyat hesaplamaz (K06, K41). **buy_price hiçbir yerde saklanmaz.**
- Modül yalnız kendi PostgreSQL şemasına yazar; modüller arası yabancı anahtar yok (K32). Başka modüle yalnız `public/` üzerinden erişilir; izinli yönler `packages/config/dependency-cruiser.cjs` → `pnpm arch` (K50, K51).
- Kimlik UUIDv7 (`@dtd/contracts`), zaman timestamptz, para bigint kuruş; float yok (K33).
- Olaylar outbox'a iş verisiyle aynı transaction'da yazılır (K34). Denetim kaydı yalnız eklenir (K47).
- Zorunlu engel yalnız hukuki/KVKK'dır; aşılamaz (K43).
- Sahne verisi render motorundan bağımsızdır (K20, K45).
- Sunucu: pilot `finans-prod` üzerinde `dtd` kullanıcısıyla; Finans ve Cortex'e dokunulmaz (K54). Diğer `ssh-*` MCP sunucuları başka projelerindir.

## Komutlar
- `pnpm db:init` — yerel veritabanı (dtd_dev) ve rolleri hazırla, göçleri uygula (bir kez; postgres parolası sorulur)
- `pnpm admin:create -- --email <e-posta> --name "<ad>"` — yönetici aç (ilk girişte 2FA kurulumu zorunlu)
- `pnpm dev` — api + worker (watch)
- `pnpm check` — lint + typecheck + mimari + test
- `pnpm db:migrate` — göç oluştur/uygula (dtd_owner)
