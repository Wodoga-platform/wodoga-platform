import type { ReactNode } from 'react';
import Providers from './providers';
import '@/styles/globals.css';

export const metadata = {
  title: 'Wodoga Platform',
  description: 'Home Health & Pharmaceutical Operations Platform',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}