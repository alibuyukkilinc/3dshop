/**
 * Yönetici hesabı açar (ilk sürümde kayıt yok, K07).
 *
 *   pnpm admin:create -- --email ali@ornek.com --name "Ali" --roles platform_admin,approver
 *
 * Parola ADMIN_PASSWORD ortam değişkeninden okunur; yoksa güçlü bir parola üretilip BİR KEZ ekrana yazılır.
 * İlk girişte 2FA (TOTP) kurulumu zorunludur.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { AppModule } from '../src/app.module.js';
import { ADMIN_ROLES, type AdminRole, AdminUsersService } from '../src/modules/identity/public/index.js';

const { values } = parseArgs({
  // pnpm "--" ayırıcısını argüman olarak geçirir
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    roles: { type: 'string', default: 'platform_admin,approver' },
  },
});

if (!values.email || !values.name) {
  console.error('Kullanım: pnpm admin:create -- --email <e-posta> --name "<ad>" [--roles platform_admin,approver]');
  process.exit(1);
}
const roles = values.roles!.split(',').map((r) => r.trim()) as AdminRole[];
const unknown = roles.filter((r) => !ADMIN_ROLES.includes(r));
if (unknown.length) {
  console.error(`Bilinmeyen rol: ${unknown.join(', ')}. Geçerli: ${ADMIN_ROLES.join(', ')}`);
  process.exit(1);
}

const generated = !process.env.ADMIN_PASSWORD;
const password = process.env.ADMIN_PASSWORD ?? randomBytes(18).toString('base64url');

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
try {
  const { id } = await app.get(AdminUsersService).create({
    email: values.email,
    displayName: values.name,
    password,
    roles,
  });
  console.log(`Yönetici açıldı: ${values.email} (${id}), roller: ${roles.join(', ')}`);
  if (generated) console.log(`Geçici parola (bir kez gösterilir, güvenli yere kaydedin): ${password}`);
  console.log('İlk girişte iki adımlı doğrulama (TOTP) kurulumu istenecek.');
} finally {
  await app.close();
}
