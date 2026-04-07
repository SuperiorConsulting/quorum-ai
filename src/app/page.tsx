import { redirect } from 'next/navigation'

/**
 * Root redirect — send visitors to the pricing page.
 * Authenticated users will be redirected to /dashboard in Phase 14 (Auth).
 */
export default function HomePage() {
  redirect('/pricing')
}
