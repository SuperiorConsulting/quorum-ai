export { auth as middleware } from './lib/auth.js'

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/onboarding/:path*',
  ],
}
