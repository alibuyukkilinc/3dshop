/** Web sürecinin sağlık ucu (K59): /healthz. API'ninki /api/healthz'dir. */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ status: 'ok' });
}
