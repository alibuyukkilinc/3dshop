# Yerel geliştirme veritabanını hazırlar (bir kez çalıştırılır). Finans'taki betiğin aynısı, dtd adlarıyla.
#
# - dtd_owner: tabloların sahibi, göçleri çalıştırır, test veritabanı açabilir (CREATEDB)
# - dtd_app:   uygulamanın çalışma anı rolü (tablo sahibi değil; audit_log'a yalnız ekler)
# - dtd_dev:   geliştirme veritabanı
#
# Parolalar .env dosyasından okunur (.env yoksa rastgele üretilip .env yazılır; SECRETS_KEY de üretilir).
# postgres süper kullanıcı parolası psql tarafından sorulur; hiçbir yere kaydedilmez.

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$envFile = Join-Path $root '.env'

function New-Secret {
  $bytes = New-Object byte[] 24
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  return ([Convert]::ToBase64String($bytes) -replace '[+/=]', 'x')
}

function New-Key32 {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  return [Convert]::ToBase64String($bytes)
}

if (-not (Test-Path $envFile)) {
  $appPass = New-Secret
  $ownerPass = New-Secret
  $content = (Get-Content -Raw -Encoding UTF8 (Join-Path $root '.env.example')) `
    -replace 'dtd_app:DEGISTIR', "dtd_app:$appPass" `
    -replace 'dtd_owner:DEGISTIR', "dtd_owner:$ownerPass" `
    -replace 'SECRETS_KEY=DEGISTIR', "SECRETS_KEY=$(New-Key32)"
  [System.IO.File]::WriteAllText($envFile, $content, (New-Object System.Text.UTF8Encoding $false))
  Write-Host '.env oluşturuldu (rastgele yerel parolalar ve SECRETS_KEY ile).'
}

$envText = Get-Content $envFile -Raw
$appPass = [regex]::Match($envText, 'dtd_app:([^@]+)@').Groups[1].Value
$ownerPass = [regex]::Match($envText, 'dtd_owner:([^@]+)@').Groups[1].Value
if (-not $appPass -or -not $ownerPass) { throw '.env içinde dtd_app/dtd_owner parolaları bulunamadı.' }

$psql = Get-ChildItem 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $psql) { throw 'psql.exe bulunamadı (C:\Program Files\PostgreSQL\17\bin).' }

$sql = @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dtd_owner') THEN
    CREATE ROLE dtd_owner LOGIN CREATEDB PASSWORD '$ownerPass';
  ELSE
    ALTER ROLE dtd_owner LOGIN CREATEDB PASSWORD '$ownerPass';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dtd_app') THEN
    CREATE ROLE dtd_app LOGIN PASSWORD '$appPass';
  ELSE
    ALTER ROLE dtd_app LOGIN PASSWORD '$appPass';
  END IF;
END
`$`$;
GRANT dtd_app TO dtd_owner;
SELECT 'CREATE DATABASE dtd_dev OWNER dtd_owner'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'dtd_dev')\gexec
"@

Write-Host 'postgres kullanıcısının parolası sorulacak (yerel PostgreSQL 17, port 5432).'
$sql | & $psql.FullName -U postgres -h localhost -p 5432 -d postgres -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'psql başarısız oldu.' }

Push-Location (Join-Path $root 'apps\api')
try {
  pnpm exec prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw 'Göçler uygulanamadı.' }
} finally {
  Pop-Location
}
Write-Host 'Hazır: dtd_dev veritabanı, dtd_owner/dtd_app rolleri ve göçler. Sonraki adım: pnpm admin:create'
