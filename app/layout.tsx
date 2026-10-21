import type { Metadata } from "next"

import "./globals.css"

export const metadata: Metadata = {
  title: "Softphone — 06 Line",
  description: "Call from the browser with the 06 Line SDK.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-[#202124] font-sans antialiased">{children}</body>
    </html>
  )
}
