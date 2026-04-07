import type { Metadata } from 'next'
import { SessionProvider } from '../components/auth/SessionProvider.js'
import './globals.css'

export const metadata: Metadata = {
  title: 'Quorum — The Deciding Intelligence',
  description: '24/7 autonomous AI sales intelligence. Closes deals, books appointments, never forgets a lead.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#04050a] text-white antialiased">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  )
}
