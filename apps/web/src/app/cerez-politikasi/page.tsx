import type { Metadata } from 'next';
import { ConsentSettingsButton } from '../../components/analytics';

export const metadata: Metadata = {
  title: 'Çerez aydınlatma metni',
  description: 'Dijital Ticaret Dünyası hangi çerezleri ve benzeri teknolojileri, hangi amaçla kullanır.',
  alternates: { canonical: '/cerez-politikasi' },
};

const ROWS: { name: string; kind: string; purpose: string; duration: string; where: string }[] = [
  {
    name: 'dtd_consent',
    kind: 'Zorunlu (çerez)',
    purpose: 'Çerez tercihinizi hatırlamak.',
    duration: '180 gün',
    where: 'Yalnız tarayıcınız',
  },
  {
    name: 'dtd_sid',
    kind: 'Site istatistikleri (oturum deposu)',
    purpose: 'Aynı ziyaret içindeki sayfaları birbirine bağlamak için rastgele bir numara. Kimliğinizle ilişkilendirilmez.',
    duration: 'Sekme kapanınca silinir',
    where: 'Tarayıcınız; olaylar sunucularımızda (Türkiye) 13 ay',
  },
  {
    name: '_ga, _ga_*',
    kind: 'Google Analytics (çerez)',
    purpose: 'Ziyaret istatistiği. Reklam ve kişiselleştirme kapalıdır.',
    duration: '2 yıla kadar',
    where: 'Google LLC (yurt dışı)',
  },
];

/**
 * Çerez aydınlatma metni (KVKK m.10, F5.4). Metin taslaktır; canlıya geçişten önce hukuki incelemeden geçer
 * (Cortex analitik düğümü). Tablo rıza bandındaki seçeneklerle birebir aynı olmalı.
 */
export default function CookiePolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Çerez aydınlatma metni</h1>
      <div className="prose-dtd mt-4 space-y-3 text-sm">
        <p>
          Dijital Ticaret Dünyası, mağazaların ürünlerini 2D katalogda ve 3D şehirde gezmenizi sağlar. Satın alma her
          zaman mağazanın kendi sitesinde yapılır. Bu sayfa, sitemizde kullandığımız çerezleri ve benzeri teknolojileri
          anlatır.
        </p>
        <p>
          <strong>Varsayılan olarak yalnız zorunlu çerez kullanılır.</strong> Site istatistikleri ve Google Analytics,
          ancak siz izin verirseniz çalışır. İzninizi istediğiniz zaman aynı kolaylıkla geri alabilirsiniz; site her iki
          durumda da aynı şekilde çalışır.
        </p>
        <p>
          Site istatistiklerinde adınız, e-postanız, IP adresiniz ya da hesabınız kaydedilmez. Hangi sayfa, mağaza ve
          ürünün açıldığı, hangi kelimelerin arandığı ve mağaza sitesine kaç kez gidildiği sayılır. Bir ürünü mağaza
          sitesinde satın aldığınızda mağaza, siparişi bizim yönlendirmemizle eşleştirmek için yalnız yönlendirme
          numarasını ve sipariş tutarını bildirir.
        </p>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th scope="col" className="py-2 pr-3 font-medium">
                Ad
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Tür
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Amaç
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Süre
              </th>
              <th scope="col" className="py-2 font-medium">
                Nerede
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.name} className="border-t border-line align-top">
                <td className="py-2 pr-3">
                  <code>{r.name}</code>
                </td>
                <td className="py-2 pr-3">{r.kind}</td>
                <td className="py-2 pr-3">{r.purpose}</td>
                <td className="py-2 pr-3">{r.duration}</td>
                <td className="py-2">{r.where}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-sm">
        Tercihinizi değiştirmek için: <ConsentSettingsButton />
      </p>
    </main>
  );
}
