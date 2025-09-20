import './globals.css'

export const metadata = {
  title: 'Squnch - Professional File Compression',
  description: 'Smart file compression for content creators. Reduce file sizes by 60-85% with imperceptible quality loss.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="font-inter antialiased bg-white">
        {children}
      </body>
    </html>
  )
}