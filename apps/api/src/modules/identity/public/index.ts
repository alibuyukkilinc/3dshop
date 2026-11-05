// identity modülünün dışa açık yüzü (K50). Diğer modüllerin yönetim uçları korumayı buradan alır.
export { IdentityModule } from '../identity.module.js';
export {
  AdminGuard,
  AllowPartialSession,
  CurrentAdminSession,
  RequireRoles,
} from '../http/admin.guard.js';
export type { ResolvedSession } from '../application/admin-auth.service.js';
export { AdminUsersService, ADMIN_ROLES, type AdminRole } from '../application/admin-users.service.js';
